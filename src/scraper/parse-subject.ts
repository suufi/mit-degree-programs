import { SUBJECT_ID_PATTERN } from "../schemas/enums";

const SUBJECT_ID_REGEX = new RegExp(SUBJECT_ID_PATTERN);
const LINK_PATTERN = /\/search\/\?P=([^)\s"]+)/g;
const STUDENT_CATALOG_LINK_PATTERN = /search\.cgi\?search=([^)\s"&]+)/g;
const AMP_PAIR_PATTERN = /&/;

export function normalizeSubjectId(raw: string): string | null {
  const cleaned = raw
    .replace(/\\\[J\\\]/g, "")
    .replace(/\[J\]/gi, "")
    .trim();
  return SUBJECT_ID_REGEX.test(cleaned) ? cleaned : null;
}

export function extractSubjectIdFromCell(cell: string): string | null {
  const ids = extractSubjectIdsFromText(cell);
  return ids[0] ?? null;
}

export function extractSubjectIdsFromText(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(LINK_PATTERN)) {
    const id = normalizeSubjectId(match[1] ?? "");
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  for (const match of text.matchAll(STUDENT_CATALOG_LINK_PATTERN)) {
    const id = normalizeSubjectId(match[1] ?? "");
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

export function extractSubjectGroupsFromCell(cell: string): string[][] {
  const text = cell.trim();
  if (!text) return [];

  if (AMP_PAIR_PATTERN.test(text)) {
    const parts = text.split("&").map((p) => extractSubjectIdsFromText(p)).filter((g) => g.length);
    if (parts.length >= 2) {
      return [parts.flat()];
    }
  }

  const ids = extractSubjectIdsFromText(text);
  return ids.length ? [ids] : [];
}

export function isItalicSectionHeader(cell: string): boolean {
  const text = stripItalic(cell.trim());
  if (isSelectNRow(text)) return false;
  return /^_[^_]+_$/.test(cell.trim()) || /^_.*_$/.test(cell.trim());
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Parses "Select two of the following" / "Choose three of the following" into
 * the count (2, 3, …). Returns undefined when the row is not a fixed-count
 * selection. The "…of the following options" variant (Option 1 / Option 2
 * blocks) is intentionally excluded — it is a nested choice handled elsewhere.
 */
export function parseSelectCount(cell: string): number | undefined {
  // Matches "Select two of the following", "Choose one of the following", and
  // "Select one undergraduate seminar from the following" (a short noun phrase
  // may sit between the count and "of/from the following"). The trailing
  // "…the following options" form (nested Option 1/Option 2 blocks) is excluded.
  const match = stripItalic(cell.trim()).match(
    /\b(?:select|choose)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?!units?\b|credits?\b)(?:[a-z][\w-]*\s+){0,4}(?:of|from)\s+the following(?!\s+options)/i,
  );
  if (!match) return undefined;
  const token = match[1]!.toLowerCase();
  return NUMBER_WORDS[token] ?? (Number(token) || undefined);
}

export function isSelectNRow(cell: string): boolean {
  return parseSelectCount(cell) !== undefined;
}

export function stripItalic(cell: string): string {
  return cell.trim().replace(/^_(.+)_$/, "$1").replace(/^_(.+)/, "$1").replace(/(.+)_$/, "$1");
}

export function isOrRow(firstCell: string): boolean {
  return firstCell.trim().toLowerCase() === "or";
}

export function isSelectOneRow(firstCell: string): boolean {
  return /select one of the following/i.test(firstCell);
}

export function isRestrictedElectivesRow(firstCell: string): boolean {
  return /select two subjects from any of the following lists/i.test(firstCell);
}
