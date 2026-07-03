#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGir, loadProgram, loadSharedLists, type DataKind } from "../index.js";
import { renderProgramHtml, renderProgramMarkdown } from "../visualize/render.js";
import { visualizeMdPath, visualizeOutPath } from "../versioning/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../data");

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = { mode: "html" };
  if (argv[0] === "md" || argv[0] === "markdown") {
    args.mode = "md";
    argv = argv.slice(1);
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--program" && argv[i + 1]) args.program = argv[++i];
    else if (argv[i] === "--md") args.mode = "md";
    else if (argv[i] === "--all") args.all = true;
    else if (argv[i] === "--draft") args.kind = "draft";
    else if (argv[i] === "--current") args.kind = "current";
  }
  return args;
}

/** Enumerate every program id (file basename) under a degrees tree. */
async function listProgramIds(kind: DataKind): Promise<string[]> {
  const root = path.join(
    DATA_ROOT,
    "degrees-departments",
    kind === "draft" ? "drafts/degrees" : "degrees",
  );
  const ids: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".json")) ids.push(entry.name.replace(/\.json$/, ""));
    }
  }
  await walk(root);
  return ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function loadTagPools() {
  const raw = await readFile(path.join(DATA_ROOT, "institute/tag-pools.json"), "utf8");
  return JSON.parse(raw) as {
    pools: Record<string, { label: string; openGradesTag?: { field: string; values: string[] } | null }>;
  };
}

async function renderOne(
  program: string,
  mode: string,
  kind: DataKind | undefined,
  gir: Awaited<ReturnType<typeof loadGir>>,
  tagPools: Awaited<ReturnType<typeof loadTagPools>>,
): Promise<string> {
  const [degree, sharedLists] = await Promise.all([
    loadProgram(program, kind ? { kind } : undefined),
    loadSharedLists(program, kind ? { kind } : undefined),
  ]);
  const bundle = { program: degree, sharedLists, gir, tagPools };

  if (mode === "md") {
    const out = visualizeMdPath(program);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, renderProgramMarkdown(bundle), "utf8");
    return out;
  }
  const out = visualizeOutPath(program);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderProgramHtml(bundle), "utf8");
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode as string;
  const kind = args.kind as DataKind | undefined;
  const [gir, tagPools] = await Promise.all([loadGir(), loadTagPools()]);

  if (args.all) {
    // Batch: render every program. Drafts are the working set, so default there.
    const batchKind: DataKind = kind ?? "draft";
    const programs = await listProgramIds(batchKind);
    let ok = 0;
    const failures: Array<{ program: string; error: string }> = [];
    for (const program of programs) {
      try {
        await renderOne(program, mode, batchKind, gir, tagPools);
        ok++;
      } catch (error) {
        failures.push({
          program,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log(`Rendered ${ok}/${programs.length} program(s) (${mode}, ${batchKind}).`);
    for (const failure of failures) {
      console.warn(`  FAILED ${failure.program}: ${failure.error}`);
    }
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const program = (args.program as string) ?? "6-7";
  const out = await renderOne(program, mode, kind, gir, tagPools);
  console.log(`Wrote ${out}`);
  if (mode !== "md") console.log(`Open: file://${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
