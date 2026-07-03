import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import Firecrawl from "@mendable/firecrawl-js";
import { findIndexEntry, loadDegreeChartIndex } from "./fetch-degree-chart-index";
import type { DegreeChartIndexEntry } from "./parse-degree-chart-index";

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "src/data/scrape-artifacts");

export type ScrapeResult = {
  program: string;
  url: string;
  markdownPath: string;
  metaPath: string;
  contentHash: string;
  scrapedAt: string;
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function fetchCatalogPage(
  program: string,
  url: string,
  options?: { fallbackMarkdownPath?: string },
): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  let markdown: string;
  let firecrawlJobId: string | undefined;

  if (apiKey) {
    const client = new Firecrawl({ apiKey });
    const result = await client.scrapeUrl(url, { formats: ["markdown"] });
    if (!("success" in result) || result.success !== true) {
      const message = "error" in result ? String(result.error) : "Firecrawl scrape failed";
      throw new Error(message);
    }
    markdown = result.markdown ?? "";
    firecrawlJobId = result.metadata?.scrapeId;
    if (!markdown) {
      throw new Error("Firecrawl returned empty markdown");
    }
  } else if (options?.fallbackMarkdownPath) {
    const { readFile } = await import("node:fs/promises");
    markdown = await readFile(options.fallbackMarkdownPath, "utf8");
  } else {
    throw new Error("FIRECRAWL_API_KEY not set and no fallback markdown provided");
  }

  const scrapedAt = new Date().toISOString().slice(0, 10);
  const contentHash = hashContent(markdown);
  const programDir = path.join(ARTIFACTS_DIR, program);
  await mkdir(programDir, { recursive: true });

  const markdownPath = path.join(programDir, `${scrapedAt}.markdown`);
  const metaPath = path.join(programDir, `${scrapedAt}.meta.json`);

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        url,
        program,
        scrapedAt,
        contentHash,
        firecrawlJobId: firecrawlJobId ?? null,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    program,
    url,
    markdownPath,
    metaPath,
    contentHash,
    scrapedAt,
  };
}

export async function resolveCatalogUrl(
  query: string,
): Promise<DegreeChartIndexEntry | undefined> {
  const index = await loadDegreeChartIndex();
  if (!index) return undefined;
  return findIndexEntry(index, query);
}

export const CATALOG_URLS: Record<string, string> = {
  "6-7": "https://catalog.mit.edu/degree-charts/computer-science-molecular-biology-course-6-7/",
};

export const FALLBACK_MARKDOWN: Record<string, string> = {
  "6-7":
    "/Users/suufi/.cursor/projects/Users-suufi-LocalProjects-mit-opengrades-mobile/uploads/computer-science-molecular-biology-course-6-7-0.md",
};
