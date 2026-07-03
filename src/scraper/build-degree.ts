import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_URLS,
  FALLBACK_MARKDOWN,
  type ScrapeResult,
} from "./fetch-catalog";
import { findIndexEntry, loadDegreeChartIndex } from "./fetch-degree-chart-index";
import { enrichDegreeWithGemini } from "./llm-enrich";
import {
  fetchEecsRequirementsMarkdown,
  resolveEecsCatalogProgramId,
} from "./eecs/fetch-eecs-requirements";
import { normalizeEecsToSchema } from "./eecs/normalize-eecs";
import {
  isEecsSourcedProgram,
  parseEecsRequirementsMarkdown,
} from "./eecs/parse-eecs-requirements";
import { getGeminiConfig } from "../llm/gemini";
import { normalizeToSchema } from "./normalize-to-schema";
import { normalizeUndergradToSchema } from "./normalize-undergrad";
import { parseDegreeChartMarkdown, splitDegreeChartOptions } from "./parse-degree-chart";
import { findLatestArtifact } from "./paths";
import { stampRevisionMetadata } from "../versioning/revision";
import { degreePath, sharedListPath } from "../versioning/paths";
import {
  COURSE_6_SHARED_SCOPE,
  mergeSharedListDocuments,
} from "../schemas/course6-shared-lists";
import type { DegreeProgram, SharedListDocument } from "../schemas/types";
import { promoteDraft } from "../versioning/promote";
import { formatDiffReport } from "../versioning/diff-degree";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

export type BuildDegreeOptions = {
  promote?: boolean;
  force?: boolean;
  useLlm?: boolean;
  fallbackMarkdownPath?: string;
  scrapeResult?: ScrapeResult;
  /** EECS program key or full degree_requirements URL (e.g. 6-7_2017). */
  eecsQuery?: string;
};

export type BuildDegreeResult = {
  programId: string;
  slug: string;
  draftPath: string;
  sharedListCount: number;
  revisionId: string;
  llmEnriched: boolean;
};

async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function prepareSharedListsForWrite(
  programId: string,
  lists: SharedListDocument[],
): Promise<SharedListDocument[]> {
  const byId = new Map<string, SharedListDocument>();
  for (const list of lists) {
    const prev = byId.get(list.sharedListId);
    byId.set(list.sharedListId, prev ? mergeSharedListDocuments(prev, list) : list);
  }

  for (const list of [...byId.values()]) {
    if (!list.sharedListId.startsWith(`${COURSE_6_SHARED_SCOPE}.`)) continue;
    const filePath = sharedListPath(programId, list.sharedListId, "draft");
    try {
      const existing = JSON.parse(
        await readFile(filePath, "utf8"),
      ) as SharedListDocument;
      byId.set(list.sharedListId, mergeSharedListDocuments(existing, list));
    } catch {
      /* new department list */
    }
  }

  return [...byId.values()];
}

