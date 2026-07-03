import type {
  DegreeProgram,
  GirCrosswalkEntry,
  RequirementGroup,
  RequirementNode,
  SharedListDocument,
} from "../schemas/types";

export type DiffCategory = "additive" | "destructive" | "informational";

export type DiffEntry = {
  category: DiffCategory;
  kind: string;
  path: string;
  message: string;
  before?: unknown;
  after?: unknown;
};

export type DegreeDiffReport = {
  program: string;
  fromRevision?: string;
  toRevision?: string;
  additive: DiffEntry[];
  destructive: DiffEntry[];
  informational: DiffEntry[];
  hasDestructiveChanges: boolean;
  safeToAutoMerge: boolean;
};

type NodeContext = {
  groupId: string;
  path: string;
  parentRule?: string;
};

function crosswalkKey(entry: GirCrosswalkEntry): string {
  return `${entry.subjectId}:${[...entry.satisfies].sort().join(",")}`;
}

function collectSubjects(
  node: RequirementNode,
  ctx: NodeContext,
  sink: Map<string, { subjectId: string; path: string; required: boolean }>,
): void {
  if (node.type === "subject") {
    const required =
      ctx.parentRule === "all_of" ||
      (ctx.parentRule === "choose_n" && ctx.path.endsWith("items"));
    sink.set(`${ctx.groupId}:${ctx.path}:${node.subjectId}`, {
      subjectId: node.subjectId,
      path: `${ctx.groupId}/${ctx.path}`,
      required,
    });
    return;
  }

  if (node.type === "group") {
    node.items.forEach((child, idx) => {
      collectSubjects(child, { ...ctx, path: `${ctx.path}/group[${idx}]`, parentRule: "all_of" }, sink);
    });
    return;
  }

  const selPath = `${ctx.path}/selection(${node.ruleType}${node.ruleValue ?? ""})`;
  if (node.itemsSource === "shared_list" && node.sharedListId) {
    sink.set(`${ctx.groupId}:${selPath}:shared_list:${node.sharedListId}`, {
      subjectId: node.sharedListId,
      path: `${ctx.groupId}/${selPath}`,
      required: node.ruleType === "choose_n" && node.ruleValue === 1,
    });
  }
  if (node.itemsSource === "shared_list_union" && node.sharedListIds) {
    for (const id of node.sharedListIds) {
      sink.set(`${ctx.groupId}:${selPath}:shared_list_union:${id}`, {
        subjectId: id,
        path: `${ctx.groupId}/${selPath}`,
        required: false,
      });
    }
  }
  if (node.itemsSource === "tag_pool" && node.tagPool) {
    sink.set(`${ctx.groupId}:${selPath}:tag_pool:${node.tagPool}`, {
      subjectId: node.tagPool,
      path: `${ctx.groupId}/${selPath}`,
      required: node.ruleType !== "choose_one",
    });
  }
  if (node.items) {
    node.items.forEach((child, idx) => {
      collectSubjects(
        child,
        { ...ctx, path: `${selPath}/items[${idx}]`, parentRule: node.ruleType },
        sink,
      );
    });
  }
}

function selectionSignature(node: RequirementNode, groupId: string, path: string): string | null {
  if (node.type !== "selection") return null;
  const parts = [
    groupId,
    path,
    node.ruleType,
    node.ruleValue ?? "",
    node.itemsSource ?? "explicit",
    node.sharedListId ?? "",
    (node.sharedListIds ?? []).join(","),
    node.tagPool ?? "",
  ];
  return parts.join("|");
}

function walkSelections(
  node: RequirementNode,
  groupId: string,
  path: string,
  sink: Map<string, RequirementNode & { type: "selection" }>,
): void {
  if (node.type === "selection") {
    const sig = selectionSignature(node, groupId, path);
    if (sig) sink.set(sig, node);
    if (node.items) {
      node.items.forEach((child, idx) =>
        walkSelections(child, groupId, `${path}/items[${idx}]`, sink),
      );
    }
    return;
  }
  if (node.type === "group") {
    node.items.forEach((child, idx) =>
      walkSelections(child, groupId, `${path}/group[${idx}]`, sink),
    );
  }
}

function indexGroups(program: DegreeProgram): Map<string, RequirementGroup> {
  return new Map(program.requirements.map((g) => [g.groupId, g]));
}

