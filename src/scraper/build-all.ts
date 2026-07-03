import { access } from "node:fs/promises";
import {
  DEGREE_CHART_INDEX_PATH,
  loadDegreeChartIndex,
} from "./fetch-degree-chart-index";
import type { DegreeChartIndexEntry, DegreeLevel } from "./parse-degree-chart-index";
import { buildDegree } from "./build-degree";
import { findLatestArtifact } from "./paths";
import { degreePath } from "../versioning/paths";
import { getGeminiConfig } from "../llm/gemini";

export type BuildAllOptions = {
  level?: DegreeLevel;
  limit?: number;
  dryRun?: boolean;
  delayMs?: number;
  skipExisting?: boolean;
  useLlm?: boolean;
  indexPath?: string;
};

export type BuildAllResult = {
  total: number;
  built: number;
  skipped: number;
  failed: number;
  llmEnriched: number;
  failures: Array<{ slug: string; title: string; error: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterEntries(
  entries: DegreeChartIndexEntry[],
  options: BuildAllOptions,
): DegreeChartIndexEntry[] {
  let filtered = entries;
  if (options.level) {
    filtered = filtered.filter((entry) => entry.level === options.level);
  }
  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }
  return filtered;
}

async function hasDraft(programId: string): Promise<boolean> {
  try {
    await access(degreePath(programId, "draft"));
    return true;
  } catch {
    return false;
  }
}

export async function buildAllDegrees(options: BuildAllOptions = {}): Promise<BuildAllResult> {
  const index = await loadDegreeChartIndex(options.indexPath ?? DEGREE_CHART_INDEX_PATH);
  if (!index) {
    throw new Error("Degree chart index not found. Run `npm run scrape:index` first.");
  }

  const useLlm = options.useLlm ?? Boolean(getGeminiConfig());
  const entries = filterEntries(index.entries, options);
  const result: BuildAllResult = {
    total: entries.length,
    built: 0,
    skipped: 0,
    failed: 0,
    llmEnriched: 0,
    failures: [],
  };

  const delayMs = options.delayMs ?? (useLlm ? 500 : 0);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const label = `[${i + 1}/${entries.length}] ${entry.slug}`;

    const artifact = await findLatestArtifact(entry.slug);
    if (!artifact) {
      console.error(`${label} skipped (no scrape artifact)`);
      result.skipped++;
      continue;
    }

    if (options.dryRun) {
      console.log(`${label} → would build ${entry.programId} (${entry.title})`);
      continue;
    }

    if (options.skipExisting && (await hasDraft(entry.programId))) {
      console.log(`${label} skipped (draft exists)`);
      result.skipped++;
      continue;
    }

    try {
      const built = await buildDegree(entry.slug, { useLlm });
      const llmSuffix = built.llmEnriched ? " +gemini" : "";
      console.log(
        `${label} → ${built.programId}.json (${built.revisionId}, ${built.sharedListCount} lists)${llmSuffix}`,
      );
      result.built++;
      if (built.llmEnriched) result.llmEnriched++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${label} failed: ${message}`);
      result.failed++;
      result.failures.push({ slug: entry.slug, title: entry.title, error: message });
    }

    if (i < entries.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return result;
}