export async function buildDegree(
  query: string,
  options: BuildDegreeOptions = {},
): Promise<BuildDegreeResult> {
  const index = await loadDegreeChartIndex();
  const eecsQuery = options.eecsQuery ?? query;
  const indexEntry = index ? findIndexEntry(index, eecsQuery) : undefined;
  const eecsCatalogId = resolveEecsCatalogProgramId(eecsQuery);
  const programId = indexEntry?.programId ?? eecsCatalogId ?? query;
  const artifactKey = indexEntry?.slug ?? options.scrapeResult?.program ?? query;
  const useLlm = options.useLlm ?? Boolean(getGeminiConfig());
  const eecsPrimary = isEecsSourcedProgram(programId);

  let markdownPath = options.scrapeResult?.markdownPath;
  let meta: ScrapeResult | undefined = options.scrapeResult;

  if (!eecsPrimary) {
    if (!markdownPath) {
      markdownPath = (await findLatestArtifact(artifactKey)) ?? undefined;
    }
    if (!markdownPath) {
      markdownPath =
        options.fallbackMarkdownPath ??
        FALLBACK_MARKDOWN[programId] ??
        FALLBACK_MARKDOWN[query];
    }
    if (!markdownPath) {
      throw new Error(`No scrape artifact for ${query}`);
    }
  } else if (!markdownPath) {
    markdownPath = (await findLatestArtifact(artifactKey)) ?? undefined;
  }

  if (!meta && markdownPath?.endsWith(".markdown")) {
    try {
      const metaRaw = await readFile(
        markdownPath.replace(/\.markdown$/, ".meta.json"),
        "utf8",
      );
      const parsed = JSON.parse(metaRaw) as {
        url: string;
        contentHash: string;
        scrapedAt: string;
      };
      meta = {
        program: artifactKey,
        url: parsed.url ?? indexEntry?.url ?? CATALOG_URLS[programId]!,
        markdownPath,
        metaPath: markdownPath.replace(/\.markdown$/, ".meta.json"),
        contentHash: parsed.contentHash,
        scrapedAt: parsed.scrapedAt,
      };
    } catch {
      /* no meta file */
    }
  }

  type BuildUnit = {
    programId: string;
    degree: DegreeProgram;
    sharedLists: SharedListDocument[];
    catalogAst?: ReturnType<typeof parseDegreeChartMarkdown>;
    catalogMarkdown?: string;
  };

  const units: BuildUnit[] = [];

  if (eecsPrimary) {
    const eecsPage = await fetchEecsRequirementsMarkdown(programId, {
      force: options.force,
      eecsQuery,
    });
    if (!eecsPage) {
      throw new Error(`EECS requirements unavailable for ${programId}`);
    }
    const eecsAst = parseEecsRequirementsMarkdown(
      eecsPage.markdown,
      programId,
      eecsPage.url,
    );
    const fromEecs = normalizeEecsToSchema(eecsAst, {
      programId,
      scrapeMeta: eecsPage.scrapeMeta,
      indexEntry,
    });
    let degree = fromEecs.program;
    let catalogAst: ReturnType<typeof parseDegreeChartMarkdown> | undefined;
    let catalogMarkdown: string | undefined;

    if (markdownPath) {
      catalogMarkdown = await readFile(markdownPath, "utf8");
      catalogAst = parseDegreeChartMarkdown(catalogMarkdown);
      if (catalogAst.girCrosswalk?.length) {
        degree = { ...degree, girCrosswalk: catalogAst.girCrosswalk };
      }
    }

    units.push({
      programId,
      degree,
      sharedLists: fromEecs.sharedLists,
      catalogAst,
      catalogMarkdown,
    });
  } else {
    const markdown = await readFile(markdownPath!, "utf8");
    const optionSegments = splitDegreeChartOptions(markdown);

    if (optionSegments.length >= 2) {
      // Multi-option catalog chart (e.g. Chemistry Standard/Flexible, Math
      // General/Applied/Pure). The first tab keeps the base program id; each
      // additional option becomes its own degree file `<base>-<optionSlug>`.
      optionSegments.forEach((segment, idx) => {
        const optionAst = parseDegreeChartMarkdown(segment.markdown);
        const optionProgramId =
          idx === 0 ? programId : `${programId}-${segment.optionSlug}`;
        const normalized = normalizeUndergradToSchema(optionAst, {
          scrapeMeta: meta,
          indexEntry,
          programId: optionProgramId,
        });
        const baseTitle = indexEntry?.title ?? optionAst.title;
        units.push({
          programId: optionProgramId,
          degree: {
            ...normalized.program,
            title: `${baseTitle} \u2014 ${segment.optionLabel}`,
          },
          sharedLists: normalized.sharedLists,
          catalogAst: optionAst,
          catalogMarkdown: segment.markdown,
        });
      });
    } else {
      const catalogAst = parseDegreeChartMarkdown(markdown);
      const normalized = normalizeToSchema(catalogAst, meta, indexEntry);
      units.push({
        programId,
        degree: normalized.program,
        sharedLists: normalized.sharedLists,
        catalogAst,
        catalogMarkdown: markdown,
      });
    }
  }

  let firstResult: BuildDegreeResult | undefined;

  for (const unit of units) {
    let degree = unit.degree;
    let sharedLists = unit.sharedLists;
    let llmEnriched = false;

    if (useLlm && unit.catalogAst && unit.catalogMarkdown) {
      try {
        const enriched = await enrichDegreeWithGemini(
          unit.catalogAst,
          degree,
          sharedLists,
          unit.catalogMarkdown,
        );
        degree = enriched.program;
        sharedLists = enriched.sharedLists;
        llmEnriched = Boolean(enriched.enrichment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `Gemini enrichment failed for ${unit.programId}, using rule-based draft: ${message}`,
        );
      }
    }

    const draft = stampRevisionMetadata({ ...degree, status: "draft" }, { status: "draft" });
    const draftPath = degreePath(unit.programId, "draft");

    await writeJson(draftPath, draft);
    const listsToWrite = await prepareSharedListsForWrite(unit.programId, sharedLists);
    for (const list of listsToWrite) {
      await writeJson(sharedListPath(unit.programId, list.sharedListId, "draft"), list);
    }

    if (units.length > 1) {
      console.log(
        `Wrote option draft ${unit.programId}.json (${listsToWrite.length} shared list(s))`,
      );
    }

    if (options.promote) {
      const result = await promoteDraft(unit.programId, {
        force: options.force,
        draftSharedLists: sharedLists,
      });
      console.log(`Promoted revision ${result.revisionId}`);
      if (result.archivedPrevious) {
        console.log(`Archived previous revision: ${result.archivedPrevious}`);
      }
      console.log(formatDiffReport(result.diff));
    }

    if (!firstResult) {
      firstResult = {
        programId: unit.programId,
        slug: artifactKey,
        draftPath,
        sharedListCount: sharedLists.length,
        revisionId: draft.revisionId!,
        llmEnriched,
      };
    }
  }

  if (!firstResult) {
    throw new Error(`No degree units produced for ${query}`);
  }

  return firstResult;
}
