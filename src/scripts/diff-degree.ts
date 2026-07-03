#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DegreeProgram, SharedListDocument } from "../schemas/types";
import { diffDegreePrograms, formatDiffReport } from "../versioning/diff-degree";
import {
  loadCurrentProgram,
  loadManifest,
  loadRevision,
} from "../versioning/promote";
import { degreePath, versionPath, sharedListsDir } from "../versioning/paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--program" && argv[i + 1]) args.program = argv[++i];
    else if (argv[i] === "--from" && argv[i + 1]) args.from = argv[++i];
    else if (argv[i] === "--to" && argv[i + 1]) args.to = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

async function loadSharedListsForProgram(program: string): Promise<SharedListDocument[]> {
  const dir = sharedListsDir(program, "current");
  const lists: SharedListDocument[] = [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return lists;
  }
  for (const file of files) {
    if (!file.startsWith(`${program}.`) || !file.endsWith(".json")) continue;
    const raw = await readFile(path.join(dir, file), "utf8");
    lists.push(JSON.parse(raw) as SharedListDocument);
  }
  return lists;
}

async function resolveProgram(program: string, rev: string): Promise<DegreeProgram> {
  if (rev === "current") {
    const current = await loadCurrentProgram(program);
    if (!current) throw new Error(`No current program for ${program}`);
    return current;
  }
  if (rev === "draft") {
    const raw = await readFile(degreePath(program, "draft"), "utf8");
    return JSON.parse(raw) as DegreeProgram;
  }
  return loadRevision(program, rev);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const program = (args.program as string) ?? "6-7";
  const manifest = await loadManifest();
  const entry = manifest.programs[program];
  const fromRev = (args.from as string) ?? entry?.currentRevision ?? "current";
  const toRev = (args.to as string) ?? "draft";

  const fromProgram = await resolveProgram(program, fromRev);
  const toProgram = await resolveProgram(program, toRev);
  const sharedLists = await loadSharedListsForProgram(program);

  const report = diffDegreePrograms(fromProgram, toProgram, {
    fromSharedLists: sharedLists,
    toSharedLists: sharedLists,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDiffReport(report));
    console.log(`\nRevision paths:`);
    const pathFor = (rev: string) => {
      if (rev === "current") return degreePath(program, "current");
      if (rev === "draft") return degreePath(program, "draft");
      return versionPath(program, rev);
    };
    console.log(`  from: ${pathFor(fromRev)}`);
    console.log(`  to:   ${pathFor(toRev)}`);
  }

  if (report.hasDestructiveChanges) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
