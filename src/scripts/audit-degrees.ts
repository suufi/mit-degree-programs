#!/usr/bin/env node
/**
 * Gemini audit pass over every degree program.
 *
 * For each degree it compares the human-readable visualization (what a reviewer
 * sees) against the scraped catalog/EECS source markdown (the ground truth we
 * captured) and asks Gemini to flag anything missing, mismatched, or extra —
 * plus a concrete, non-destructive proposed JSON fix for each finding.
 *
 * This NEVER modifies degree data. It only writes reports under docs/degree-audit/.
 *
 * Rate limits: runs strictly sequentially with a configurable delay between
 * calls and exponential backoff (honoring the server's RetryInfo) on 429/5xx.
 * Progress is flushed after every program so an interrupted run can resume with
 * --skip-existing.
 *
 * Usage:
 *   npm run audit:degrees                      # audit all draft degrees
 *   npm run audit:degrees -- --program 8-flexible
 *   npm run audit:degrees -- --limit 5 --delay-ms 6000
 *   npm run audit:degrees -- --skip-existing   # resume, skip already-audited
 *   npm run audit:degrees -- --dry-run         # list targets, no API calls
 */
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadGir, loadProgram, loadSharedLists, type DataKind } from "../index";
import { renderProgramMarkdown } from "../visualize/render";
import {
  GeminiError,
  generateGeminiJson,
  getGeminiConfig,
  withGeminiRetry,
} from "../llm/gemini";
import type {
  DegreeProgram,
  RequirementGroup,
  RequirementNode,
  SharedListDocument,
} from "../schemas/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DATA_ROOT = path.resolve(__dirname, "../data");
const ARTIFACTS_DIR = path.join(DATA_ROOT, "scrape-artifacts");
const DEGREES_ROOT = path.join(DATA_ROOT, "degrees-departments/drafts/degrees");
const OUT_DIR = path.join(PROJECT_ROOT, "docs/degree-audit");
const RESULTS_PATH = path.join(OUT_DIR, "_results.json");
const SUMMARY_PATH = path.join(OUT_DIR, "_summary.csv");

const SEVERITIES = ["high", "medium", "low"] as const;
type Severity = (typeof SEVERITIES)[number];

const auditSchema = z.object({
  verdict: z.string().optional(),
  summary: z.string().optional(),
  issues: z
    .array(
      z.object({
        severity: z.string().optional(),
        type: z.string().optional(),
        requirement: z.string().optional(),
        sourceText: z.string().optional(),
        captured: z.string().nullish(),
        explanation: z.string().optional(),
        proposedFix: z.string().optional(),
      }),
    )
    .optional(),
});

type Issue = {
  severity: Severity;
  type: string;
  requirement: string;
  sourceText: string;
  captured: string;
  explanation: string;
  proposedFix: string;
};

type AuditResult = {
  program: string;
  title: string;
  level: string;
  source: string;
  verdict: "match" | "issues" | "error";
  summary: string;
  counts: { high: number; medium: number; low: number; total: number };
  issues: Issue[];
  model: string;
  auditedAt: string;
  error?: string;
};

function parseArgs(argv: string[]) {
  const args: {
    program?: string;
    limit?: number;
    level?: string;
    delayMs: number;
    maxRetries: number;
    skipExisting: boolean;
    dryRun: boolean;
    model?: string;
  } = { delayMs: 4000, maxRetries: 5, skipExisting: false, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--program" && argv[i + 1]) args.program = argv[++i];
    else if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (arg === "--level" && argv[i + 1]) args.level = argv[++i];
    else if (arg === "--delay-ms" && argv[i + 1]) args.delayMs = Number(argv[++i]);
    else if (arg === "--max-retries" && argv[i + 1]) args.maxRetries = Number(argv[++i]);
    else if (arg === "--model" && argv[i + 1]) args.model = argv[++i];
    else if (arg === "--skip-existing") args.skipExisting = true;
    else if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listProgramIds(): Promise<string[]> {
  const ids: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".json")) ids.push(entry.name.replace(/\.json$/, ""));
    }
  }
  await walk(DEGREES_ROOT);
  return ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

type TagPoolsFile = {
  pools: Record<string, { label: string; openGradesTag?: { field: string; values: string[] } | null }>;
};

