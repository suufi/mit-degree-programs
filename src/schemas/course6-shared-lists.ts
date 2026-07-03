import type { SharedListDocument } from "./types";

/** Owner program id for department-wide Course 6 shared lists. */
export const COURSE_6_SHARED_SCOPE = "course-6";

/** Subject lists and catalog groupings shared across Course 6 programs. */
const DEPARTMENT_WIDE_SLUGS = new Set([
  "ai-d-aus",
  "aus2",
  "cim2",
  "ii",
  "eecs",
  "math",
  "grad-aus2",
  "grad-ii",
  "grad-aid-aus",
  "eecs-advanced-subjects",
  "application-cim",
  "ai-d-serc",
]);

export function isCourse6Program(programId: string): boolean {
  return /^6-/i.test(programId);
}

export function isDepartmentWideCourse6Slug(listSlug: string): boolean {
  return listSlug.startsWith("track-") || DEPARTMENT_WIDE_SLUGS.has(listSlug);
}

export type SharedListScope = {
  ownerProgram: string;
  sharedListId: string;
};

export function resolveSharedListScope(
  programId: string,
  listSlug: string,
): SharedListScope {
  if (isCourse6Program(programId) && isDepartmentWideCourse6Slug(listSlug)) {
    return {
      ownerProgram: COURSE_6_SHARED_SCOPE,
      sharedListId: `${COURSE_6_SHARED_SCOPE}.${listSlug}`,
    };
  }
  return {
    ownerProgram: programId,
    sharedListId: `${programId}.${listSlug}`,
  };
}

export function isValidSharedListRefForProgram(
  programId: string,
  sharedListId: string,
  listOwnerProgram: string,
): boolean {
  if (sharedListId.startsWith(`${programId}.`)) {
    return listOwnerProgram === programId;
  }
  if (
    isCourse6Program(programId) &&
    sharedListId.startsWith(`${COURSE_6_SHARED_SCOPE}.`)
  ) {
    return listOwnerProgram === COURSE_6_SHARED_SCOPE;
  }
  return false;
}

function itemKey(item: SharedListDocument["items"][number]): string {
  if (item.type === "subject") return `subject:${item.subjectId}`;
  return `group:${item.items.map((sub) => sub.subjectId).sort().join("+")}`;
}

/** Merge items when multiple programs contribute to the same department list. */
export function mergeSharedListDocuments(
  existing: SharedListDocument,
  incoming: SharedListDocument,
): SharedListDocument {
  const seen = new Set<string>(existing.items.map(itemKey));
  const items = [...existing.items];
  for (const item of incoming.items) {
    const key = itemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  const title =
    incoming.items.length >= existing.items.length ? incoming.title : existing.title;
  return { ...existing, title: title.replace(/^#\s*/, ""), items };
}

/** Map legacy per-program ids to department scope (e.g. 6-4.ai-d-aus → course-6.ai-d-aus). */
export function canonicalizeCourse6SharedListId(sharedListId: string): string {
  const dot = sharedListId.indexOf(".");
  if (dot < 0) return sharedListId;
  const program = sharedListId.slice(0, dot);
  const slug = sharedListId.slice(dot + 1);
  if (isCourse6Program(program) && isDepartmentWideCourse6Slug(slug)) {
    return `${COURSE_6_SHARED_SCOPE}.${slug}`;
  }
  return sharedListId;
}
