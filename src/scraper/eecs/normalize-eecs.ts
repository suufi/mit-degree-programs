import type { DegreeProgram, SharedListDocument } from "../../schemas/types";
import type { DegreeChartIndexEntry } from "../parse-degree-chart-index";
import type { EecsScrapeResult } from "./fetch-eecs-requirements";
import { slugifyGroupId } from "../normalize-common";
import { enrichCourse6WithEecs } from "./enrich-course6-degree";
import type { EecsRequirementsAst } from "./parse-eecs-requirements";

export function buildEecsSource(
  scrape: Pick<EecsScrapeResult, "url" | "contentHash" | "scrapedAt" | "programKey" | "enterYear" | "level">,
): NonNullable<DegreeProgram["eecsSource"]> {
  return {
    url: scrape.url,
    programKey: scrape.programKey,
    enterYear: scrape.enterYear,
    level: scrape.level,
    scrapedAt: scrape.scrapedAt,
    contentHash: scrape.contentHash,
  };
}

export function normalizeEecsToSchema(
  ast: EecsRequirementsAst,
  options: {
    programId: string;
    scrapeMeta: EecsScrapeResult;
    indexEntry?: DegreeChartIndexEntry;
  },
): { program: DegreeProgram; sharedLists: SharedListDocument[] } {
  const { programId, scrapeMeta, indexEntry } = options;
  const level = ast.level ?? (programId.endsWith("p") ? "graduate" : "undergraduate");

  const shell: DegreeProgram = {
    schemaVersion: "2",
    program: programId,
    title:
      indexEntry?.title ??
      ast.pageTitle ??
      `Course ${programId}`,
    level,
    complete: false,
    includesGir: level === "undergraduate" ? "sb" : undefined,
    catalogYear: ast.enterYear ? String(ast.enterYear) : undefined,
    effectiveTerm: ast.enterYear ? `${ast.enterYear}-FA` : undefined,
    eecsSource: buildEecsSource({
      url: scrapeMeta.url,
      programKey: scrapeMeta.programKey ?? ast.programKey ?? programId,
      enterYear: scrapeMeta.enterYear ?? ast.enterYear ?? 0,
      level: scrapeMeta.level ?? (level === "graduate" ? "MNG" : "SB"),
      scrapedAt: scrapeMeta.scrapedAt,
      contentHash: scrapeMeta.contentHash,
    }),
    footnotes: ast.notes.map((text, index) => ({
      id: String(index + 1),
      text,
    })),
    constraints: [],
    requirements: ast.requiredRoot
      ? [
          {
            groupId: slugifyGroupId(programId, "required-subjects"),
            title: "Required Subjects",
            bucket: "departmental",
            subcategory: "required_subjects",
            root: ast.requiredRoot,
          },
        ]
      : [],
  };

  return enrichCourse6WithEecs(shell, [], ast);
}
