#!/usr/bin/env node
import {
  CATALOG_URLS,
  FALLBACK_MARKDOWN,
  fetchCatalogPage,
  resolveCatalogUrl,
} from "./fetch-catalog";
import { scrapeDegreeChartIndex } from "./fetch-degree-chart-index";
import { scrapeAllDegreeCharts } from "./scrape-all";
import { buildAllDegrees } from "./build-all";
import { buildDegree } from "./build-degree";
import { resolveEecsCatalogProgramId, parseEecsProgramQuery } from "./eecs/fetch-eecs-requirements";
import {
  eecsUrlForProgram,
  isEecsSourcedProgram,
} from "./eecs/parse-eecs-requirements";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean | number> = {};
  if (argv[0] && !argv[0].startsWith("--")) {
    args.command = argv[0];
    argv = argv.slice(1);
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--program" && argv[i + 1]) args.program = argv[++i];
    else if (argv[i] === "--url" && argv[i + 1]) args.url = argv[++i];
    else if (argv[i] === "--command" && argv[i + 1]) args.command = argv[++i];
    else if (argv[i] === "--level" && argv[i + 1]) args.level = argv[++i];
    else if (argv[i] === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (argv[i] === "--delay-ms" && argv[i + 1]) args.delayMs = Number(argv[++i]);
    else if (argv[i] === "--promote") args.promote = true;
    else if (argv[i] === "--force") args.force = true;
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--skip-existing") args.skipExisting = true;
    else if (argv[i] === "--no-llm") args.noLlm = true;
  }
  return args;
}

