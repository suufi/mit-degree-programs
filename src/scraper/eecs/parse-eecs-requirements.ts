import type { Level, RequirementNode } from "../../schemas/types";
import { makeSharedListId } from "../../schemas/shared-lists";
import { extractSubjectIdsFromText, normalizeSubjectId } from "../parse-subject";
import { subjectNode } from "../parse-degree-chart";
import { slugifyPoolTitle } from "../parse-table";

export type EecsTrack = {
  areas: string[];
  title: string;
  slug: string;
  subjectIds: string[];
};

/**
 * An entry in an EECS subject list. `subject` is a single course; `group`
 * models a `&`-joined pair from the source markdown (e.g. `7.093 & 7.094`)
 * that must be taken together to satisfy the slot.
 */
export type EecsSubjectListItem =
  | { kind: "subject"; subjectId: string }
  | { kind: "group"; subjectIds: string[] };

export type EecsSubjectList = {
  slug: string;
  title: string;
  /** Structured list preserving `&` pair semantics from the source page. */
  items: EecsSubjectListItem[];
  /**
   * Flattened distinct subject IDs. Retained for consumers (elective rule
   * resolution, tests, older writers) that don't need pair grouping.
   */
  subjectIds: string[];
};

export type EecsElectiveRule = {
  text: string;
  chooseN: number;
  trackFilter?: "cs" | "aid-cs-ee" | "ee";
  differentTrack?: boolean;
  listSlugs?: string[];
  explicitSubjectIds?: string[];
  /** Requirement group title when parsed from an embedded elective bullet. */
  groupTitle?: string;
};

export type EecsRequirementsAst = {
  programId: string;
  /** Page key like 6-3_2025 (program + entering year). */
  programKey?: string;
  enterYear?: number;
  level?: Level;
  pageTitle?: string;
  tracks: EecsTrack[];
  subjectLists: EecsSubjectList[];
  electiveRules: EecsElectiveRule[];
  additionalConstraints: string[];
  notes: string[];
  requiredRoot?: RequirementNode;
  sourceUrl?: string;
};

const TRACK_HEADER_RE = /\*\*\\\[([^\]]+)\\\]\s*([^*]+?)\*\*/g;
const SUBJECT_LIST_HEADER_RE = /\*\*([^*\n]+?)\*\*:/g;
const ELECTIVE_SECTION_RE =
  /\b(?:One|Two|Three|Four|Five|Six|\d+) \*\*elective\*\* subjects/i;
const ELECTIVE_BULLET_RE =
  /\b(?:One|Two|Three|Four|Five|Six|\d+) \*\*[^*]*elective[^*]*\*\*/i;
const BARE_SUBJECT_ID = "(?:[0-9]{1,2}[A-Z]?|CC)\\.[0-9A-Z]{1,4}[A-Z]?";
const BARE_SUBJECT_RE = new RegExp(`\\b(${BARE_SUBJECT_ID})\\b`, "g");

const PAGE_HEADER_RE =
  /#{0,3}\s*Degree Requirements for\s+([^\s]+?)(?:\\_|_)(\d{4})[ \t]*(?:\n\s*)?(SB|MNG)\s+in\s+([^\n]+)/i;

export {
  eecsUrlForProgram,
  isEecsSourcedProgram,
  isEecsEnrichableProgram,
  catalogProgramIdFromEecs,
  eecsUrlProgramId,
} from "./eecs-program-ids";

function uniqueSubjectIds(text: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const id of extractSubjectIdsFromText(text)) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  for (const match of text.matchAll(BARE_SUBJECT_RE)) {
    const id = normalizeSubjectId(match[1] ?? "");
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

// Remove `Prereqs: … Units:` / `Prereqs/[Coreqs]: … Units:` clauses so their
// subject ids are not mistaken for listed requirement options. Every catalog
// entry terminates its prereq clause with the "Units:" token.
function stripPrereqClauses(text: string): string {
  return text.replace(/Prereq[\s\S]*?Units:/gi, " Units:");
}

// Bold catalog headers (`**6.1220 Design and Analysis of Algorithms**`) open
// with the listed subject id; prereqs and old-number prefixes never appear in
// bold, so bold + anchor is the authoritative "which subjects are listed"
// signal. `SAME_AS_RE` captures "Same subject as …" cross-listings.
const SAME_AS_RE = /[Ss]ame subject as ([^)]*)\)/g;