function indexSharedListSubjects(lists: SharedListDocument[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const list of lists) {
    const subjectIds = new Set<string>();
    for (const item of list.items) {
      if (item.type === "subject") subjectIds.add(item.subjectId);
      else for (const sub of item.items) subjectIds.add(sub.subjectId);
    }
    map.set(list.sharedListId, subjectIds);
  }
  return map;
}

function compareSharedLists(
  fromLists: SharedListDocument[],
  toLists: SharedListDocument[],
  program: string,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const fromMap = indexSharedListSubjects(fromLists);
  const toMap = indexSharedListSubjects(toLists);
  const allIds = new Set([...fromMap.keys(), ...toMap.keys()]);

  for (const id of allIds) {
    if (!id.startsWith(`${program}.`)) continue;
    const before = fromMap.get(id) ?? new Set<string>();
    const after = toMap.get(id) ?? new Set<string>();

    if (!fromMap.has(id) && toMap.has(id)) {
      entries.push({
        category: "additive",
        kind: "shared_list_added",
        path: `shared-lists/${id}`,
        message: `New shared list ${id}`,
        after: [...after],
      });
      continue;
    }
    if (fromMap.has(id) && !toMap.has(id)) {
      entries.push({
        category: "destructive",
        kind: "shared_list_removed",
        path: `shared-lists/${id}`,
        message: `Shared list removed: ${id}`,
        before: [...before],
      });
      continue;
    }

    for (const subjectId of before) {
      if (!after.has(subjectId)) {
        entries.push({
          category: "destructive",
          kind: "shared_list_subject_removed",
          path: `shared-lists/${id}`,
          message: `Subject ${subjectId} removed from pool ${id}`,
          before: subjectId,
        });
      }
    }
    for (const subjectId of after) {
      if (!before.has(subjectId)) {
        entries.push({
          category: "additive",
          kind: "shared_list_subject_added",
          path: `shared-lists/${id}`,
          message: `Subject ${subjectId} added to pool ${id}`,
          after: subjectId,
        });
      }
    }
  }
  return entries;
}

