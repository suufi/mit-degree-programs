import type { DegreeProgram } from "../schemas/types";
import type { DegreeChartAst } from "./parse-degree-chart";
import {
  buildCatalogSource,
  buildConstraints,
  buildFootnotes,
  buildSharedLists,
  mergeRequirementGroups,
  resolveProgramId,
  rowsToRequirementGroups,
  type NormalizeContext,
} from "./normalize-common";

export function normalizeGradToSchema(
  ast: DegreeChartAst,
  options?: {
    scrapeMeta?: NormalizeContext["scrapeMeta"];
    indexEntry?: NormalizeContext["indexEntry"];
    programId?: string;
  },
): { program: DegreeProgram; sharedLists: ReturnType<typeof buildSharedLists> } {
  const programId =
    options?.programId ??
    resolveProgramId(ast, options?.scrapeMeta, options?.indexEntry);
  const context: NormalizeContext = {
    programId,
    title: options?.indexEntry?.title ?? ast.title,
    level: "graduate",
    scrapeMeta: options?.scrapeMeta,
    indexEntry: options?.indexEntry,
  };

  const sharedLists = buildSharedLists(programId, ast.pools);
  const footnotes = buildFootnotes(ast, programId, ast.pools);
  const constraints = buildConstraints(footnotes);
  const requirements = mergeRequirementGroups(
    rowsToRequirementGroups(ast.departmentalRows, ast.pools, programId),
  );

  const program: DegreeProgram = {
    schemaVersion: "2",
    program: programId,
    title: context.title,
    level: "graduate",
    complete: false,
    catalogSource: buildCatalogSource(context),
    footnotes,
    constraints,
    requirements,
  };

  return { program, sharedLists };
}
