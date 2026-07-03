import type { DegreeChartIndexEntry } from "./parse-degree-chart-index";
import type { DegreeChartAst } from "./parse-degree-chart";
import type { ScrapeResult } from "./fetch-catalog";
import { normalizeGradToSchema } from "./normalize-grad";
import { normalizeUndergradToSchema } from "./normalize-undergrad";

export type NormalizedDegree = {
  program: ReturnType<typeof normalizeUndergradToSchema>["program"];
  sharedLists: ReturnType<typeof normalizeUndergradToSchema>["sharedLists"];
};

export function normalizeToSchema(
  ast: DegreeChartAst,
  scrapeMeta?: ScrapeResult,
  indexEntry?: DegreeChartIndexEntry,
): NormalizedDegree {
  const options = { scrapeMeta, indexEntry };
  if (ast.level === "graduate") {
    return normalizeGradToSchema(ast, options);
  }
  return normalizeUndergradToSchema(ast, options);
}
