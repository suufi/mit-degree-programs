import type { SharedListDocument, ValidationError } from "../schemas/types";

export type SharedListRegistry = Map<string, SharedListDocument>;

export function buildSharedListRegistry(
  lists: SharedListDocument[],
): { registry: SharedListRegistry; errors: ValidationError[] } {
  const registry = new Map<string, SharedListDocument>();
  const errors: ValidationError[] = [];

  lists.forEach((list, index) => {
    if (registry.has(list.sharedListId)) {
      errors.push({
        path: `/sharedLists/${index}/sharedListId`,
        message: `Duplicate sharedListId: ${list.sharedListId}`,
        source: "semantic",
      });
      return;
    }
    registry.set(list.sharedListId, list);
  });

  return { registry, errors };
}

export function resolveSharedList(
  sharedListId: string,
  registry: SharedListRegistry,
): SharedListDocument | undefined {
  return registry.get(sharedListId);
}
