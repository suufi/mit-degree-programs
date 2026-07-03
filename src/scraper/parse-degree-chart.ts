import {
  extractSubjectIdsFromText,
  isItalicSectionHeader,
  stripItalic,
} from "./parse-subject";
import {
  cellHasSubjectLink,
  parseMarkdownTableRows,
  parseSubjectCell,
  parseTableToRows,
  slugifyPoolTitle,
  type ParsedTableRow,
} from "./parse-table";

export type ParsedFootnote = { id: string; text: string };
export type ParsedPool = { slug: string; title: string; subjectIds: string[] };
export type ParsedGirCrosswalk = {
  subjectId: string;
  satisfies: Array<"science" | "hass" | "rest" | "lab" | "pe">;
  note?: string;
};

export type DepartmentalRow = ParsedTableRow;

export type DegreeChartAst = {
  level: "undergraduate" | "graduate";
  title: string;
  degreeTitle?: string;
  girCrosswalk: ParsedGirCrosswalk[];
  departmentalRows: DepartmentalRow[];
  pools: ParsedPool[];
  footnotes: ParsedFootnote[];
};

function extractCrosswalkFromGir(markdown: string): ParsedGirCrosswalk[] {
  const crosswalk: ParsedGirCrosswalk[] = [];
  const girSection = markdown.match(
    /### General Institute Requirements[\s\S]*?(?=### Departmental Program|## )/,
  );
  if (!girSection) return crosswalk;

  const restLine = girSection[0].match(/\(REST\)[^\n]+/i)?.[0];
  if (restLine?.includes("can be satisfied by")) {
    for (const subjectId of extractSubjectIdsFromText(restLine)) {
      crosswalk.push({
        subjectId,
        satisfies: ["rest"],
        note: "Also satisfies REST via departmental program.",
      });
    }
  }

  const restAlt = girSection[0].match(/REST\) Requirement[^\n]+/i)?.[0];
  if (restAlt?.includes("satisfied by")) {
    for (const subjectId of extractSubjectIdsFromText(restAlt)) {
      if (!crosswalk.some((entry) => entry.subjectId === subjectId)) {
        crosswalk.push({
          subjectId,
          satisfies: ["rest"],
          note: "Also satisfies REST via departmental program.",
        });
      }
    }
  }

  const labLine = girSection[0].match(/Laboratory Requirement[^\n]+/i)?.[0];
  if (labLine?.includes("can be satisfied by") || labLine?.includes("satisfied by")) {
    for (const subjectId of extractSubjectIdsFromText(labLine)) {
      crosswalk.push({
        subjectId,
        satisfies: ["lab"],
        note: "Also satisfies Laboratory Requirement via departmental program.",
      });
    }
  }

  return crosswalk;
}

