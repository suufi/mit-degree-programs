import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import Firecrawl from "@mendable/firecrawl-js";
import { cleanEecsMarkdown } from "./clean-eecs-markdown";
import {
  eecsUrlForProgramKey,
  parseEecsProgramQuery,
  type EecsProgramQuery,
} from "./eecs-program-ids";
import { parseEecsRequirementsMarkdown } from "./parse-eecs-requirements";

config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const ARTIFACT_ROOT = path.join(PROJECT_ROOT, "src/data/scrape-artifacts");

export type EecsScrapeResult = {
  programId: string;
  eecsProgramId: string;
  url: string;
  markdownPath: string;
  contentHash: string;
  scrapedAt: string;
  programKey: string;
  enterYear: number;
  level: "SB" | "MNG";
};

function artifactDir(catalogProgramId: string): string {
  return path.join(ARTIFACT_ROOT, `eecs-${catalogProgramId}`);
}

export async function findEecsArtifact(
  catalogProgramId: string,
  enterYear?: number,
): Promise<string | null> {
  const dir = artifactDir(catalogProgramId);
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    let markdowns = files.filter((file) => file.endsWith(".markdown"));
    if (enterYear != null) {
      const suffix = `-${enterYear}.markdown`;
      markdowns = markdowns.filter((file) => file.endsWith(suffix));
    }
    markdowns.sort();
    const latest = markdowns.at(-1);
    return latest ? path.join(dir, latest) : null;
  } catch {
    return null;
  }
}

/** @deprecated use findEecsArtifact */
export async function findLatestEecsArtifact(
  catalogProgramId: string,
): Promise<string | null> {
  return findEecsArtifact(catalogProgramId);
}

async function readEecsMeta(
  markdownPath: string,
): Promise<Omit<EecsScrapeResult, "markdownPath"> | null> {
  try {
    const metaRaw = await readFile(
      markdownPath.replace(/\.markdown$/, ".meta.json"),
      "utf8",
    );
    return JSON.parse(metaRaw) as Omit<EecsScrapeResult, "markdownPath">;
  } catch {
    return null;
  }
}

async function writeArtifact(
  catalogProgramId: string,
  eecsProgramId: string,
  markdown: string,
  url: string,
  header: {
    programKey: string;
    enterYear: number;
    level: "SB" | "MNG";
  },
): Promise<EecsScrapeResult> {
  const scrapedAt = new Date().toISOString().slice(0, 10);
  const contentHash = createHash("sha256").update(markdown).digest("hex");
  const dir = artifactDir(catalogProgramId);
  await mkdir(dir, { recursive: true });
  const base = `${scrapedAt}-${header.enterYear}`;
  const markdownPath = path.join(dir, `${base}.markdown`);
  const metaPath = path.join(dir, `${base}.meta.json`);
  const meta: Omit<EecsScrapeResult, "markdownPath"> = {
    programId: catalogProgramId,
    eecsProgramId,
    url,
    contentHash,
    scrapedAt,
    programKey: header.programKey,
    enterYear: header.enterYear,
    level: header.level,
  };
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { ...meta, markdownPath };
}

async function scrapeWithFirecrawl(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FIRECRAWL_API_KEY is required to scrape EECS requirements (set in .env)",
    );
  }
  const client = new Firecrawl({ apiKey });
  const result = await client.scrapeUrl(url, { formats: ["markdown"] });
  if (!("success" in result) || result.success !== true) {
    const message = "error" in result ? String(result.error) : "Firecrawl scrape failed";
    throw new Error(message);
  }
  const markdown = result.markdown ?? "";
  if (!markdown) {
    throw new Error("Firecrawl returned empty markdown for EECS page");
  }
  return markdown;
}

function headerFromAst(
  ast: ReturnType<typeof parseEecsRequirementsMarkdown>,
  eecsProgramId: string,
): { programKey: string; enterYear: number; level: "SB" | "MNG" } {
  const enterYear = ast.enterYear;
  const programKey = ast.programKey ?? `${eecsProgramId}_${enterYear ?? "unknown"}`;
  if (!enterYear) {
    throw new Error(
      `Could not parse entering year from EECS page header for ${eecsProgramId}`,
    );
  }
  return {
    programKey,
    enterYear,
    level: ast.level === "graduate" ? "MNG" : "SB",
  };
}

export async function fetchEecsRequirementsMarkdown(
  catalogProgramId: string,
  options?: { force?: boolean; eecsQuery?: EecsProgramQuery | string },
): Promise<{
  markdown: string;
  url: string;
  artifactPath: string;
  scrapeMeta: EecsScrapeResult;
} | null> {
  const parsed =
    typeof options?.eecsQuery === "string"
      ? parseEecsProgramQuery(options.eecsQuery)
      : options?.eecsQuery ?? parseEecsProgramQuery(catalogProgramId);
  if (!parsed) return null;

  const { eecsProgramKey, enterYear, catalogBaseId } = parsed;
  const url = eecsUrlForProgramKey(eecsProgramKey);

  if (!options?.force) {
    const existing = await findEecsArtifact(catalogBaseId, enterYear);
    if (existing) {
      const markdown = await readFile(existing, "utf8");
      const storedMeta = await readEecsMeta(existing);
      const ast = parseEecsRequirementsMarkdown(
        markdown,
        catalogBaseId,
        storedMeta?.url ?? url,
      );
      const header = storedMeta
        ? {
            programKey: storedMeta.programKey,
            enterYear: storedMeta.enterYear,
            level: storedMeta.level,
          }
        : headerFromAst(ast, eecsProgramKey);
      const scrapeMeta: EecsScrapeResult = storedMeta
        ? { ...storedMeta, markdownPath: existing }
        : {
            programId: catalogBaseId,
            eecsProgramId: eecsProgramKey,
            url,
            contentHash: createHash("sha256").update(markdown).digest("hex"),
            scrapedAt: existing.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "unknown",
            markdownPath: existing,
            ...header,
          };
      return { markdown, url, artifactPath: existing, scrapeMeta };
    }
  }

  const raw = await scrapeWithFirecrawl(url);
  const cleaned = cleanEecsMarkdown(raw);
  const ast = parseEecsRequirementsMarkdown(cleaned, catalogBaseId, url);
  const header = headerFromAst(ast, eecsProgramKey);
  const artifact = await writeArtifact(
    catalogBaseId,
    eecsProgramKey,
    cleaned,
    url,
    header,
  );

  return {
    markdown: cleaned,
    url,
    artifactPath: artifact.markdownPath,
    scrapeMeta: artifact,
  };
}

/** Resolve catalog program id when build query is an EECS URL id (e.g. 6-P3, 6-7_2017). */
export function resolveEecsCatalogProgramId(query: string): string | undefined {
  return parseEecsProgramQuery(query)?.catalogProgramId;
}

export { parseEecsProgramQuery, eecsUrlForProgramKey } from "./eecs-program-ids";
export type { EecsProgramQuery } from "./eecs-program-ids";
