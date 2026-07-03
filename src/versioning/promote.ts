import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DegreeManifest, DegreeProgram, SharedListDocument } from "../schemas/types";
import { diffDegreePrograms } from "./diff-degree";
import { archiveRevision, computeRevisionId, stampRevisionMetadata } from "./revision";
import {
  DATA_ROOT,
  courseDirForProgram,
  degreePath,
  manifestPath,
  sharedListsDir,
  versionPath,
} from "./paths";

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function loadManifest(): Promise<DegreeManifest> {
  try {
    return await readJson<DegreeManifest>(manifestPath());
  } catch {
    return { schemaVersion: "1", programs: {} };
  }
}

export async function saveManifest(manifest: DegreeManifest): Promise<void> {
  await writeJson(manifestPath(), manifest);
}

export async function loadRevision(program: string, revisionId: string): Promise<DegreeProgram> {
  return readJson<DegreeProgram>(versionPath(program, revisionId));
}

export async function loadCurrentProgram(program: string): Promise<DegreeProgram | null> {
  try {
    return await readJson<DegreeProgram>(degreePath(program, "current"));
  } catch {
    return null;
  }
}

export async function loadDraftProgram(program: string): Promise<DegreeProgram | null> {
  try {
    return await readJson<DegreeProgram>(degreePath(program, "draft"));
  } catch {
    return null;
  }
}

async function copySharedLists(program: string, from: "draft" | "current", to: "current"): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const srcDir = sharedListsDir(program, from);
  const destDir = sharedListsDir(program, to);
  let files: string[];
  try {
    files = await readdir(srcDir);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.startsWith(`${program}.`) || !file.endsWith(".json")) continue;
    await mkdir(destDir, { recursive: true });
    await copyFile(path.join(srcDir, file), path.join(destDir, file));
  }
}

export type PromoteResult = {
  revisionId: string;
  archivedPrevious?: string;
  diff: ReturnType<typeof diffDegreePrograms>;
};

export async function promoteDraft(
  program: string,
  options?: { force?: boolean; sharedLists?: SharedListDocument[]; draftSharedLists?: SharedListDocument[] },
): Promise<PromoteResult> {
  const draft = await loadDraftProgram(program);
  if (!draft) {
    throw new Error(`No draft found for ${program}. Run build:degrees first.`);
  }

  const current = await loadCurrentProgram(program);
  const manifest = await loadManifest();
  const courseDir = courseDirForProgram(program);

  let diff = diffDegreePrograms(
    current ?? { ...draft, requirements: [] },
    draft,
    {
      fromSharedLists: options?.sharedLists,
      toSharedLists: options?.draftSharedLists,
    },
  );

  if (diff.hasDestructiveChanges && !options?.force) {
    throw new Error(
      `Destructive changes detected (${diff.destructive.length}). Archive manually or pass --force after review.\n` +
        diff.destructive.map((d) => `  - ${d.message}`).join("\n"),
    );
  }

  const previousRevisionId = current?.revisionId;
  const revisionId = computeRevisionId(program, draft.catalogSource, draft);
  const promoted: DegreeProgram = stampRevisionMetadata(
    {
      ...draft,
      revisionId,
      status: "current",
      supersedes: previousRevisionId,
      supersededBy: undefined,
    },
    { status: "current", supersedes: previousRevisionId },
  );

  if (current?.revisionId) {
    const archived = archiveRevision({ ...current, revisionId: current.revisionId }, revisionId);
    await writeJson(versionPath(program, current.revisionId), archived);
  } else if (current) {
    const fallbackId = computeRevisionId(program, current.catalogSource, current);
    const archived = archiveRevision({ ...current, revisionId: fallbackId }, revisionId);
    await writeJson(versionPath(program, fallbackId), archived);
  }

  await writeJson(versionPath(program, revisionId), promoted);
  await writeJson(degreePath(program, "current"), promoted);
  await copySharedLists(program, "draft", "current");

  const entry = manifest.programs[program] ?? {
    courseDir,
    currentRevision: revisionId,
    revisions: [],
  };
  entry.currentRevision = revisionId;
  entry.revisions = entry.revisions.filter((r) => r.revisionId !== revisionId);
  if (previousRevisionId) {
    const prev = entry.revisions.find((r) => r.revisionId === previousRevisionId);
    if (prev) {
      prev.status = "archived";
      prev.archivedAt = new Date().toISOString().slice(0, 10);
    } else {
      entry.revisions.push({
        revisionId: previousRevisionId,
        status: "archived",
        archivedAt: new Date().toISOString().slice(0, 10),
      });
    }
  }
  entry.revisions.push({ revisionId, status: "current" });
  manifest.programs[program] = entry;
  await saveManifest(manifest);

  diff = diffDegreePrograms(current ?? promoted, promoted, {
    fromSharedLists: options?.sharedLists,
    toSharedLists: options?.draftSharedLists ?? options?.sharedLists,
  });
  return { revisionId, archivedPrevious: previousRevisionId, diff };
}

export { DATA_ROOT };
