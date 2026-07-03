#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDegreeProgram,
  validateGirTemplate,
  validateSharedList,
} from "../validators/index";
import type { DegreeProgram, SharedListDocument } from "../schemas/types";
import { buildSharedListRegistry } from "../resolution/shared-list-registry";
import {
  COURSE_6_SHARED_SCOPE,
  isCourse6Program,
} from "../schemas/course6-shared-lists";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../data");

async function readJsonFiles(dir: string): Promise<Array<{ filePath: string; data: unknown }>> {
  const entries: Array<{ filePath: string; data: unknown }> = [];
  let files: string[];
  try {
    files = await readdir(dir, { recursive: true, withFileTypes: false }) as string[];
  } catch {
    return entries;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(dir, file);
    const raw = await readFile(filePath, "utf8");
    entries.push({ filePath, data: JSON.parse(raw) });
  }
  return entries;
}

async function loadAllSharedLists(): Promise<SharedListDocument[]> {
  const roots = [
    path.join(DATA_ROOT, "degrees-departments/shared-lists"),
    path.join(DATA_ROOT, "degrees-departments/drafts/shared-lists"),
  ];
  const lists: SharedListDocument[] = [];
  const seen = new Set<string>();
  for (const sharedDir of roots) {
    const files = await readJsonFiles(sharedDir);
    for (const { filePath, data } of files) {
      const result = validateSharedList(data);
      if (!result.ok) {
        console.error(`FAIL ${filePath}:`, result.errors);
        process.exitCode = 1;
        continue;
      }
      if (seen.has(result.data.sharedListId)) continue;
      seen.add(result.data.sharedListId);
      lists.push(result.data);
    }
  }
  return lists;
}

function sharedListsForProgram(
  programId: string,
  allLists: SharedListDocument[],
): SharedListDocument[] {
  return allLists.filter(
    (list) =>
      list.program === programId ||
      (isCourse6Program(programId) && list.program === COURSE_6_SHARED_SCOPE),
  );
}

async function main() {
  let failed = false;

  const instituteDir = path.join(DATA_ROOT, "institute");
  const instituteFiles = await readJsonFiles(instituteDir);
  for (const { filePath, data } of instituteFiles) {
    const base = path.basename(filePath);
    if (base === "tag-pools.json") {
      console.log(`OK   ${filePath} (tag pool registry)`);
      continue;
    }
    const result = validateGirTemplate(data);
    if (!result.ok) {
      console.error(`FAIL ${filePath}:`, result.errors);
      failed = true;
    } else {
      console.log(`OK   ${filePath}`);
    }
  }

  const sharedLists = await loadAllSharedLists();
  const { errors: registryErrors } = buildSharedListRegistry(sharedLists);
  if (registryErrors.length > 0) {
    console.error("Shared list registry errors:", registryErrors);
    failed = true;
  } else {
    for (const list of sharedLists) {
      console.log(`OK   shared-lists/**/${list.sharedListId}.json`);
    }
  }

  const degreesDir = path.join(DATA_ROOT, "degrees-departments/degrees");
  const degreeFiles = await readJsonFiles(degreesDir);
  for (const { filePath, data } of degreeFiles) {
    const program = data as DegreeProgram;
    const programLists = sharedListsForProgram(program.program, sharedLists);
    const result = validateDegreeProgram(data, { sharedLists: programLists });
    if (!result.ok) {
      console.error(`FAIL ${filePath}:`, result.errors);
      failed = true;
    } else {
      console.log(`OK   ${filePath}`);
    }
  }

  const versionsDir = path.join(DATA_ROOT, "degrees-departments/versions");
  const versionFiles = await readJsonFiles(versionsDir);
  for (const { filePath, data } of versionFiles) {
    const program = data as DegreeProgram;
    const programLists = sharedListsForProgram(program.program, sharedLists);
    const result = validateDegreeProgram(data, { sharedLists: programLists });
    if (!result.ok) {
      console.error(`FAIL ${filePath}:`, result.errors);
      failed = true;
    } else {
      console.log(`OK   ${filePath}`);
    }
  }

  const draftsDir = path.join(DATA_ROOT, "degrees-departments/drafts/degrees");
  const draftFiles = await readJsonFiles(draftsDir);
  for (const { filePath, data } of draftFiles) {
    const program = data as DegreeProgram;
    const programLists = sharedListsForProgram(program.program, sharedLists);
    const result = validateDegreeProgram(data, { sharedLists: programLists });
    if (!result.ok) {
      console.error(`FAIL ${filePath}:`, result.errors);
      failed = true;
    } else {
      console.log(`OK   ${filePath}`);
    }
  }

  if (failed) process.exit(1);
  console.log("All degree data validated successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