async function loadTagPools(): Promise<TagPoolsFile> {
  const raw = await readFile(path.join(DATA_ROOT, "institute/tag-pools.json"), "utf8");
  return JSON.parse(raw) as TagPoolsFile;
}

async function pickArtifactFile(dir: string, prefer: string[]): Promise<string | null> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".markdown"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  for (const wanted of prefer) {
    const hit = files.find((f) => f === wanted || f.endsWith(wanted));
    if (hit) return path.join(dir, hit);
  }
  const latest = files.sort().reverse()[0]!;
  return path.join(dir, latest);
}

/** Locate the scraped source markdown a degree was built from. */
async function resolveSourceMarkdown(
  degree: DegreeProgram,
): Promise<{ label: string; markdown: string } | null> {
  if (degree.catalogSource?.slug) {
    const dir = path.join(ARTIFACTS_DIR, degree.catalogSource.slug);
    const file = await pickArtifactFile(dir, [`${degree.catalogSource.scrapedAt}.markdown`]);
    if (file) {
      return { label: path.relative(PROJECT_ROOT, file), markdown: await readFile(file, "utf8") };
    }
  }
  if (degree.eecsSource) {
    const base = degree.program.replace(/-20\d\d$/, "");
    const dir = path.join(ARTIFACTS_DIR, `eecs-${base}`);
    const year = degree.eecsSource.enterYear;
    const file = await pickArtifactFile(dir, [
      `-${year}.markdown`,
      `${degree.eecsSource.scrapedAt}.markdown`,
    ]);
    if (file) {
      return { label: path.relative(PROJECT_ROOT, file), markdown: await readFile(file, "utf8") };
    }
  }
  return null;
}

function trimSource(markdown: string, max = 16000): string {
  const body = markdown.split(/Print Options/i)[0] ?? markdown;
  return body.length > max ? `${body.slice(0, max)}\n\n[...truncated...]` : body;
}

/**
 * Compact textual summary of a program's requirements. Unlike the full
 * visualization (which enumerates every subject in every shared list and can be
 * hundreds of KB for Course-6 programs), this references shared lists by id +
 * member count, keeping the prompt small enough for the API.
 */
function summarizeProgram(degree: DegreeProgram, sharedLists: SharedListDocument[]): string {
  const listById = new Map(sharedLists.map((l) => [l.sharedListId, l]));
  const listRef = (id: string) => {
    const list = listById.get(id);
    const preview = list ? list.items.slice(0, 12).map((it) => ("subjectId" in it ? (it as { subjectId?: string }).subjectId : undefined)).filter(Boolean).join(", ") : "";
    return `${id}${list ? ` (${list.items.length} items${preview ? `: ${preview}${list.items.length > 12 ? ", …" : ""}` : ""})` : ""}`;
  };

  const summarizeNode = (node: RequirementNode, depth: number): string[] => {
    const pad = "  ".repeat(depth);
    if (node.type === "subject") {
      return [`${pad}- ${node.subjectId}${node.note ? ` — ${node.note}` : ""}`];
    }
    if (node.type === "group") {
      return [`${pad}- all of:`, ...node.items.flatMap((c) => summarizeNode(c, depth + 1))];
    }
    const rule =
      node.ruleType === "choose_one"
        ? "choose one"
        : node.ruleType === "choose_n"
          ? `choose ${node.ruleValue}`
          : `choose ${node.ruleValue} units${node.ruleType === "choose_units_approved" ? " (approved)" : ""}`;
    let from = "";
    if (node.itemsSource === "tag_pool" && node.tagPool) from = ` from tag pool ${node.tagPool}`;
    else if (node.itemsSource === "shared_list" && node.sharedListId) from = ` from ${listRef(node.sharedListId)}`;
    else if (node.itemsSource === "shared_list_union" && node.sharedListIds)
      from = ` from union of ${node.sharedListIds.map(listRef).join(" + ")}`;
    else if (node.itemsSource === "advisor_defined") from = " (advisor-defined)";
    const head = `${pad}- ${rule}${from}${node.note ? ` — ${node.note}` : ""}`;
    const inline = node.items?.length
      ? node.items.flatMap((c) => summarizeNode(c, depth + 1))
      : [];
    return [head, ...inline];
  };

  const groupText = (g: RequirementGroup): string =>
    [`## ${g.title} [${g.bucket}/${g.subcategory}]`, ...summarizeNode(g.root, 0)].join("\n");

  return [
    `# ${degree.title} (${degree.program})`,
    ...degree.requirements.map(groupText),
  ].join("\n\n");
}