function extractTitle(markdown: string): { title: string; degreeTitle?: string } {
  const h1 = markdown.match(/^# (.+)$/m)?.[1]?.trim();
  const h2 = markdown.match(/^## (.+)$/m)?.[1]?.trim();
  return {
    title: h1 ?? "Unknown Program",
    degreeTitle: h2,
  };
}

function isUndergraduate(markdown: string): boolean {
  return /### General Institute Requirements/i.test(markdown);
}

function extractTableBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.split("\n");
  let current: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      inTable = true;
      current.push(line);
      continue;
    }
    if (inTable) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [];
      inTable = false;
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function tableHasRequiredSubjectsHeader(tableBlock: string): boolean {
  return /Required Subjects/i.test(tableBlock);
}

function tableHasSubjectLinks(tableBlock: string): boolean {
  return /\/search\/\?P=/.test(tableBlock);
}

function parsePoolFromTable(tableBlock: string, title: string): ParsedPool | null {
  const rows = parseMarkdownTableRows(tableBlock);
  const subjectIds: string[] = [];
  for (const cells of rows) {
    for (const cell of cells) {
      subjectIds.push(...parseSubjectCell(cell));
    }
  }
  const unique = [...new Set(subjectIds)];
  if (unique.length === 0) return null;
  return { slug: slugifyPoolTitle(title), title, subjectIds: unique };
}

function parsePoolsFromSection(markdown: string, heading: string): ParsedPool | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`###\\s*\\*{0,2}${escaped}\\*{0,2}[\\s\\S]*?(?=\\n### |\\n## |\\nPrint Options|$)`, "i"),
  );
  if (!match) return null;

  const tableMatch = match[0].match(/\|[\s\S]*?(?=\n\n\| _\d+_|\n\n###|\n\nPrint|$)/);
  if (!tableMatch) return null;
  return parsePoolFromTable(tableMatch[0], heading);
}

function parseAllPoolSections(markdown: string): ParsedPool[] {
  const pools: ParsedPool[] = [];
  const seen = new Set<string>();

  const headings = markdown.matchAll(/^###\s*\*{0,2}(.+?)\*{0,2}\s*$/gm);
  for (const match of headings) {
    const heading = match[1]!.trim();
    if (/general institute requirements|departmental program/i.test(heading)) continue;
    const pool = parsePoolsFromSection(markdown, heading);
    if (pool && !seen.has(pool.slug)) {
      seen.add(pool.slug);
      pools.push(pool);
    }
  }

  return pools;
}

function parseSecondaryElectiveTables(markdown: string): ParsedPool[] {
  const pools: ParsedPool[] = [];
  const blocks = extractTableBlocks(markdown);
  for (const block of blocks) {
    if (!/Restricted Electives/i.test(block) || !tableHasSubjectLinks(block)) continue;
    if (/^\| _\d+_ \|/m.test(block)) continue;
    const rows = parseMarkdownTableRows(block);
    if (rows.some((cells) => /required subjects/i.test(cells[0] ?? ""))) continue;
    if (!rows.some((cells) => isItalicSectionHeader(cells[0] ?? ""))) continue;

    let currentSection = "Restricted Electives";
    const sectionSubjects = new Map<string, string[]>();

    for (const cells of rows) {
      const first = cells[0] ?? "";
      if (isItalicSectionHeader(first)) {
        currentSection = stripItalic(first);
        continue;
      }
      const ids = parseSubjectCell(first);
      if (ids.length > 0) {
        const bucket = sectionSubjects.get(currentSection) ?? [];
        bucket.push(...ids);
        sectionSubjects.set(currentSection, bucket);
      }
    }

    for (const [title, subjectIds] of sectionSubjects) {
      if (/^restricted electives$/i.test(title)) continue;
      const unique = [...new Set(subjectIds)];
      if (unique.length === 0) continue;
      pools.push({
        slug: slugifyPoolTitle(title),
        title,
        subjectIds: unique,
      });
    }
  }
  return pools;
}

function poolFromInlineChooseOneSection(
  sectionTitle: string,
  rows: DepartmentalRow[],
): ParsedPool | null {
  const chooseOne = rows.find((row) => row.kind === "choose_one");
  if (!chooseOne || chooseOne.kind !== "choose_one") return null;

  const subjectIds = [...new Set(chooseOne.options.flat())];
  if (subjectIds.length === 0) return null;

  return {
    slug: slugifyPoolTitle(sectionTitle),
    title: sectionTitle,
    subjectIds,
  };
}

function parseDepartmentalProgram(markdown: string): DepartmentalRow[] {
  const deptMatch = markdown.match(
    /### Departmental Program[\s\S]*?(?=\n### [^#]|\n## [^#]|\nPrint Options|$)/,
  );
  if (!deptMatch) return [];

  const blocks = extractTableBlocks(deptMatch[0]);
  const rows: DepartmentalRow[] = [];
  for (const block of blocks) {
    if (/^\| _\d+_ \|/m.test(block)) continue;
    if (!tableHasRequiredSubjectsHeader(block) && !tableHasSubjectLinks(block)) continue;
    if (/Summary of Subject Requirements/i.test(block)) continue;
    if (/^Restricted Electives\s*\|/m.test(block) && rows.length > 0) break;
    rows.push(...parseTableToRows(parseMarkdownTableRows(block)));
  }
  return rows;
}

function parseGradProgram(markdown: string): DepartmentalRow[] {
  const body = markdown.split(/Print Options/i)[0] ?? markdown;
  const blocks = extractTableBlocks(body);
  const rows: DepartmentalRow[] = [];

  for (const block of blocks) {
    if (!tableHasSubjectLinks(block)) continue;
    if (/Summary of Subject Requirements/i.test(block)) continue;
  const parsed = parseTableToRows(parseMarkdownTableRows(block));
    if (parsed.length > 0) {
      rows.push(...parsed);
      if (tableHasRequiredSubjectsHeader(block)) break;
    }
  }
  return rows;
}

function stripMarkdownLinks(text: string): string {
  return text
    .replace(/^_|_$/g, "")
    .replace(/\\\[J\\\]/g, "")
    .replace(/\[J\]/gi, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\/g, "")
    .trim();
}

function parseFootnotes(markdown: string): ParsedFootnote[] {
  const footnotes: ParsedFootnote[] = [];
  const seen = new Set<string>();
  const footnoteTable = markdown.match(/\| _(\d+)_ \|[\s\S]*?(?=\n\n###|\n\nPrint|$)/g);
  if (!footnoteTable) return footnotes;

  for (const block of footnoteTable) {
    const rows = parseMarkdownTableRows(block);
    for (const cells of rows) {
      const idMatch = cells[0]?.match(/_(\d+)_/);
      const text = cells[1] ? stripMarkdownLinks(cells[1]) : "";
      if (idMatch && text && !seen.has(idMatch[1]!)) {
        seen.add(idMatch[1]!);
        footnotes.push({ id: idMatch[1]!, text });
      }
    }
  }
  return footnotes;
}

function mergePools(...poolGroups: ParsedPool[][]): ParsedPool[] {
  const bySlug = new Map<string, ParsedPool>();
  for (const pool of poolGroups.flat()) {
    const existing = bySlug.get(pool.slug);
    if (!existing) {
      bySlug.set(pool.slug, { ...pool, subjectIds: [...new Set(pool.subjectIds)] });
      continue;
    }
    existing.subjectIds = [...new Set([...existing.subjectIds, ...pool.subjectIds])];
  }
  return [...bySlug.values()];
}

function inlinePoolsFromDepartmentalRows(
  rows: DepartmentalRow[],
  poolUnionText?: string,
): ParsedPool[] {
  const pools: ParsedPool[] = [];
  let inRestrictedElectives = false;
  let currentSection: string | undefined;
  let sectionRows: DepartmentalRow[] = [];

  const sectionReferencedInUnion = (title: string): boolean => {
    if (!poolUnionText) return true;
    const haystack = poolUnionText.toLowerCase();
    const words = title.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
    return words.some((word) => haystack.includes(word));
  };

  const flush = () => {
    if (!currentSection || !inRestrictedElectives || !sectionReferencedInUnion(currentSection)) {
      sectionRows = [];
      return;
    }
    const pool = poolFromInlineChooseOneSection(currentSection, sectionRows);
    if (pool) pools.push(pool);
    sectionRows = [];
  };

  for (const row of rows) {
    if (row.kind === "section") {
      if (/^restricted electives$/i.test(row.title)) {
        inRestrictedElectives = true;
        flush();
        currentSection = undefined;
        continue;
      }
      if (inRestrictedElectives && !/select one of the following/i.test(row.title)) {
        flush();
        currentSection = row.title;
        continue;
      }
      flush();
      inRestrictedElectives = false;
      currentSection = undefined;
      continue;
    }
    if (currentSection && inRestrictedElectives) sectionRows.push(row);
  }
  flush();
  return pools;
}

export function parseDegreeChartMarkdown(markdown: string): DegreeChartAst {
  const level = isUndergraduate(markdown) ? "undergraduate" : "graduate";
  const { title, degreeTitle } = extractTitle(markdown);
  const girCrosswalk = level === "undergraduate" ? extractCrosswalkFromGir(markdown) : [];
  const departmentalRows =
    level === "undergraduate" ? parseDepartmentalProgram(markdown) : parseGradProgram(markdown);

  const sectionPools = parseAllPoolSections(markdown);
  const secondaryPools = parseSecondaryElectiveTables(markdown);
  const poolUnionRow = departmentalRows.find((row) => row.kind === "pool_union");
  const poolUnionText = poolUnionRow?.kind === "pool_union" ? poolUnionRow.text : undefined;
  const inlinePools = inlinePoolsFromDepartmentalRows(departmentalRows, poolUnionText);
  const pools = mergePools(sectionPools, secondaryPools, inlinePools);
  const footnotes = parseFootnotes(markdown);

  return {
    level,
    title,
    degreeTitle,
    girCrosswalk,
    departmentalRows,
    pools,
    footnotes,
  };
}

export type DegreeChartOption = {
  /** Human label as printed on the tab, e.g. "Flexible Option", "Applied Mathematics Option". */
  optionLabel: string;
  /** Short id suffix derived from the label, e.g. "flexible", "applied", "pure". */
  optionSlug: string;
  /** Self-contained markdown for this option (page H1 title + this option body). */
  markdown: string;
};

function optionSlugFromLabel(label: string): string {
  const cleaned = label.replace(/\b(option|track)\b/gi, "").trim();
  const firstWord = cleaned.split(/\s+/)[0] ?? cleaned;
  const slug = firstWord
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "option";
}

/**
 * Split a catalog degree chart that offers several named options/tracks
 * (e.g. Physics Focused vs Flexible; Math General/Applied/Pure) into one
 * markdown segment per option.
 *
 * Each segment keeps the page `# H1` title (so the downstream parser still
 * resolves the program title) followed by that option's
 * `## Bachelor of Science ... (Option)` body — which carries its own GIR
 * summary, Departmental Program, restricted-elective pools, and footnotes.
 *
 * Returns `[]` for single-option undergraduate charts (and anything that is not
 * an undergraduate chart) so callers can fall back to the normal single parse.
 */
export function splitDegreeChartOptions(markdown: string): DegreeChartOption[] {
  if (!isUndergraduate(markdown)) return [];

  const h1 = markdown.match(/^# .+$/m)?.[0] ?? "";
  const segments: DegreeChartOption[] = [];
  const seenSlugs = new Set<string>();

  for (const part of markdown.split(/(?=^## )/m)) {
    if (!/^## /.test(part)) continue;
    if (!/### Departmental Program/.test(part)) continue;

    const h2 = part.match(/^## (.+)$/m)?.[1]?.trim() ?? "";
    const optionLabel = h2.match(/\(([^)]+)\)/)?.[1]?.trim() ?? h2;

    let optionSlug = optionSlugFromLabel(optionLabel);
    if (seenSlugs.has(optionSlug)) {
      optionSlug = optionLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
    seenSlugs.add(optionSlug);

    const body = part.replace(/\s+$/, "");
    segments.push({
      optionLabel,
      optionSlug,
      markdown: h1 ? `${h1}\n\n${body}` : body,
    });
  }

  return segments.length >= 2 ? segments : [];
}

export function subjectNode(subjectId: string) {
  const cleaned = subjectId.replace(/\[J\]/gi, "").trim();
  return { type: "subject" as const, subjectId: cleaned };
}
