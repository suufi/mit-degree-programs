import type {
  DegreeProgram,
  ProgramConstraint,
  ProgramFootnote,
  RequirementGroup,
  RequirementNode,
  SharedListDocument,
} from "../schemas/types";
import { makeSharedListId, sharedListOwnerProgram } from "../schemas/shared-lists";
import type { ScrapeResult } from "./fetch-catalog";
import type { DegreeChartIndexEntry } from "./parse-degree-chart-index";
import type { DegreeChartAst, DepartmentalRow, ParsedPool } from "./parse-degree-chart";
import { subjectNode } from "./parse-degree-chart";
import { slugifyPoolTitle } from "./parse-table";

export type NormalizeContext = {
  programId: string;
  title: string;
  level: "undergraduate" | "graduate";
  scrapeMeta?: ScrapeResult;
  indexEntry?: DegreeChartIndexEntry;
};

export function slugifyGroupId(programId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${programId}-${slug || "requirements"}`;
}

export function buildCatalogSource(
  context: NormalizeContext,
): DegreeProgram["catalogSource"] {
  const url =
    context.scrapeMeta?.url ??
    context.indexEntry?.url ??
    "https://catalog.mit.edu/degree-charts/";
  const slug =
    context.scrapeMeta?.url.replace(/\/$/, "").split("/").pop() ??
    context.indexEntry?.slug ??
    context.programId;

  return {
    url,
    slug,
    scrapedAt: context.scrapeMeta?.scrapedAt ?? new Date().toISOString().slice(0, 10),
    contentHash: context.scrapeMeta?.contentHash ?? "manual",
  };
}

export function buildSharedLists(
  programId: string,
  pools: ParsedPool[],
): SharedListDocument[] {
  return pools.map((pool) => {
    const ownerProgram = sharedListOwnerProgram(programId, pool.slug);
    return {
      sharedListId: makeSharedListId(programId, pool.slug),
      program: ownerProgram,
      title: pool.title,
      items: pool.subjectIds.map((id) => subjectNode(id)),
      version: "1",
    };
  });
}

function subjectsToNode(subjectIds: string[]): RequirementNode {
  if (subjectIds.length === 1) return subjectNode(subjectIds[0]!);
  return {
    type: "group",
    ruleType: "all_of",
    items: subjectIds.map((id) => subjectNode(id)),
  };
}

function chooseOneToNode(options: string[][], chooseN?: number): RequirementNode {
  const items = options.map((option) => subjectsToNode(option));
  if (chooseN && chooseN > 1) {
    return {
      type: "selection",
      ruleType: "choose_n",
      ruleValue: chooseN,
      itemsSource: "explicit",
      items,
    };
  }
  return {
    type: "selection",
    ruleType: "choose_one",
    itemsSource: "explicit",
    items,
  };
}

export function inferBucket(title: string): RequirementGroup["bucket"] {
  if (/thesis/i.test(title)) return "thesis";
  if (/restricted elective|elective/i.test(title)) return "elective";
  return "departmental";
}

export function inferSubcategory(title: string): RequirementGroup["subcategory"] {
  if (/thesis/i.test(title)) return /preparation/i.test(title) ? "thesis_preparation" : "thesis";
  if (/communication/i.test(title)) return "communication";
  if (/restricted elective/i.test(title)) return "restricted_electives";
  if (/computation/i.test(title)) return "computation";
  if (/history|theory|criticism/i.test(title)) return "history_theory_criticism";
  if (/urbanism/i.test(title)) return "urbanism";
  if (/laboratory|lab/i.test(title)) return "laboratory";
  if (/elective/i.test(title)) return "elective_subjects";
  if (/foundation|introductory|fundamental/i.test(title)) return "fundamentals";
  return "required_subjects";
}

function matchPoolSlugFromText(text: string, pools: ParsedPool[]): string[] {
  const matches: string[] = [];
  for (const pool of pools) {
    if (text.toLowerCase().includes(pool.title.toLowerCase())) {
      matches.push(pool.slug);
    }
  }
  return matches;
}

function rowToNodes(row: DepartmentalRow, pools: ParsedPool[], programId: string): RequirementNode[] {
  switch (row.kind) {
    case "subjects":
      return [subjectsToNode(row.subjectIds)];
    case "choose_one":
      return [chooseOneToNode(row.options, row.chooseN)];
    case "pool_union": {
      const slugs = matchPoolSlugFromText(row.text, pools);
      const sharedListIds =
        slugs.length > 0
          ? slugs.map((slug) => makeSharedListId(programId, slug))
          : pools.map((pool) => makeSharedListId(programId, pool.slug));
      return [
        {
          type: "selection",
          ruleType: "choose_n",
          ruleValue: row.chooseN ?? 2,
          itemsSource: "shared_list_union",
          sharedListIds,
          note: row.text,
        },
      ];
    }
    case "choose_units":
      return [
        {
          type: "selection",
          ruleType: "choose_units",
          ruleValue: row.minUnits ?? row.maxUnits,
          itemsSource: "advisor_defined",
          note: row.text,
          flexibility: /consultation with advisor|coherent plan/i.test(row.text)
            ? { advisorApproval: true, catalogText: row.text }
            : { catalogText: row.text },
        },
      ];
    default:
      return [];
  }
}

export function rowsToRequirementGroups(
  rows: DepartmentalRow[],
  pools: ParsedPool[],
  programId: string,
): RequirementGroup[] {
  const groups: RequirementGroup[] = [];
  let currentTitle = "Required Subjects";
  let currentRows: DepartmentalRow[] = [];

  const flush = () => {
    const contentRows = currentRows.filter(
      (row) =>
        row.kind !== "prose" &&
        row.kind !== "instruction" &&
        row.kind !== "or" &&
        row.kind !== "pool_union",
    );
    if (contentRows.length === 0) return;

    const items = contentRows.flatMap((row) => rowToNodes(row, pools, programId));
    if (items.length === 0) return;

    const root: RequirementNode =
      items.length === 1
        ? items[0]!
        : {
            type: "group",
            ruleType: "all_of",
            items,
          };

    const chooseUnitsRow = contentRows.find((row) => row.kind === "choose_units");

    groups.push({
      groupId: slugifyGroupId(programId, currentTitle),
      title: currentTitle,
      bucket: inferBucket(currentTitle),
      subcategory: inferSubcategory(currentTitle),
      ...(chooseUnitsRow
        ? {
            flexibility: {
              advisorApproval: /consultation with advisor/i.test(chooseUnitsRow.text),
              catalogText: chooseUnitsRow.text,
            },
          }
        : {}),
      root,
    });
    currentRows = [];
  };

  for (const row of rows) {
    if (row.kind === "pool_union") {
      flush();
      continue;
    }
    if (row.kind === "section") {
      flush();
      currentTitle = row.title;
      continue;
    }
    currentRows.push(row);
  }
  flush();
  return groups;
}

export function buildFootnotes(
  ast: DegreeChartAst,
  programId: string,
  pools: ParsedPool[],
): ProgramFootnote[] {
  return ast.footnotes.map((footnote) => {
    const appliesTo: string[] = [];
    if (/but not both|either .+ or .+ restricted/i.test(footnote.text)) {
      for (const pool of pools) {
        if (footnote.text.toLowerCase().includes(pool.title.toLowerCase().split(" ")[0]!)) {
          appliesTo.push(makeSharedListId(programId, pool.slug));
        }
      }
      if (appliesTo.length < 2) {
        for (const pool of pools) {
          const id = makeSharedListId(programId, pool.slug);
          if (!appliesTo.includes(id)) appliesTo.push(id);
        }
      }
    }
    return {
      id: footnote.id,
      text: footnote.text,
      appliesTo: appliesTo.length > 0 ? appliesTo : undefined,
    };
  });
}

export function buildConstraints(
  footnotes: ProgramFootnote[],
): ProgramConstraint[] {
  const constraints: ProgramConstraint[] = [];
  for (const footnote of footnotes) {
    if (!footnote.appliesTo || footnote.appliesTo.length < 2) continue;
    if (/but not both|not both/i.test(footnote.text)) {
      constraints.push({
        type: "exclusive_pools",
        pools: footnote.appliesTo,
        note: footnote.text,
      });
    }
  }
  return constraints;
}

export function poolUnionGroup(
  programId: string,
  pools: ParsedPool[],
  row: Extract<DepartmentalRow, { kind: "pool_union" }>,
): RequirementGroup {
  const slugs = matchPoolSlugFromText(row.text, pools);
  const sharedListIds = (slugs.length > 0 ? slugs : pools.map((pool) => pool.slug)).map((slug) =>
    makeSharedListId(programId, slug),
  );

  return {
    groupId: slugifyGroupId(programId, "restricted-electives"),
    title: "Restricted Electives",
    bucket: "elective",
    subcategory: "restricted_electives",
    flexibility: {
      catalogText: row.text,
    },
    root: {
      type: "selection",
      ruleType: "choose_n",
      ruleValue: row.chooseN ?? 2,
      itemsSource: "shared_list_union",
      sharedListIds,
    },
  };
}

export function restrictedElectivesFromPools(
  programId: string,
  pools: ParsedPool[],
  row?: Extract<DepartmentalRow, { kind: "choose_units" }>,
): RequirementGroup | undefined {
  let electivePools = pools.filter((pool) =>
    /restricted|elective|performance/i.test(pool.title),
  );
  // When the requirement references "Restricted Electives" generically but no
  // pool title contains that word, the enumerated category pools (e.g.
  // architecture's "Building Technology", "Computation", …) ARE the restricted
  // electives, so select from their union.
  if (electivePools.length === 0 && row && /restricted elective/i.test(row.text)) {
    electivePools = pools;
  }
  if (electivePools.length === 0) return undefined;

  const sharedListIds = electivePools.map((pool) => makeSharedListId(programId, pool.slug));
  return {
    groupId: slugifyGroupId(programId, "restricted-electives"),
    title: "Restricted Electives",
    bucket: "elective",
    subcategory: "restricted_electives",
    ...(row ? { flexibility: { catalogText: row.text } } : {}),
    root:
      sharedListIds.length === 1
        ? {
            type: "selection",
            ruleType: "choose_units",
            ruleValue: row?.minUnits ?? 24,
            itemsSource: "shared_list",
            sharedListId: sharedListIds[0],
          }
        : {
            type: "selection",
            ruleType: "choose_units",
            ruleValue: row?.minUnits ?? 24,
            itemsSource: "shared_list_union",
            sharedListIds,
          },
  };
}

export function mergeRequirementGroups(groups: RequirementGroup[]): RequirementGroup[] {
  const byId = new Map<string, RequirementGroup>();
  for (const group of groups) {
    if (!byId.has(group.groupId)) {
      byId.set(group.groupId, group);
    }
  }
  return [...byId.values()];
}

export function resolveProgramId(
  ast: DegreeChartAst,
  scrapeMeta?: ScrapeResult,
  indexEntry?: DegreeChartIndexEntry,
): string {
  return indexEntry?.programId ?? scrapeMeta?.program ?? slugifyPoolTitle(ast.title);
}