export function diffDegreePrograms(
  from: DegreeProgram,
  to: DegreeProgram,
  options?: {
    fromSharedLists?: SharedListDocument[];
    toSharedLists?: SharedListDocument[];
  },
): DegreeDiffReport {
  const additive: DiffEntry[] = [];
  const destructive: DiffEntry[] = [];
  const informational: DiffEntry[] = [];

  if (from.title !== to.title) {
    informational.push({
      category: "informational",
      kind: "title_changed",
      path: "/title",
      message: "Program title changed",
      before: from.title,
      after: to.title,
    });
  }

  const fromGroups = indexGroups(from);
  const toGroups = indexGroups(to);

  for (const groupId of fromGroups.keys()) {
    if (!toGroups.has(groupId)) {
      destructive.push({
        category: "destructive",
        kind: "group_removed",
        path: `/requirements/${groupId}`,
        message: `Requirement group removed: ${groupId}`,
        before: fromGroups.get(groupId)?.title,
      });
    }
  }
  for (const groupId of toGroups.keys()) {
    if (!fromGroups.has(groupId)) {
      additive.push({
        category: "additive",
        kind: "group_added",
        path: `/requirements/${groupId}`,
        message: `Requirement group added: ${groupId}`,
        after: toGroups.get(groupId)?.title,
      });
    }
  }

  for (const groupId of fromGroups.keys()) {
    if (!toGroups.has(groupId)) continue;
    const fromSel = new Map<string, RequirementNode & { type: "selection" }>();
    const toSel = new Map<string, RequirementNode & { type: "selection" }>();
    walkSelections(fromGroups.get(groupId)!.root, groupId, "root", fromSel);
    walkSelections(toGroups.get(groupId)!.root, groupId, "root", toSel);

    for (const [sig, node] of fromSel) {
      const other = toSel.get(sig);
      if (!other) {
        destructive.push({
          category: "destructive",
          kind: "selection_removed",
          path: `/requirements/${groupId}`,
          message: `Selection node removed (${node.ruleType}, source=${node.itemsSource ?? "explicit"})`,
          before: node,
        });
        continue;
      }
      if (node.ruleType !== other.ruleType) {
        destructive.push({
          category: "destructive",
          kind: "rule_type_changed",
          path: `/requirements/${groupId}`,
          message: `Rule type changed: ${node.ruleType} → ${other.ruleType}`,
          before: node.ruleType,
          after: other.ruleType,
        });
      }
      if (node.ruleValue !== other.ruleValue) {
        destructive.push({
          category: "destructive",
          kind: "rule_value_changed",
          path: `/requirements/${groupId}`,
          message: `Rule count changed: ${node.ruleValue ?? "—"} → ${other.ruleValue ?? "—"}`,
          before: node.ruleValue,
          after: other.ruleValue,
        });
      }
    }
    for (const [sig, node] of toSel) {
      if (!fromSel.has(sig)) {
        additive.push({
          category: "additive",
          kind: "selection_added",
          path: `/requirements/${groupId}`,
          message: `New selection branch (${node.ruleType}, source=${node.itemsSource ?? "explicit"})`,
          after: node,
        });
      }
    }
  }

  const fromSubjects = new Map<string, { subjectId: string; path: string; required: boolean }>();
  const toSubjects = new Map<string, { subjectId: string; path: string; required: boolean }>();
  for (const group of from.requirements) {
    collectSubjects(group.root, { groupId: group.groupId, path: "root" }, fromSubjects);
  }
  for (const group of to.requirements) {
    collectSubjects(group.root, { groupId: group.groupId, path: "root" }, toSubjects);
  }

  for (const [key, entry] of fromSubjects) {
    if (entry.subjectId.includes(":")) continue;
    if (!toSubjects.has(key)) {
      destructive.push({
        category: "destructive",
        kind: entry.required ? "required_subject_removed" : "optional_subject_removed",
        path: entry.path,
        message: `Subject removed: ${entry.subjectId}`,
        before: entry.subjectId,
      });
    }
  }
  for (const [key, entry] of toSubjects) {
    if (entry.subjectId.includes(":")) continue;
    if (!fromSubjects.has(key)) {
      additive.push({
        category: "additive",
        kind: entry.required ? "required_subject_added" : "optional_subject_added",
        path: entry.path,
        message: `Subject added: ${entry.subjectId}`,
        after: entry.subjectId,
      });
    }
  }

  const fromCross = new Map((from.girCrosswalk ?? []).map((e) => [crosswalkKey(e), e]));
  const toCross = new Map((to.girCrosswalk ?? []).map((e) => [crosswalkKey(e), e]));
  for (const [key, entry] of fromCross) {
    if (!toCross.has(key)) {
      destructive.push({
        category: "destructive",
        kind: "gir_crosswalk_removed",
        path: "/girCrosswalk",
        message: `GIR crosswalk entry removed: ${entry.subjectId} → ${entry.satisfies.join(", ")}`,
        before: entry,
      });
    }
  }
  for (const [key, entry] of toCross) {
    if (!fromCross.has(key)) {
      additive.push({
        category: "additive",
        kind: "gir_crosswalk_added",
        path: "/girCrosswalk",
        message: `GIR crosswalk entry added: ${entry.subjectId} → ${entry.satisfies.join(", ")}`,
        after: entry,
      });
    }
  }

  if (options?.fromSharedLists && options?.toSharedLists) {
    const listDiffs = compareSharedLists(
      options.fromSharedLists,
      options.toSharedLists,
      from.program,
    );
    for (const entry of listDiffs) {
      if (entry.category === "additive") additive.push(entry);
      else destructive.push(entry);
    }
  }

  return {
    program: to.program,
    fromRevision: from.revisionId,
    toRevision: to.revisionId,
    additive,
    destructive,
    informational,
    hasDestructiveChanges: destructive.length > 0,
    safeToAutoMerge: destructive.length === 0 && additive.length > 0,
  };
}

export function formatDiffReport(report: DegreeDiffReport): string {
  const lines: string[] = [
    `Degree diff: ${report.program}`,
    `  from: ${report.fromRevision ?? "(unknown)"}`,
    `  to:   ${report.toRevision ?? "(unknown)"}`,
    `  destructive: ${report.destructive.length}`,
    `  additive:    ${report.additive.length}`,
    `  safe to auto-merge: ${report.safeToAutoMerge}`,
    "",
  ];

  if (report.destructive.length) {
    lines.push("=== Destructive ===");
    for (const e of report.destructive) {
      lines.push(`  [${e.kind}] ${e.message} (${e.path})`);
    }
    lines.push("");
  }
  if (report.additive.length) {
    lines.push("=== Additive ===");
    for (const e of report.additive) {
      lines.push(`  [${e.kind}] ${e.message} (${e.path})`);
    }
    lines.push("");
  }
  if (report.informational.length) {
    lines.push("=== Informational ===");
    for (const e of report.informational) {
      lines.push(`  [${e.kind}] ${e.message}`);
    }
  }
  return lines.join("\n");
}