const MAX_VIZ_CHARS = 45000;

/** Pick the most faithful captured-data representation that fits the API. */
function representationFor(
  degree: DegreeProgram,
  viz: string,
  sharedLists: SharedListDocument[],
): string {
  if (viz.length <= MAX_VIZ_CHARS) return viz;
  const summary = summarizeProgram(degree, sharedLists);
  return `${summary}\n\n_(Shared-list contents summarized by id + count because the full visualization was too large to send.)_`;
}

function buildPrompt(degree: DegreeProgram, viz: string, source: string): string {
  return `You are auditing a machine-parsed MIT degree requirement record against the official catalog source text. Your job is to find where our captured data DISAGREES with the source so a human can fix it.

Return JSON ONLY:
{
  "verdict": "match" | "issues",
  "summary": "one sentence overall assessment",
  "issues": [
    {
      "severity": "high" | "medium" | "low",
      "type": "missing" | "mismatch" | "extra" | "units" | "footnote" | "other",
      "requirement": "short label for the requirement",
      "sourceText": "exact quote from the catalog source",
      "captured": "what our data currently has, or null if absent",
      "explanation": "why this is a discrepancy",
      "proposedFix": "concrete JSON change to our record: which requirement group/node to add or edit, and the fields to set (e.g. add a selection node ruleType choose_units ruleValue 36 itemsSource advisor_defined)"
    }
  ]
}

Guidance:
- "high" = a required subject/credit or whole requirement group missing or wrong. "medium" = a restricted elective, unit count, or choice set off. "low" = wording, footnote linkage, or cosmetic.
- Only report REAL discrepancies. If everything matches, return verdict "match" and an empty issues array.
- This record represents ONE specific option/track: "${degree.title}". The source page may list MULTIPLE options/tracks (e.g. Standard vs. Flexible, or General/Applied/Pure). Audit ONLY the requirements for this option; do NOT flag requirements that belong to a different option as "missing".
- Ignore General Institute Requirements (GIRs), unrestricted electives, and PE unless the departmental chart explicitly changes them.
- Prefer quoting the source exactly in sourceText so a reviewer can locate it.

Program: ${degree.title} (${degree.program}, ${degree.level})
Existing footnotes: ${JSON.stringify(degree.footnotes ?? [])}

=== OUR CAPTURED DATA (visualization) ===
${viz}

=== OFFICIAL CATALOG SOURCE (markdown) ===
${trimSource(source)}`;
}

function normalizeSeverity(value?: string): Severity {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("h") || v.includes("crit")) return "high";
  if (v.startsWith("l") || v.includes("minor") || v.includes("cosm")) return "low";
  return "medium";
}

type RawIssue = NonNullable<z.infer<typeof auditSchema>["issues"]>[number];

function normalizeIssue(raw: RawIssue): Issue {
  return {
    severity: normalizeSeverity(raw.severity),
    type: (raw.type ?? "other").toLowerCase(),
    requirement: raw.requirement?.trim() || "(unspecified)",
    sourceText: raw.sourceText?.trim() || "",
    captured: raw.captured?.trim() || "",
    explanation: raw.explanation?.trim() || "",
    proposedFix: raw.proposedFix?.trim() || "",
  };
}

async function auditOne(
  degree: DegreeProgram,
  viz: string,
  source: { label: string; markdown: string },
  model: string,
  maxRetries: number,
  onRetry: (info: { attempt: number; delayMs: number; error: GeminiError }) => void,
): Promise<AuditResult> {
  const prompt = buildPrompt(degree, viz, source.markdown);
  let attempt = 0;
  const raw = await withGeminiRetry(
    async () => {
      // Bump temperature after the first try so a retry produces a *different*
      // generation — deterministic temp-0 output would just reproduce any
      // malformed JSON.
      const temperature = attempt === 0 ? 0 : 0.4;
      attempt++;
      try {
        return await generateGeminiJson<unknown>(prompt, { model, temperature });
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new GeminiError(`malformed JSON from model: ${error.message}`, { retryable: true });
        }
        throw error;
      }
    },
    { maxRetries, onRetry },
  );
  const parsed = auditSchema.parse(raw);
  const issues = (parsed.issues ?? []).map(normalizeIssue);
  const counts = {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
    total: issues.length,
  };
  const verdict: AuditResult["verdict"] =
    issues.length === 0 && (parsed.verdict ?? "").toLowerCase() !== "issues" ? "match" : "issues";
  return {
    program: degree.program,
    title: degree.title,
    level: degree.level,
    source: source.label,
    verdict,
    summary: parsed.summary?.trim() || (verdict === "match" ? "Matches source." : "Discrepancies found."),
    counts,
    issues,
    model,
    auditedAt: new Date().toISOString(),
  };
}

