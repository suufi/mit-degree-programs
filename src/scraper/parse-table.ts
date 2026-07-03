import {
  extractSubjectIdsFromText,
  isItalicSectionHeader,
  isOrRow,
  parseSelectCount,
  stripItalic,
} from "./parse-subject";

export function parseMarkdownTableRows(tableBlock: string): string[][] {
  const lines = tableBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.match(/^\|[-\s|]+\|$/));
  return lines.map((line) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim()),
  );
}

const SUMMARY_ROW_RE =
  /^(units in major|unrestricted electives|total units|required subjects|physical education)/i;

export function isSummaryRow(firstCell: string): boolean {
  return SUMMARY_ROW_RE.test(firstCell.trim());
}

export function parseSubjectCell(cell: string): string[] {
  const normalized = cell
    .replace(/^or\s+/i, "")
    .replace(/<br\s*\/?>/gi, " & ");
  if (normalized.includes("&")) {
    const parts = normalized.split(/\s*&\s*/);
    const ids: string[] = [];
    for (const part of parts) {
      ids.push(...extractSubjectIdsFromText(part));
    }
    return ids;
  }
  return extractSubjectIdsFromText(normalized);
}

export function cellHasSubjectLink(cell: string): boolean {
  return /\/search\/\?P=/.test(cell);
}

export type ParsedTableRow =
  | { kind: "section"; title: string }
  | { kind: "instruction"; text: string }
  | { kind: "or" }
  | { kind: "subjects"; subjectIds: string[]; units?: string }
  | { kind: "choose_one"; options: string[][]; units?: string; label?: string; chooseN?: number }
  | { kind: "pool_union"; text: string; chooseN?: number; units?: string }
  | { kind: "choose_units"; text: string; units?: string; minUnits?: number; maxUnits?: number }
  | { kind: "prose"; text: string };

function parseUnitsRange(text: string): { minUnits?: number; maxUnits?: number } {
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) {
    return { minUnits: Number(range[1]), maxUnits: Number(range[2]) };
  }
  const single = text.match(/(\d+)/);
  if (single) {
    return { minUnits: Number(single[1]), maxUnits: Number(single[1]) };
  }
  return {};
}