/**
 * Subject ids a required-subjects bullet actually *lists*, in reading order.
 *
 * Reads bold catalog headers, catalog anchors, and "Same subject as …"
 * cross-listings after stripping prerequisite clauses — so entries like
 * 6.1210's `Prereqs: 6.100A …` or CC.512's `[CC.010, CC.011, or CC.A10]`
 * no longer leak into the option list. Falls back to bare extraction only
 * when no structured id is present (still prereq-stripped).
 */
function listedSubjectIds(text: string): string[] {
  const cleaned = stripPrereqClauses(text);
  const seen = new Set<string>();
  const ids: string[] = [];
  const push = (raw: string): void => {
    const id = normalizeSubjectId(raw);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };

  // Positional scan: bold headers and anchors in the order they appear.
  const combined = new RegExp(
    `\\*\\*\\s*(${BARE_SUBJECT_ID})\\b|search\\.cgi\\?search=(${BARE_SUBJECT_ID})`,
    "g",
  );
  for (const match of cleaned.matchAll(combined)) {
    push(match[1] ?? match[2] ?? "");
  }

  // Cross-listings ("Same subject as X, Y").
  for (const match of cleaned.matchAll(SAME_AS_RE)) {
    for (const inner of (match[1] ?? "").matchAll(BARE_SUBJECT_RE)) {
      push(inner[1] ?? "");
    }
  }

  if (ids.length === 0) return uniqueSubjectIds(cleaned);
  return ids;
}

// Convert a pair-aware subject-list item into a requirement node. `&`-joined
// pairs (e.g. 6.100A & 6.100B) become an all_of group so they stay a single
// combined option inside a choose-one.
function subjectListItemToNode(item: EecsSubjectListItem): RequirementNode {
  if (item.kind === "group") {
    return {
      type: "group",
      ruleType: "all_of",
      items: item.subjectIds.map((id) => subjectNode(id)),
    };
  }
  return subjectNode(item.subjectId);
}

// "One of" marker. The trailing negative lookahead rejects "One office" while
// still matching the source's space-less "One of6.1903" joins.
const ONE_OF_RE = /\bOne of(?![a-z])/i;

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && /^[|\s:-]+$/.test(t) && t.includes("-");
}

// Structured, pair-aware options from a choice fragment: prefer catalog anchors
// (keeps `X & Y` pairs), else fall back to bold-header / bare ids.
function parseChoiceOptions(text: string): EecsSubjectListItem[] {
  const anchored = parseSubjectListBody(text);
  if (anchored.items.length > 0) return anchored.items;
  return listedSubjectIds(text).map((id) => ({ kind: "subject", subjectId: id }));
}

function parsePageHeader(markdown: string): Pick<
  EecsRequirementsAst,
  "programKey" | "enterYear" | "level" | "pageTitle"
> {
  const match = markdown.match(PAGE_HEADER_RE);
  if (!match) return {};

  const programPart = (match[1] ?? "").replace(/\\/g, "");
  const enterYear = Number.parseInt(match[2] ?? "", 10);
  const degreeType = match[3]?.toUpperCase();
  const title = (match[4] ?? "").trim();

  return {
    programKey: `${programPart}_${enterYear}`,
    enterYear: Number.isFinite(enterYear) ? enterYear : undefined,
    level: degreeType === "MNG" ? "graduate" : "undergraduate",
    pageTitle: title ? `${title} (Course ${programPart})` : undefined,
  };
}

function findElectiveSectionStart(markdown: string): number {
  return markdown.search(ELECTIVE_SECTION_RE);
}

function findRequiredSectionEnd(markdown: string): number {
  const elective = findElectiveSectionStart(markdown);
  const tracks = markdown.search(/\bTracks\b/i);

  if (elective >= 0) {
    if (tracks >= 0 && tracks > elective) return Math.min(elective, tracks);
    return elective;
  }

  const notes = markdown.search(/_Notes:_/i);
  const lists = markdown.indexOf("### Subject Lists");
  if (notes >= 0) {
    if (lists >= 0) return Math.min(notes, lists);
    return notes;
  }
  if (tracks >= 0) return tracks;
  if (lists >= 0) return lists;
  return -1;
}