async function runScrapeAll(args: Record<string, string | boolean | number>) {
  const level = args.level as "undergraduate" | "graduate" | undefined;
  if (level && level !== "undergraduate" && level !== "graduate") {
    throw new Error(`Invalid --level: ${level}. Use undergraduate or graduate.`);
  }

  const result = await scrapeAllDegreeCharts({
    level,
    limit: typeof args.limit === "number" ? args.limit : undefined,
    dryRun: args.dryRun === true,
    delayMs: typeof args.delayMs === "number" ? args.delayMs : undefined,
    skipExisting: args.skipExisting === true,
  });

  if (args.dryRun === true) {
    console.log(`Dry run: ${result.total} degree chart(s) would be scraped.`);
    return;
  }

  console.log(
    `Done: ${result.scraped} scraped, ${result.skipped} skipped, ${result.failed} failed (${result.total} total).`,
  );
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runBuildAll(args: Record<string, string | boolean | number>) {
  const level = args.level as "undergraduate" | "graduate" | undefined;
  if (level && level !== "undergraduate" && level !== "graduate") {
    throw new Error(`Invalid --level: ${level}. Use undergraduate or graduate.`);
  }

  const result = await buildAllDegrees({
    level,
    limit: typeof args.limit === "number" ? args.limit : undefined,
    dryRun: args.dryRun === true,
    delayMs: typeof args.delayMs === "number" ? args.delayMs : undefined,
    skipExisting: args.skipExisting === true,
    useLlm: args.noLlm === true ? false : undefined,
  });

  if (args.dryRun === true) {
    console.log(`Dry run: ${result.total} degree chart(s) would be built.`);
    return;
  }

  console.log(
    `Done: ${result.built} built (${result.llmEnriched} gemini-enriched), ${result.skipped} skipped, ${result.failed} failed (${result.total} total).`,
  );
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runScrapeIndex() {
  const { index, outputPath } = await scrapeDegreeChartIndex();
  const undergrad = index.entries.filter((entry) => entry.level === "undergraduate").length;
  const graduate = index.entries.filter((entry) => entry.level === "graduate").length;
  console.log(
    `Indexed ${index.entries.length} degree chart(s) (${undergrad} undergraduate, ${graduate} graduate) → ${outputPath}`,
  );
}

async function resolveScrapeTarget(
  program: string,
  explicitUrl?: string,
): Promise<{ program: string; url: string; eecsQuery?: string }> {
  const eecsQuery = explicitUrl ?? program;
  const parsed = parseEecsProgramQuery(eecsQuery);
  if (parsed) {
    const url = explicitUrl ?? `https://eecsis.mit.edu/degree_requirements.pcgi?program=${encodeURIComponent(parsed.eecsProgramKey)}`;
    return { program: parsed.catalogProgramId, url, eecsQuery };
  }

  const eecsCatalogId = resolveEecsCatalogProgramId(program) ?? program;
  if (isEecsSourcedProgram(eecsCatalogId)) {
    const url = explicitUrl ?? eecsUrlForProgram(eecsCatalogId);
    if (url) {
      return { program: eecsCatalogId, url };
    }
  }

  if (explicitUrl) {
    return { program, url: explicitUrl };
  }

  const fromCatalog = CATALOG_URLS[program];
  if (fromCatalog) {
    return { program, url: fromCatalog };
  }

  const fromIndex = await resolveCatalogUrl(program);
  if (fromIndex) {
    return { program: fromIndex.programId, url: fromIndex.url };
  }

  throw new Error(
    `Unknown program: ${program}. Run "npm run scrape:index" or pass --url.`,
  );
}

async function runScrape(program: string, url: string) {
  const fallback = FALLBACK_MARKDOWN[program];
  try {
    const result = await fetchCatalogPage(program, url, {
      fallbackMarkdownPath: fallback,
    });
    console.log(`Scraped ${program} → ${result.markdownPath}`);
    return result;
  } catch (error) {
    if (fallback) {
      console.warn(`Firecrawl failed (${error}); using fallback markdown.`);
      const { mkdir, readFile: rf, writeFile } = await import("node:fs/promises");
      const { createHash } = await import("node:crypto");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
      const markdown = await rf(fallback, "utf8");
      const scrapedAt = new Date().toISOString().slice(0, 10);
      const contentHash = createHash("sha256").update(markdown).digest("hex");
      const artifactDir = path.join(projectRoot, "src/data/scrape-artifacts", program);
      await mkdir(artifactDir, { recursive: true });
      const markdownPath = path.join(artifactDir, `${scrapedAt}.markdown`);
      await writeFile(markdownPath, markdown, "utf8");
      return {
        program,
        url,
        markdownPath,
        metaPath: "",
        contentHash,
        scrapedAt,
      };
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = (args.command as string) ?? "scrape";
  const program = (args.program as string) ?? "6-7";
  const explicitUrl = args.url as string | undefined;
  const promote = args.promote === true;
  const force = args.force === true;
  const useLlm = args.noLlm === true ? false : undefined;

  if (command === "scrape-index") {
    await runScrapeIndex();
    return;
  }

  if (command === "scrape-all") {
    await runScrapeAll(args);
    return;
  }

  if (command === "build-all") {
    await runBuildAll(args);
    return;
  }

  const { program: resolvedProgram, url, eecsQuery } = await resolveScrapeTarget(
    program,
    explicitUrl,
  );

  if (command === "scrape") {
    await runScrape(resolvedProgram, url);
  } else if (command === "build") {
    const fallback = FALLBACK_MARKDOWN[resolvedProgram];
    const built = await buildDegree(eecsQuery ?? program, {
      promote,
      force,
      useLlm,
      fallbackMarkdownPath: fallback,
      eecsQuery,
    });
    console.log(
      `Built draft ${built.programId}.json (${built.revisionId}) and ${built.sharedListCount} shared list(s) under drafts/`,
    );
    if (!promote) {
      console.log(`Review draft, then: npm run diff:degree -- --program ${built.programId}`);
      console.log(`Promote when ready: npm run build:degrees -- --program ${built.programId} --promote`);
    }
  } else if (command === "all") {
    const scrapeResult = await runScrape(resolvedProgram, url);
    const built = await buildDegree(eecsQuery ?? program, {
      promote,
      force,
      useLlm,
      scrapeResult,
      eecsQuery,
    });
    console.log(
      `Built draft ${built.programId}.json (${built.revisionId}) and ${built.sharedListCount} shared list(s) under drafts/`,
    );
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