function extractChooseN(text: string): number | undefined {
  const match = text.match(/select\s+(?:a\s+minimum\s+of\s+)?(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

const SECTION_HEADER_KEYWORDS =
  /\b(requirements?|electives?|programs?|options?|subjects?|laboratory|core|concentrations?|tracks?|thesis|seminars?|foundations?|restricted|departmental|modules?|specializations?|breadth|depth|areas?\s+of)\b/i;

// Lead words that indicate a prose/instruction line rather than a heading, e.g.
// "A laboratory subject of similar intensity…", "Select…", "Complete…".
const PROSE_LEAD_WORDS =
  /^(a\s|an\s|the\s|select\s|choose\s|complete\s|take\s|students?\s|include|not\s+more\s+than|up\s+to\s|at\s+least\s|one\s+of\s|two\s+of\s|three\s+of\s|all\s+of\s|any\s+of\s|for\s|to\s|with\s|from\s)/i;

/**
 * True for a table row that is a labelled group heading (no subjects, no units),
 * e.g. "Departmental Laboratory Requirement", "Restricted Electives", "Option 1".
 * Used to close the current group so later subject rows start a new one.
 */
function isSectionHeaderRow(cell: string): boolean {
  const text = stripItalic(cell.trim());
  if (!text || text.length > 90) return false;
  if (cellHasSubjectLink(cell)) return false;
  if (PROSE_LEAD_WORDS.test(text)) return false;
  if (/^option\s+\d+/i.test(text)) return true;
  if (SECTION_HEADER_KEYWORDS.test(text)) return true;
  // Short Title-Case phrase with no trailing sentence punctuation.
  const words = text.split(/\s+/);
  if (words.length <= 6 && !/[.:;]$/.test(text)) {
    const capitalized = words.filter((word) => /^[A-Z(]/.test(word)).length;
    if (capitalized >= Math.ceil(words.length * 0.6)) return true;
  }
  return false;
}

export function parseTableToRows(tableRows: string[][]): ParsedTableRow[] {
  const rows: ParsedTableRow[] = [];
  let chooseOneOptions: string[][] = [];
  let chooseOneUnits: string | undefined;
  let chooseOneLabel: string | undefined;
  let chooseCount = 1;
  let afterOr = false;

  const flushChooseOne = () => {
    if (chooseOneOptions.length > 0) {
      rows.push({
        kind: "choose_one",
        options: chooseOneOptions,
        units: chooseOneUnits,
        label: chooseOneLabel,
        ...(chooseCount > 1 ? { chooseN: chooseCount } : {}),
      });
    }
    chooseOneOptions = [];
    chooseOneUnits = undefined;
    chooseOneLabel = undefined;
    chooseCount = 1;
    afterOr = false;
  };

  for (const cells of tableRows) {
    if (cells.length < 1) continue;
    const first = cells[0] ?? "";
    const second = cells[1] ?? "";
    const third = cells[2] ?? "";

    if (!first && !second && !third) continue;
    if (isSummaryRow(first)) continue;

    if (isItalicSectionHeader(first)) {
      flushChooseOne();
      rows.push({ kind: "section", title: stripItalic(first) });
      continue;
    }

    const selectCount = parseSelectCount(first);
    if (selectCount !== undefined) {
      flushChooseOne();
      chooseOneUnits = second || third || undefined;
      chooseOneLabel = first;
      chooseCount = selectCount;
      continue;
    }

    if (isOrRow(first)) {
      afterOr = true;
      continue;
    }

    if (/select two subjects from any of the following lists/i.test(first)) {
      flushChooseOne();
      rows.push({
        kind: "pool_union",
        text: first,
        chooseN: extractChooseN(first) ?? 2,
        units: second || third || undefined,
      });
      continue;
    }

    if (
      /select\s+(?:a\s+minimum\s+of\s+)?\d+\s+units/i.test(first) ||
      (/units/i.test(second) && !cellHasSubjectLink(first) && !cellHasSubjectLink(second))
    ) {
      const text = cellHasSubjectLink(first) ? second : first;
      if (/units/i.test(text) || /consultation with advisor/i.test(first)) {
        flushChooseOne();
        const unitsText = second || third || first;
        rows.push({
          kind: "choose_units",
          text: first,
          ...parseUnitsRange(unitsText),
          units: unitsText,
        });
        continue;
      }
    }

    const subjectIds = parseSubjectCell(first);
    if (subjectIds.length > 0) {
      const units = second || third || undefined;
      if (chooseOneLabel || afterOr || /^or\s+/i.test(first)) {
        chooseOneOptions.push(subjectIds);
        afterOr = false;
        continue;
      }
      flushChooseOne();
      rows.push({ kind: "subjects", subjectIds, units });
      continue;
    }

    if (first && !first.match(/^(Units|Required Subjects)/i)) {
      flushChooseOne();
      const unitsCell = [second, third].find((cell) =>
        /^\(?\d+\s*(-\s*\d+)?\)?$/.test(cell.trim()),
      );
      const noUnits = !second?.trim() && !third?.trim();
      if (/^restricted electives\b/i.test(stripItalic(first.trim())) && !cellHasSubjectLink(second)) {
        rows.push({ kind: "section", title: first });
      } else if (noUnits && isSectionHeaderRow(first)) {
        // A labelled sub-heading such as "Departmental Laboratory Requirement"
        // or "Option 1" — acts as a group boundary so following subjects don't
        // leak into the previous group.
        rows.push({ kind: "section", title: first });
      } else if (unitsCell) {
        // Narrative elective whose unit count sits in a bare numeric column
        // (no subject links, no literal "units" word), e.g.
        // "Three subjects forming one intellectually coherent unit ... | 36".
        rows.push({
          kind: "choose_units",
          text: first,
          ...parseUnitsRange(unitsCell),
          units: unitsCell,
        });
      } else {
        rows.push({ kind: "prose", text: first });
      }
    }
  }

  flushChooseOne();
  return rows;
}

export function slugifyPoolTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/\+/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const aliases: Record<string, string> = {
    "biology-restricted-electives": "biore",
    "ai-d-advanced-undergraduate-subjects": "ai-d-aus",
    "computational-biology": "compbio",
    "grad-ai-d-aus": "grad-aid-aus",
    "biorev2": "biore",
    "compbiov2": "compbio",
  };
  return aliases[base] ?? base;
}