function isElectiveCategoryBullet(bullet: string): boolean {
  if (ELECTIVE_SECTION_RE.test(bullet)) return true;
  return ELECTIVE_BULLET_RE.test(bullet);
}

function collectRequirementBullets(section: string): string[] {
  const bullets: string[] = [];
  let current = "";
  let inBullet = false;

  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (/^-\s*$/.test(trimmed)) {
      if (inBullet && current.trim()) bullets.push(current.trim());
      current = "";
      inBullet = true;
      continue;
    }
    if (/^[-*]\s+\S/.test(trimmed) && !/^\*\s+\*\s+\*/.test(trimmed)) {
      if (inBullet && current.trim()) bullets.push(current.trim());
      current = trimmed.replace(/^[-*]\s+/, "");
      inBullet = true;
      continue;
    }
    if (inBullet) {
      current += `${current ? "\n" : ""}${line}`;
    }
  }
  if (inBullet && current.trim()) bullets.push(current.trim());
  return bullets;
}

function parseChooseNFromTitle(bullet: string): number | undefined {
  const match = bullet.match(/^(\w+) \*\*([^*]+)\*\*/i);
  if (!match) return undefined;
  const word = match[1]!.toLowerCase();
  const counts: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  };
  return counts[word];
}

function titleLine(bullet: string): string {
  for (const line of bullet.split("\n")) {
    if (line.trim().length > 0) return line.trim();
  }
  return bullet.trim();
}

/**
 * Line-based parse of a "One of"-bearing required bullet.
 *
 * The source interleaves choose-one clauses ("One of A, B" — sometimes written
 * space-less as "One of6.1903") with mandatory subjects on their own lines
 * (e.g. header's 6.1020, bio's 7.06) and with option tables that follow a bare
 * "One of" marker line. Each "One of" yields a choose_one; every other listed
 * subject is mandatory, and `&`-joined pairs stay grouped.
 */
