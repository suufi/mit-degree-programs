import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const DEGREES_ROOT = path.join(
  PROJECT_ROOT,
  "src/data/degrees-departments/drafts/degrees",
);
export const DOCS_DEGREES = path.join(PROJECT_ROOT, "docs/degrees");
export const HTML_OUT = path.join(PROJECT_ROOT, "tools/visualize/out");
export const REVIEW_ROOT = path.join(PROJECT_ROOT, "docs/review");
export const REVIEW_PROGRAMS = path.join(REVIEW_ROOT, "programs");

export type DegreeReviewRow = {
  group: string;
  program: string;
  title: string;
  level: string;
  catalogYear: string;
  complete: string;
  sourceType: string;
  sourceUrl: string;
  reviewPath: string;
  reviewUrl: string;
  markdownPath: string;
};

type ParsedArgs = {
  siteBase: string;
};

type DegreeSource = {
  url?: string;
};

type DegreeFile = {
  program?: string;
  title?: string;
  level?: string;
  catalogYear?: string | number;
  complete?: boolean;
  catalogSource?: DegreeSource | null;
  eecsSource?: DegreeSource | null;
};

export function walkJsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJsonFiles(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

export function prettyGroup(relDir: string, level: string, title: string): string {
  const courseMatch = relDir.match(/^course-(\d+)$/);
  if (courseMatch) return `Course ${courseMatch[1]}`;
  if (relDir.startsWith("phd-") || /doctoral/i.test(relDir) || /PhD|ScD/.test(title)) {
    return "PhD programs";
  }
  if (relDir.startsWith("master-") || relDir.startsWith("sm-") || relDir === "march") {
    return "Master's programs";
  }
  if (level === "graduate") return "Other graduate programs";
  return "Other undergraduate programs";
}

export function normalizeSiteBase(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

export function buildPublishedUrl(siteBase: string, reviewPath: string): string {
  if (!siteBase) return "";
  const relativeFromDocs = path.relative(path.join(PROJECT_ROOT, "docs"), path.join(PROJECT_ROOT, reviewPath));
  const webPath = relativeFromDocs.split(path.sep).join("/");
  return `${siteBase}/${webPath}`;
}

export function parseSiteArgs(argv: string[]): ParsedArgs {
  let siteBase = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--site-base" && argv[i + 1]) {
      siteBase = argv[++i];
    }
  }
  return {
    siteBase: normalizeSiteBase(siteBase || process.env.REVIEW_SITE_BASE || ""),
  };
}

export function collectDegreeReviewRows(siteBase = ""): DegreeReviewRow[] {
  const files = walkJsonFiles(DEGREES_ROOT).sort();
  const rows: DegreeReviewRow[] = [];

  for (const file of files) {
    let data: DegreeFile;
    try {
      data = JSON.parse(readFileSync(file, "utf8")) as DegreeFile;
    } catch {
      console.error(`Skipping unparseable file: ${file}`);
      continue;
    }

    if (!data.program) continue;

    const relDir = path.relative(DEGREES_ROOT, path.dirname(file));
    const source = data.catalogSource ?? data.eecsSource ?? null;
    const sourceType = data.catalogSource ? "catalog" : data.eecsSource ? "eecs" : "";

    const markdownAbs = path.join(DOCS_DEGREES, `${data.program}.md`);
    const reviewAbs = path.join(HTML_OUT, `${data.program}.html`);
    const markdownPath = existsSync(markdownAbs)
      ? path.relative(PROJECT_ROOT, markdownAbs)
      : "(not generated)";
    const reviewPath = existsSync(reviewAbs)
      ? path.relative(PROJECT_ROOT, path.join(REVIEW_PROGRAMS, `${data.program}.html`))
      : "(not generated)";

    rows.push({
      group: prettyGroup(relDir, data.level ?? "", data.title ?? ""),
      program: data.program,
      title: data.title ?? "",
      level: data.level ?? "",
      catalogYear: String(data.catalogYear ?? ""),
      complete: data.complete === true ? "yes" : "no",
      sourceType,
      sourceUrl: source?.url ?? "",
      reviewPath,
      reviewUrl: reviewPath === "(not generated)" ? "" : buildPublishedUrl(siteBase, reviewPath),
      markdownPath,
    });
  }

  return rows.sort(
    (a, b) =>
      a.group.localeCompare(b.group, undefined, { numeric: true }) ||
      a.program.localeCompare(b.program, undefined, { numeric: true }),
  );
}

export function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
