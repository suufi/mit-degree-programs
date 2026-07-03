import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEGREE_CHART_INDEX_URL,
  type DegreeChartIndex,
  type DegreeChartIndexEntry,
  parseDegreeChartIndexHtml,
} from "./parse-degree-chart-index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
export const DEGREE_CHART_INDEX_PATH = path.join(
  PROJECT_ROOT,
  "src/data/catalog/degree-chart-index.json",
);

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function fetchDegreeChartIndexHtml(
  sourceUrl = DEGREE_CHART_INDEX_URL,
): Promise<string> {
  const response = await fetch(sourceUrl, {
    headers: { Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch degree chart index (${response.status})`);
  }
  return response.text();
}

export async function scrapeDegreeChartIndex(options?: {
  sourceUrl?: string;
  fallbackHtmlPath?: string;
  outputPath?: string;
}): Promise<{ index: DegreeChartIndex; outputPath: string }> {
  const sourceUrl = options?.sourceUrl ?? DEGREE_CHART_INDEX_URL;
  const outputPath = options?.outputPath ?? DEGREE_CHART_INDEX_PATH;
  let html: string;

  try {
    html = await fetchDegreeChartIndexHtml(sourceUrl);
  } catch (error) {
    if (!options?.fallbackHtmlPath) throw error;
    html = await readFile(options.fallbackHtmlPath, "utf8");
  }

  const scrapedAt = new Date().toISOString().slice(0, 10);
  const contentHash = hashContent(html);
  const index = parseDegreeChartIndexHtml(html, { sourceUrl, scrapedAt, contentHash });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return { index, outputPath };
}

export async function loadDegreeChartIndex(
  indexPath = DEGREE_CHART_INDEX_PATH,
): Promise<DegreeChartIndex | null> {
  try {
    const raw = await readFile(indexPath, "utf8");
    return JSON.parse(raw) as DegreeChartIndex;
  } catch {
    return null;
  }
}

function normalizeSlug(value: string): string {
  return value.replace(/\/$/, "").split("/").pop() ?? value;
}

export function findIndexEntry(
  index: DegreeChartIndex,
  query: string,
): DegreeChartIndexEntry | undefined {
  const normalized = query.trim().toLowerCase();
  const slug = normalizeSlug(normalized);

  return index.entries.find(
    (entry) =>
      entry.programId.toLowerCase() === normalized ||
      entry.slug.toLowerCase() === slug ||
      entry.url.replace(/\/$/, "").toLowerCase() === normalized.replace(/\/$/, ""),
  );
}

export function catalogUrlsFromIndex(index: DegreeChartIndex): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const entry of index.entries) {
    urls[entry.programId] = entry.url;
    urls[entry.slug] = entry.url;
  }
  return urls;
}