function parseOneOfBulletBody(bullet: string): RequirementNode[] {
  const lines = bullet
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const built: RequirementNode[] = [];
  const pushChoice = (opts: EecsSubjectListItem[]): void => {
    if (opts.length === 0) return;
    built.push({
      type: "selection",
      ruleType: "choose_one",
      itemsSource: "explicit",
      items: opts.map(subjectListItemToNode),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isSeparatorRow(line)) continue;

    if (ONE_OF_RE.test(line)) {
      const segments = line.split(ONE_OF_RE);
      // Text before the first "One of" is mandatory (or the bullet title).
      for (const item of parseChoiceOptions(segments[0] ?? "")) {
        built.push(subjectListItemToNode(item));
      }
      for (let s = 1; s < segments.length; s++) {
        let optsText = segments[s]!;
        // Bare "One of" marker → options live in the following table row(s).
        if (parseChoiceOptions(optsText).length === 0 && s === segments.length - 1) {
          const collected: string[] = [];
          let j = i + 1;
          while (j < lines.length && isTableRow(lines[j]!)) {
            if (!isSeparatorRow(lines[j]!)) collected.push(lines[j]!);
            j++;
          }
          if (collected.length > 0) {
            optsText = collected.join(" ");
            i = j - 1;
          }
        }
        pushChoice(parseChoiceOptions(optsText));
      }
      continue;
    }

    // A standalone option table (not tied to a "One of" marker) is still a
    // choose-one set; any other plain line lists mandatory subjects.
    if (isTableRow(line)) {
      pushChoice(parseChoiceOptions(line));
      continue;
    }
    for (const item of parseChoiceOptions(line)) {
      built.push(subjectListItemToNode(item));
    }
  }

  return built;
}

function parseRequiredBullet(
  bullet: string,
  programId: string,
): RequirementNode[] {
  const nodes: RequirementNode[] = [];
  const chooseN = parseChooseNFromTitle(bullet);
  const label = bullet.match(/\*\*([^*]+)\*\*/)?.[1] ?? "";

  if (/center/i.test(label) && chooseN === 5) {
    const ids = listedSubjectIds(bullet);
    if (ids.length > 0) {
      nodes.push({
        type: "selection",
        ruleType: "choose_n",
        ruleValue: 5,
        itemsSource: "shared_list",
        sharedListId: makeSharedListId(programId, "center-subjects"),
        note: "Five Center subjects",
      });
    }
    return nodes;
  }

  if (ONE_OF_RE.test(bullet)) {
    const built = parseOneOfBulletBody(bullet);

    // A titled multi-subject bullet ("Two introductory subjects", "Three header
    // subjects") groups the choices together with the mandatory subjects.
    if (chooseN != null && chooseN >= 2 && built.length >= 2) {
      const note = titleLine(bullet)
        .replace(/\*+/g, "")
        .replace(/[:\s]+$/, "")
        .trim();
      nodes.push({
        type: "group",
        ruleType: "all_of",
        note: note || undefined,
        items: built,
      });
    } else {
      nodes.push(...built);
    }
    return nodes;
  }

  const ids = listedSubjectIds(bullet);
  if (ids.length === 0) return nodes;

  if (chooseN === 2 && /foundation/i.test(label)) {
    nodes.push({
      type: "group",
      ruleType: "all_of",
      note: "Two foundation subjects",
      items: ids.slice(0, 2).map((id) => subjectNode(id)),
    });
    return nodes;
  }

  if (chooseN === 1 || /^one \*\*/i.test(bullet)) {
    nodes.push({
      type: "selection",
      ruleType: "choose_one",
      itemsSource: "explicit",
      items: ids.map((id) => subjectNode(id)),
    });
    return nodes;
  }

  if (chooseN != null && ids.length === chooseN) {
    nodes.push({
      type: "group",
      ruleType: "all_of",
      note: bullet.split("\n")[0],
      items: ids.map((id) => subjectNode(id)),
    });
    return nodes;
  }

  if (chooseN != null && ids.length > chooseN) {
    nodes.push({
      type: "selection",
      ruleType: "choose_n",
      ruleValue: chooseN,
      itemsSource: "explicit",
      items: ids.map((id) => subjectNode(id)),
      note: bullet.split("\n")[0],
    });
    return nodes;
  }

  if (/&/.test(bullet) && ids.length >= 2) {
    nodes.push({
      type: "group",
      ruleType: "all_of",
      items: ids.map((id) => subjectNode(id)),
    });
    return nodes;
  }

  for (const id of ids) {
    nodes.push(subjectNode(id));
  }
  return nodes;
}

function parseRequiredSubjects(
  markdown: string,
  programId: string,
): {
  root?: RequirementNode;
  centerSubjectIds?: string[];
  embeddedElectiveBullets: string[];
} {
  const start = markdown.search(/_Required subjects:_/i);
  if (start < 0) return { embeddedElectiveBullets: [] };

  const end = findRequiredSectionEnd(markdown);
  const section = markdown.slice(start, end >= 0 ? end : undefined);
  const bullets = collectRequirementBullets(section);
  const items: RequirementNode[] = [];
  const embeddedElectiveBullets: string[] = [];
  let centerSubjectIds: string[] | undefined;

  for (const bullet of bullets) {
    if (isElectiveCategoryBullet(bullet)) {
      embeddedElectiveBullets.push(bullet);
      continue;
    }

    const chooseN = parseChooseNFromTitle(bullet);
    const label = bullet.match(/\*\*([^*]+)\*\*/)?.[1] ?? "";
    if (/center/i.test(label) && chooseN === 5) {
      centerSubjectIds = listedSubjectIds(bullet);
    }
    items.push(...parseRequiredBullet(bullet, programId));
  }

  if (items.length === 0) {
    return { centerSubjectIds, embeddedElectiveBullets };
  }
  return {
    root: { type: "group", ruleType: "all_of", items },
    centerSubjectIds,
    embeddedElectiveBullets,
  };
}

function parseTrackSection(markdown: string): EecsTrack[] {
  const tracksStart = markdown.search(/\bTracks\b/i);
  const listsStart = markdown.indexOf("### Subject Lists");
  if (tracksStart < 0) return [];

  const section = markdown.slice(
    tracksStart,
    listsStart >= 0 ? listsStart : undefined,
  );
  const tracks: EecsTrack[] = [];
  const seen = new Set<string>();

  for (const match of section.matchAll(TRACK_HEADER_RE)) {
    const areasRaw = match[1] ?? "";
    const title = (match[2] ?? "").replace(/\\_/g, "_").trim();
    if (!title) continue;

    const start = match.index ?? 0;
    const next = section.slice(start + match[0].length);
    const nextHeader = next.search(/\*\*\\\[/);
    const body = nextHeader >= 0 ? next.slice(0, nextHeader) : next;
    // Use the "listed" extractor (bold headers + anchors + cross-listings,
    // prereq-stripped) so prerequisite/description-text subject numbers don't
    // leak into the track elective list.
    const subjectIds = listedSubjectIds(body);
    if (subjectIds.length === 0) continue;

    const slug = slugifyPoolTitle(title);
    if (seen.has(slug)) continue;
    seen.add(slug);

    tracks.push({
      areas: areasRaw.split(",").map((area) => area.trim()),
      title,
      slug: `track-${slug}`,
      subjectIds,
    });
  }

  return tracks;
}

// Anchor pattern for catalog links (`](.../search.cgi?search=<id>)`), plus the
// short run of text that follows before the next `[`, `|`, or newline. The
// trailing run is inspected for a bare `&` to detect `X & Y` pair-groupings
// like `7.093 & 7.094` in the source page.
const CATALOG_ANCHOR_WITH_CONNECTOR_RE =
  /\]\((?:https?:\/\/)?student\.mit\.edu\/catalog\/search\.cgi\?search=([^)]+)\)([^[|\n]*)/g;

/**
 * Extract structured items from a subject-list cell body.
 *
 * Algorithm:
 *   1. Match every catalog anchor and read whether the trailing text contains
 *      an `&` (the source page joins pair-requirements with `X & Y`).
 *   2. Collapse consecutive duplicate anchors for the same subject id into a
 *      single logical entry. MIT catalog pages emit each subject as an
 *      empty-label anchor immediately followed by a fully-decorated anchor,
 *      and the `&` may live on either one — the collapsed entry ORs the flags.
 *   3. Walk the collapsed list, treating an `&`-flagged entry as pair-joined
 *      to the NEXT collapsed entry only. This preserves the fact that
 *      `6.100A & 16.C20`, `6.100A & 18.C20`, ... are multiple *separate*
 *      pair-options that happen to share a member, rather than one giant
 *      chain across all of them.
 *   4. Deduplicate final items: singleton subjects use their id as the key,
 *      groups use their sorted member-ids so equivalent pairs collapse.
 */
function parseSubjectListBody(body: string): {
  items: EecsSubjectListItem[];
  subjectIds: string[];
} {
  const rawAnchors: Array<{ id: string; grouped: boolean }> = [];
  for (const match of body.matchAll(CATALOG_ANCHOR_WITH_CONNECTOR_RE)) {
    const raw = decodeURIComponent(match[1] ?? "");
    const id = normalizeSubjectId(raw);
    if (!id) continue;
    rawAnchors.push({ id, grouped: /&/.test(match[2] ?? "") });
  }

  const collapsed: Array<{ id: string; grouped: boolean }> = [];
  for (const anchor of rawAnchors) {
    const prev = collapsed.at(-1);
    if (prev && prev.id === anchor.id) {
      prev.grouped = prev.grouped || anchor.grouped;
    } else {
      collapsed.push({ ...anchor });
    }
  }

  const items: EecsSubjectListItem[] = [];
  const seenSingletons = new Set<string>();
  const seenGroups = new Set<string>();
  const flat = new Set<string>();

  for (let i = 0; i < collapsed.length; i++) {
    const cur = collapsed[i]!;
    flat.add(cur.id);
    if (cur.grouped && i + 1 < collapsed.length) {
      const next = collapsed[i + 1]!;
      flat.add(next.id);
      const members = [cur.id, next.id];
      const key = [...members].sort().join("+");
      if (!seenGroups.has(key)) {
        seenGroups.add(key);
        items.push({ kind: "group", subjectIds: members });
      }
      i += 1; // consume paired anchor
      continue;
    }
    if (!seenSingletons.has(cur.id)) {
      seenSingletons.add(cur.id);
      items.push({ kind: "subject", subjectId: cur.id });
    }
  }

  return { items, subjectIds: [...flat] };
}

function parseSubjectLists(markdown: string): EecsSubjectList[] {
  const listsStart = markdown.indexOf("### Subject Lists");
  if (listsStart < 0) return [];

  const section = markdown.slice(listsStart);
  const headers = [...section.matchAll(SUBJECT_LIST_HEADER_RE)];
  const lists: EecsSubjectList[] = [];

  for (let i = 0; i < headers.length; i++) {
    const match = headers[i]!;
    const rawName = (match[1] ?? "").replace(/\\_/g, "_").trim();
    if (!rawName || rawName === "EECS Degree Requirements") continue;

    const start = (match.index ?? 0) + match[0].length;
    const end = headers[i + 1]?.index ?? section.length;
    const body = section.slice(start, end);
    const { items, subjectIds } = parseSubjectListBody(body);
    if (items.length === 0) continue;

    lists.push({
      slug: slugifyPoolTitle(rawName),
      title: rawName,
      items,
      subjectIds,
    });
  }

  return lists;
}

function extractElectivePoolIds(text: string): string[] {
  const fromCatalogLinks = [
    ...text.matchAll(/search\.cgi\?search=([^)&\s]+)/g),
  ]
    .map((match) => normalizeSubjectId(decodeURIComponent(match[1] ?? "")))
    .filter(Boolean);

  if (fromCatalogLinks.length > 0) {
    const seen = new Set<string>();
    return fromCatalogLinks.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  return uniqueSubjectIds(text);
}

function parseListNamesFromElectiveRule(text: string): string[] {
  const fromLinks = [...text.matchAll(/\]\([^)]*#([^)]+)\)/g)].map((match) =>
    decodeURIComponent((match[1] ?? "").replace(/\\_/g, "_")).trim(),
  );
  if (fromLinks.length > 0) return fromLinks;

  const match = text.match(/(?:one|two) from the (.+?) list/i);
  if (!match) return [];
  return (match[1] ?? "")
    .split(/,\s*|\s+or\s+/i)
    .map((part) => part.replace(/\\_/g, "_").trim())
    .filter(Boolean);
}

function resolveSubjectListSlugs(
  names: string[],
  subjectLists: EecsSubjectList[],
): string[] {
  const bySlug = new Map(subjectLists.map((list) => [list.slug, list]));
  const aliases = new Map<string, string>([
    ["grad-aus2", "aus2"],
    ["grad-aus", "aus2"],
    ["grad-ii", "ii"],
    ["grad-aid-aus", "grad-aid-aus"],
    ["grad-ai-d-aus", "grad-aid-aus"],
    ["application-cim", "application-cim"],
    ["ai-d-aus", "ai-d-aus"],
    ["ai-d-serc", "ai-d-serc"],
    ["model-centric", "model-centric"],
    ["data-centric", "data-centric"],
    ["decision-centric", "decision-centric"],
    ["computation-centric", "computation-centric"],
    ["human-centric", "human-centric"],
    ["biorev2", "biore"],
    ["compbiov2", "compbio"],
    ["econds", "econds"],
    ["econth", "econth"],
    ["plab", "plab"],
    ["meng-restricted-electives", "meng-restricted-electives"],
    ["econ-math-restricted-electives", "econ-math-restricted-electives"],
  ]);

  const resolved: string[] = [];
  for (const raw of names) {
    const slug = slugifyPoolTitle(raw);
    const canonical = aliases.get(slug) ?? slug;
    const list = bySlug.get(canonical) ?? bySlug.get(slug);
    if (list && !resolved.includes(list.slug)) {
      resolved.push(list.slug);
    }
  }
  return resolved;
}

function parseElectiveLineRules(
  text: string,
  subjectLists: EecsSubjectList[],
  groupTitle?: string,
): EecsElectiveRule[] {
  const rules: EecsElectiveRule[] = [];
  const trimmed = text.trim();
  if (!trimmed) return rules;

  if (/two from a cs track/i.test(trimmed)) {
    rules.push({
      text: trimmed.replace(/^\*\s*/, ""),
      chooseN: 2,
      trackFilter: "cs",
      groupTitle,
    });
    return rules;
  }
  if (/two from a ee track/i.test(trimmed)) {
    rules.push({
      text: trimmed.replace(/^\*\s*/, ""),
      chooseN: 2,
      trackFilter: "ee",
      groupTitle,
    });
    return rules;
  }
  if (/two from a _different_ ai\+d, cs, or ee track/i.test(trimmed)) {
    rules.push({
      text: trimmed.replace(/^\*\s*/, ""),
      chooseN: 2,
      trackFilter: "aid-cs-ee",
      differentTrack: true,
      groupTitle,
    });
    return rules;
  }
  if (/two from a _different_ ee track/i.test(trimmed)) {
    rules.push({
      text: trimmed.replace(/^\*\s*/, ""),
      chooseN: 2,
      trackFilter: "ee",
      differentTrack: true,
      groupTitle,
    });
    return rules;
  }
  if (/(?:one|two) from the/i.test(trimmed)) {
    const chooseN = /^two from the/i.test(trimmed) ? 2 : 1;
    const listSlugs = resolveSubjectListSlugs(
      parseListNamesFromElectiveRule(trimmed),
      subjectLists,
    );
    rules.push({
      text: trimmed.replace(/^\*\s*/, ""),
      chooseN,
      listSlugs: listSlugs.length > 0 ? listSlugs : undefined,
      groupTitle,
    });
    return rules;
  }
  if (/two from the/i.test(trimmed) && /list/i.test(trimmed)) {
    const listSlugs = resolveSubjectListSlugs(
      parseListNamesFromElectiveRule(trimmed),
      subjectLists,
    );
    rules.push({
      text: trimmed.replace(/^\*\s*/, ""),
      chooseN: 2,
      listSlugs: listSlugs.length > 0 ? listSlugs : undefined,
      groupTitle,
    });
  }
  return rules;
}

function parseRulesFromElectiveBullet(
  bullet: string,
  subjectLists: EecsSubjectList[],
): EecsElectiveRule[] {
  if (ELECTIVE_SECTION_RE.test(bullet)) {
    return [];
  }

  const groupTitle =
    bullet.match(/\*\*([^*]+)\*\*/)?.[1]?.replace(/\s+subjects?$/i, "").trim() ??
    undefined;
  const rules: EecsElectiveRule[] = [];

  for (const line of bullet.split("\n")) {
    rules.push(...parseElectiveLineRules(line, subjectLists, groupTitle));
  }

  if (rules.length > 0) return rules;

  const chooseN = parseChooseNFromTitle(bullet) ?? 1;
  const ids = extractElectivePoolIds(bullet);
  if (ids.length > 0) {
    return [
      {
        text: bullet.split("\n")[0] ?? bullet,
        chooseN,
        explicitSubjectIds: ids,
        groupTitle,
      },
    ];
  }

  return rules;
}

function parseNotesSection(markdown: string): string[] {
  const notesStart = markdown.search(/_Notes:_/i);
  if (notesStart < 0) return [];

  const listsStart = markdown.indexOf("### Subject Lists");
  const end = listsStart >= 0 ? listsStart : markdown.length;
  return parseConstraintParagraphs(markdown.slice(notesStart, end));
}
function parseConstraintParagraphs(section: string): string[] {
  const constraints: string[] = [];
  let current = "";

  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (/^-\s*$/.test(trimmed)) {
      if (current.trim()) constraints.push(current.trim());
      current = "";
      continue;
    }
    if (/^[-*]\s+\S/.test(trimmed) && !/^\*\s+\*\s+\*/.test(trimmed)) {
      if (current.trim()) constraints.push(current.trim());
      current = trimmed.replace(/^[-*]\s+/, "");
      continue;
    }
    if (trimmed && !/^_(?:Additional constraints|Notes):_/i.test(trimmed)) {
      current += `${current ? " " : ""}${trimmed}`;
    }
  }
  if (current.trim()) constraints.push(current.trim());
  return constraints;
}

