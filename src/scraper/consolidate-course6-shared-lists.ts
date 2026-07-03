import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DegreeProgram, RequirementNode, SharedListDocument } from "../schemas/types";
import {
  COURSE_6_SHARED_SCOPE,
  canonicalizeCourse6SharedListId,
  mergeSharedListDocuments,
} from "../schemas/course6-shared-lists";
import { DATA_ROOT } from "../versioning/paths";

function rewriteSharedListRefs(node: RequirementNode): RequirementNode {
  if (node.type === "selection") {
    const next = { ...node };
    if (next.itemsSource === "shared_list" && next.sharedListId) {
      next.sharedListId = canonicalizeCourse6SharedListId(next.sharedListId);
    }
    if (next.itemsSource === "shared_list_union" && next.sharedListIds) {
      next.sharedListIds = [
        ...new Set(next.sharedListIds.map(canonicalizeCourse6SharedListId)),
      ];
    }
    if (next.items) {
      next.items = next.items.map(rewriteSharedListRefs);
    }
    return next;
  }
  if (node.type === "group" && node.items) {
    return { ...node, items: node.items.map(rewriteSharedListRefs) };
  }
  return node;
}

function rewriteDegreeProgram(program: DegreeProgram): DegreeProgram {
  const footnotes = program.footnotes?.map((footnote) => ({
    ...footnote,
    appliesTo: footnote.appliesTo?.map(canonicalizeCourse6SharedListId),
  }));
  return {
    ...program,
    footnotes,
    constraints: program.constraints?.map((constraint) => ({
      ...constraint,
      pools: constraint.pools?.map(canonicalizeCourse6SharedListId),
    })),
    requirements: program.requirements.map((group) => ({
      ...group,
      root: rewriteSharedListRefs(group.root),
    })),
  };
}

async function loadJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function consolidateCourse6SharedLists(options?: {
  draftsOnly?: boolean;
}): Promise<{ merged: number; removed: number; degreesUpdated: number }> {
  const draftsOnly = options?.draftsOnly ?? true;
  const sharedRoot = path.join(
    DATA_ROOT,
    draftsOnly ? "drafts/shared-lists" : "shared-lists",
    "course-6",
  );
  const degreeRoot = path.join(
    DATA_ROOT,
    draftsOnly ? "drafts/degrees" : "degrees",
    "course-6",
  );

  const files = (await readdir(sharedRoot)).filter((f) => f.endsWith(".json"));
  const canonical = new Map<string, SharedListDocument>();
  const orphans: string[] = [];

  for (const file of files) {
    const filePath = path.join(sharedRoot, file);
    const list = await loadJson<SharedListDocument>(filePath);
    const canonicalId = canonicalizeCourse6SharedListId(list.sharedListId);
    const slug = canonicalId.split(".")[1] ?? "";
    const next: SharedListDocument = {
      ...list,
      sharedListId: canonicalId,
      program:
        canonicalId.startsWith(`${COURSE_6_SHARED_SCOPE}.`)
          ? COURSE_6_SHARED_SCOPE
          : list.program,
      title: list.title.replace(/^#\s*/, ""),
    };
    const existing = canonical.get(canonicalId);
    canonical.set(canonicalId, existing ? mergeSharedListDocuments(existing, next) : next);
    if (file !== `${canonicalId}.json`) {
      orphans.push(filePath);
    }
  }

  for (const [id, list] of canonical) {
    await writeFile(
      path.join(sharedRoot, `${id}.json`),
      `${JSON.stringify(list, null, 2)}\n`,
      "utf8",
    );
  }

  for (const orphan of orphans) {
    const id = path.basename(orphan, ".json");
    if (id !== canonicalizeCourse6SharedListId(id)) {
      await unlink(orphan);
    }
  }

  const degreeFiles = (await readdir(degreeRoot)).filter((f) => f.endsWith(".json"));
  let degreesUpdated = 0;
  for (const file of degreeFiles) {
    const filePath = path.join(degreeRoot, file);
    const program = await loadJson<DegreeProgram>(filePath);
    const updated = rewriteDegreeProgram(program);
    await writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    degreesUpdated += 1;
  }

  return {
    merged: canonical.size,
    removed: orphans.length,
    degreesUpdated,
  };
}
