import type { DegreeProgram } from "../schemas/types";
import type { DegreeChartAst } from "./parse-degree-chart";
import type { DegreeChartIndexEntry } from "./parse-degree-chart-index";
import type { ScrapeResult } from "./fetch-catalog";
import {
  buildCatalogSource,
  buildConstraints,
  buildFootnotes,
  buildSharedLists,
  mergeRequirementGroups,
  poolUnionGroup,
  restrictedElectivesFromPools,
  resolveProgramId,
  rowsToRequirementGroups,
} from "./normalize-common";

export function normalizeUndergradToSchema(
  ast: DegreeChartAst,
  options?: {
    scrapeMeta?: ScrapeResult;
    indexEntry?: DegreeChartIndexEntry;
    programId?: string;
  },
): { program: DegreeProgram; sharedLists: ReturnType<typeof buildSharedLists> } {
  const programId =
    options?.programId ?? resolveProgramId(ast, options?.scrapeMeta, options?.indexEntry);

  const sharedLists = buildSharedLists(programId, ast.pools);
  const footnotes = buildFootnotes(ast, programId, ast.pools);
  const constraints = buildConstraints(footnotes);

  const departmentalGroups = rowsToRequirementGroups(
    ast.departmentalRows,
    ast.pools,
    programId,
  );

  const poolUnionRow = ast.departmentalRows.find((row) => row.kind === "pool_union");
  const chooseUnitsRow = ast.departmentalRows.find((row) => row.kind === "choose_units");

  const supplementalGroups = [];
  if (poolUnionRow && poolUnionRow.kind === "pool_union") {
    supplementalGroups.push(poolUnionGroup(programId, ast.pools, poolUnionRow));
  } else if (chooseUnitsRow?.kind === "choose_units") {
    const restricted = restrictedElectivesFromPools(programId, ast.pools, chooseUnitsRow);
    if (restricted) supplementalGroups.push(restricted);
  }

  // A pool-based "Restricted Electives" group (shared_list/union over the
  // enumerated pools) is more faithful than the departmental choose_units row,
  // so drop the departmental one whenever we produced a supplemental version.
  const requirements = mergeRequirementGroups([
    ...departmentalGroups.filter(
      (group) =>
        group.title.toLowerCase() !== "restricted electives" ||
        supplementalGroups.length === 0,
    ),
    ...supplementalGroups,
  ]);

  const program: DegreeProgram = {
    schemaVersion: "2",
    program: programId,
    title: options?.indexEntry?.title ?? ast.degreeTitle ?? ast.title,
    level: "undergraduate",
    complete: false,
    includesGir: "sb",
    catalogSource: buildCatalogSource({
      programId,
      title: ast.title,
      level: "undergraduate",
      scrapeMeta: options?.scrapeMeta,
      indexEntry: options?.indexEntry,
    }),
    girCrosswalk: ast.girCrosswalk,
    footnotes,
    constraints,
    requirements,
  };

  return { program, sharedLists };
}