function parseElectiveSection(markdown: string): string | undefined {
  const start = findElectiveSectionStart(markdown);
  if (start < 0) {
    return markdown.match(
      /\* (?:One|Two|Three|Four|Five|Six|\d+) \*\*elective\*\* subjects:[\s\S]*?(?=Tracks\b|### Subject Lists|$)/i,
    )?.[0];
  }

  const listsStart = markdown.indexOf("### Subject Lists");
  const tracksStart = markdown.search(/\bTracks\b/i);
  let end = markdown.length;
  if (listsStart >= 0) end = Math.min(end, listsStart);
  if (tracksStart >= start && tracksStart >= 0) end = Math.min(end, tracksStart);
  return markdown.slice(start, end);
}

function parseElectiveRules(
  markdown: string,
  subjectLists: EecsSubjectList[],
): {
  rules: EecsElectiveRule[];
  constraints: string[];
  notes: string[];
} {
  const rules: EecsElectiveRule[] = [];
  const constraints: string[] = [];
  const notes: string[] = [];

  const electiveBlock = parseElectiveSection(markdown);
  if (!electiveBlock) return { rules, constraints, notes };

  const constraintsStart = electiveBlock.search(/_Additional constraints:_/i);
  const notesStart = electiveBlock.search(/_Notes:_/i);

  if (constraintsStart >= 0) {
    const end = notesStart >= 0 ? notesStart : electiveBlock.length;
    constraints.push(
      ...parseConstraintParagraphs(electiveBlock.slice(constraintsStart, end)),
    );
  }

  if (notesStart >= 0) {
    notes.push(...parseConstraintParagraphs(electiveBlock.slice(notesStart)));
  }

  for (const line of electiveBlock.split("\n")) {
    rules.push(...parseElectiveLineRules(line, subjectLists));
    const trimmed = line.trim();
    if (/at least _(?:one|two)_/i.test(trimmed) && /aus2|cim2|ii|centric|serc|plab/i.test(trimmed)) {
      constraints.push(trimmed.replace(/^\*\s*/, ""));
    }
  }

  return { rules, constraints, notes };
}

export function parseEecsRequirementsMarkdown(
  markdown: string,
  programId: string,
  sourceUrl?: string,
): EecsRequirementsAst {
  const header = parsePageHeader(markdown);
  const tracks = parseTrackSection(markdown);
  let subjectLists = parseSubjectLists(markdown);
  const { root: requiredRoot, centerSubjectIds, embeddedElectiveBullets } =
    parseRequiredSubjects(markdown, programId);
  const embeddedRules = embeddedElectiveBullets.flatMap((bullet) =>
    parseRulesFromElectiveBullet(bullet, subjectLists),
  );
  const {
    rules: sectionElectiveRules,
    constraints: additionalConstraints,
    notes: electiveNotes,
  } = parseElectiveRules(markdown, subjectLists);
  const notes = [
    ...electiveNotes,
    ...parseNotesSection(markdown).filter(
      (note) => !electiveNotes.some((existing) => existing === note),
    ),
  ];
  // The AUS2/CIM2/II-style "at least two … must be on the … list" lines are
  // captured both as _Notes:_ and by the additional-constraints line scan, so
  // drop any constraint whose text already appears as a note (or repeats
  // another constraint) to avoid duplicate footnotes downstream.
  const normalizeConstraintText = (value: string): string =>
    value
      .replace(/^[-*\s]+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const seenConstraintText = new Set(notes.map(normalizeConstraintText));
  const dedupedConstraints: string[] = [];
  for (const constraint of additionalConstraints) {
    const key = normalizeConstraintText(constraint);
    if (!key || seenConstraintText.has(key)) continue;
    seenConstraintText.add(key);
    dedupedConstraints.push(constraint);
  }
  const electiveRules = [...sectionElectiveRules, ...embeddedRules];

  if (centerSubjectIds?.length) {
    subjectLists = [
      ...subjectLists.filter((list) => list.slug !== "center-subjects"),
      {
        slug: "center-subjects",
        title: "Center subjects",
        items: centerSubjectIds.map((id) => ({ kind: "subject", subjectId: id })),
        subjectIds: centerSubjectIds,
      },
    ];
  }

  return {
    programId,
    ...header,
    tracks,
    subjectLists,
    electiveRules,
    additionalConstraints: dedupedConstraints,
    notes,
    requiredRoot,
    sourceUrl,
  };
}