const SEV_LABEL: Record<Severity, string> = { high: "HIGH", medium: "MED", low: "LOW" };

function renderReportMarkdown(result: AuditResult): string {
  const lines: string[] = [
    `# Audit: ${result.title}`,
    "",
    `- **Program:** \`${result.program}\` (${result.level})`,
    `- **Verdict:** ${result.verdict === "match" ? "✅ matches source" : `⚠️ ${result.counts.total} issue(s) — ${result.counts.high} high, ${result.counts.medium} medium, ${result.counts.low} low`}`,
    `- **Source:** \`${result.source}\``,
    `- **Model:** ${result.model} · ${result.auditedAt}`,
    "",
    `> ${result.summary}`,
    "",
  ];
  if (result.error) {
    lines.push(`**Error:** ${result.error}`, "");
    return lines.join("\n");
  }
  if (result.issues.length === 0) {
    lines.push("No discrepancies reported.", "");
    return lines.join("\n");
  }
  const order: Severity[] = ["high", "medium", "low"];
  for (const sev of order) {
    const group = result.issues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    lines.push(`## ${SEV_LABEL[sev]} (${group.length})`, "");
    for (const issue of group) {
      lines.push(`### ${issue.requirement}  \`${issue.type}\``);
      if (issue.explanation) lines.push("", issue.explanation);
      if (issue.sourceText) lines.push("", `- **Source:** ${issue.sourceText}`);
      if (issue.captured) lines.push(`- **Captured:** ${issue.captured}`);
      if (issue.proposedFix) lines.push(`- **Proposed fix:** ${issue.proposedFix}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function writeSummary(results: AuditResult[]): Promise<void> {
  const headers = [
    "Program",
    "Title",
    "Level",
    "Verdict",
    "Issues",
    "High",
    "Medium",
    "Low",
    "Summary",
    "Report",
    "Source",
  ];
  const rows = results.map((r) =>
    [
      r.program,
      r.title,
      r.level,
      r.verdict,
      r.counts.total,
      r.counts.high,
      r.counts.medium,
      r.counts.low,
      r.error ? `ERROR: ${r.error}` : r.summary,
      `docs/degree-audit/${r.program}.md`,
      r.source,
    ]
      .map(csvCell)
      .join(","),
  );
  await writeFile(SUMMARY_PATH, `${[headers.join(","), ...rows].join("\n")}\n`, "utf8");
}

async function loadExistingResults(): Promise<Map<string, AuditResult>> {
  try {
    const raw = await readFile(RESULTS_PATH, "utf8");
    const arr = JSON.parse(raw) as AuditResult[];
    return new Map(arr.map((r) => [r.program, r]));
  } catch {
    return new Map();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const geminiConfig = getGeminiConfig();
  if (!geminiConfig && !args.dryRun) {
    console.error("GEMINI_API_KEY is not set. Add it to .env or pass --dry-run to preview targets.");
    process.exit(1);
  }
  const model = args.model ?? geminiConfig?.model ?? "gemini-2.0-flash";

  await mkdir(OUT_DIR, { recursive: true });
  const existing = await loadExistingResults();
  const [gir, tagPools] = await Promise.all([loadGir(), loadTagPools()]);

  let programs = args.program ? [args.program] : await listProgramIds();

  // Resolve metadata up front so --level filtering and skip logic are cheap.
  const resolved: DegreeProgram[] = [];
  for (const id of programs) {
    try {
      resolved.push(await loadProgram(id, { kind: "draft" as DataKind }));
    } catch (error) {
      console.warn(`  ! could not load ${id}: ${error instanceof Error ? error.message : error}`);
    }
  }
  let targets = resolved;
  if (args.level) targets = targets.filter((d) => d.level === args.level);
  if (args.skipExisting) {
    targets = targets.filter((d) => !existing.get(d.program) || existing.get(d.program)?.verdict === "error");
  }
  if (args.limit && args.limit > 0) targets = targets.slice(0, args.limit);

  console.log(
    [
      "Degree audit (Gemini)",
      `  model:        ${model}`,
      `  targets:      ${targets.length}${args.skipExisting ? ` (skipped ${resolved.length - targets.length} already done)` : ""}`,
      `  delay:        ${args.delayMs}ms between calls`,
      `  max retries:  ${args.maxRetries}`,
      `  output:       docs/degree-audit/`,
      "",
    ].join("\n"),
  );

  if (args.dryRun) {
    targets.forEach((d, i) => console.log(`  [${i + 1}/${targets.length}] ${d.program} — ${d.title}`));
    console.log(`\nDry run: ${targets.length} degree(s) would be audited. No API calls made.`);
    return;
  }

  const results = new Map(existing);
  const tally = { match: 0, issues: 0, failed: 0, high: 0 };
  const startedAt = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const degree = targets[i]!;
    const label = `[${i + 1}/${targets.length}] ${degree.program} — ${degree.title}`;
    console.log(label);

    const t0 = Date.now();
    try {
      const source = await resolveSourceMarkdown(degree);
      if (!source) {
        throw new Error("no source markdown artifact found");
      }
      const sharedLists = await loadSharedLists(degree.program, { kind: "draft" });
      const viz = renderProgramMarkdown({ program: degree, sharedLists, gir, tagPools });
      const captured = representationFor(degree, viz, sharedLists);

      const result = await auditOne(
        degree,
        captured,
        source,
        model,
        args.maxRetries,
        ({ attempt, delayMs, error }) =>
          console.log(
            `    rate-limited (${error.status ?? "?"}), waiting ${Math.round(delayMs / 1000)}s — retry ${attempt}/${args.maxRetries}`,
          ),
      );

      await writeFile(path.join(OUT_DIR, `${degree.program}.md`), renderReportMarkdown(result), "utf8");
      results.set(degree.program, result);

      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.verdict === "match") {
        tally.match++;
        console.log(`    ✅ matches source (${secs}s)`);
      } else {
        tally.issues++;
        tally.high += result.counts.high;
        console.log(
          `    ⚠️  ${result.counts.total} issue(s): ${result.counts.high} high, ${result.counts.medium} med, ${result.counts.low} low (${secs}s)`,
        );
      }
    } catch (error) {
      tally.failed++;
      const message = error instanceof Error ? error.message : String(error);
      const errResult: AuditResult = {
        program: degree.program,
        title: degree.title,
        level: degree.level,
        source: "",
        verdict: "error",
        summary: "",
        counts: { high: 0, medium: 0, low: 0, total: 0 },
        issues: [],
        model,
        auditedAt: new Date().toISOString(),
        error: message,
      };
      results.set(degree.program, errResult);
      await writeFile(path.join(OUT_DIR, `${degree.program}.md`), renderReportMarkdown(errResult), "utf8");
      console.error(`    ✖ failed: ${message}`);
    }

    // Persist after every degree so an interrupted run can resume.
    const ordered = [...results.values()].sort((a, b) =>
      a.program.localeCompare(b.program, undefined, { numeric: true }),
    );
    await writeFile(RESULTS_PATH, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
    await writeSummary(ordered);

    if (i < targets.length - 1 && args.delayMs > 0) await sleep(args.delayMs);
  }

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(
    [
      "",
      "──────── Audit complete ────────",
      `  matched:      ${tally.match}`,
      `  with issues:  ${tally.issues} (${tally.high} high-severity findings)`,
      `  failed:       ${tally.failed}`,
      `  elapsed:      ${elapsed} min`,
      `  summary:      docs/degree-audit/_summary.csv`,
      `  reports:      docs/degree-audit/<program>.md`,
    ].join("\n"),
  );

  const flagged = [...results.values()]
    .filter((r) => r.verdict === "issues" && r.counts.high > 0)
    .sort((a, b) => b.counts.high - a.counts.high)
    .slice(0, 15);
  if (flagged.length > 0) {
    console.log("\n  Top programs by high-severity findings:");
    for (const r of flagged) console.log(`    ${r.counts.high}× ${r.program} — ${r.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
