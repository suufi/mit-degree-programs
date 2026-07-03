import { fetchCatalogPage } from "./fetch-catalog";
import {
  DEGREE_CHART_INDEX_PATH,
  loadDegreeChartIndex,
} from "./fetch-degree-chart-index";
import type { DegreeChartIndexEntry, DegreeLevel } from "./parse-degree-chart-index";
import { findLatestArtifact } from "./paths";

export type ScrapeAllOptions = {
  level?: DegreeLevel;
  limit?: number;
  dryRun?: boolean;
  delayMs?: number;
  skipExisting?: boolean;
  indexPath?: string;
};

export type ScrapeAllResult = {
  total: number;
  scraped: number;
  skipped: number;
  failed: number;
  failures: Array<{ slug: string; title: string; error: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterEntries(
  entries: DegreeChartIndexEntry[],
  options: ScrapeAllOptions,
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

export async function scrapeAllDegreeCharts(
  options: ScrapeAllOptions = {},
): Promise<ScrapeAllResult> {
  const index = await loadDegreeChartIndex(options.indexPath ?? DEGREE_CHART_INDEX_PATH);
  if (!index) {
    throw new Error(
      "Degree chart index not found. Run `npm run scrape:index` first.",
    );
  }

  if (!options.dryRun && !process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is required to scrape degree chart pages.");
  }

  const entries = filterEntries(index.entries, options);
  const result: ScrapeAllResult = {
    total: entries.length,
    scraped: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const delayMs = options.delayMs ?? 1000;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const label = `[${i + 1}/${entries.length}] ${entry.slug}`;

    if (options.dryRun) {
      console.log(`${label} → ${entry.url} (${entry.title})`);
      continue;
    }

    if (options.skipExisting) {
      const existing = await findLatestArtifact(entry.slug);
      if (existing) {
        console.log(`${label} skipped (artifact exists)`);
        result.skipped++;
        continue;
      }
    }

    try {
      const scrapeResult = await fetchCatalogPage(entry.slug, entry.url);
      console.log(`${label} → ${scrapeResult.markdownPath}`);
      result.scraped++;
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
