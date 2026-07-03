import type {
  DegreeProgram,
  GirTemplate,
  RequirementNode,
  SharedListDocument,
  SharedListItem,
} from "../schemas/types";
import { describeConstraint } from "../evaluate/constraints";
import type { RequirementConstraint } from "../schemas/requirement-constraints";
import { TAG_POOL_MAPPINGS } from "../schemas/tag-mapping";

function sharedListItemLabel(item: SharedListItem): string {
  if (item.type === "subject") return item.subjectId;
  return item.items.map((sub) => sub.subjectId).join(" & ");
}

type TagPoolsFile = {
  pools: Record<string, { label: string; openGradesTag?: { field: string; values: string[] } | null }>;
};

export type VisualizeBundle = {
  program: DegreeProgram;
  sharedLists: SharedListDocument[];
  gir: GirTemplate;
  tagPools: TagPoolsFile;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tagPoolLabel(tagPool: string, tagPools: TagPoolsFile): string {
  return tagPools.pools[tagPool]?.label ?? TAG_POOL_MAPPINGS[tagPool]?.label ?? tagPool;
}

function renderConstraintText(constraint: RequirementConstraint): string {
  return constraint.note ?? describeConstraint(constraint);
}

function unescapeMarkdownForHtml(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
}

function renderConstraintsHtml(constraints?: RequirementConstraint[]): string {
  if (!constraints?.length) return "";
  const items = constraints
    .map((c) => `<li>${escapeHtml(renderConstraintText(c))}</li>`)
    .join("");
  return `<ul class="constraints">${items}</ul>`;
}

function renderConstraintsMd(constraints?: RequirementConstraint[]): string {
  if (!constraints?.length) return "";
  return constraints.map((c) => `  - _Constraint:_ ${renderConstraintText(c)}`).join("\n");
}

function renderNode(
  node: RequirementNode,
  sharedLists: Map<string, SharedListDocument>,
  tagPools: TagPoolsFile,
  depth: number,
): string {
  const pad = depth * 16;
  if (node.type === "subject") {
    const units = node.unitOverride ? ` (${node.unitOverride} units)` : "";
    const note = node.note ? `<div class="note">${escapeHtml(unescapeMarkdownForHtml(node.note))}</div>` : "";
    return `<div class="node subject" style="margin-left:${pad}px">
      <span class="badge subject">subject</span> ${escapeHtml(node.subjectId)}${units}${note}
    </div>`;
  }

  if (node.type === "group") {
    const flex = node.flexibility?.openEnded
      ? `<span class="badge open-ended">open-ended</span>`
      : "";
    const note = node.note ? `<div class="note">${escapeHtml(unescapeMarkdownForHtml(node.note))}</div>` : "";
    const children = node.items.map((c) => renderNode(c, sharedLists, tagPools, depth + 1)).join("");
    return `<div class="node group" style="margin-left:${pad}px">
      <span class="badge group">all of</span> ${flex}${note}
      ${renderConstraintsHtml(node.constraints)}
      <div class="children">${children}</div>
    </div>`;
  }

  const source = node.itemsSource ?? "explicit";
  let sourceDetail = "";
  if (source === "tag_pool" && node.tagPool) {
    sourceDetail = `pool: ${escapeHtml(tagPoolLabel(node.tagPool, tagPools))} (${escapeHtml(node.tagPool)})`;
  } else if (source === "shared_list" && node.sharedListId) {
    const list = sharedLists.get(node.sharedListId);
    sourceDetail = `shared list: ${escapeHtml(node.sharedListId)} (${list?.items.length ?? "?"} subjects)`;
  } else if (source === "shared_list_union" && node.sharedListIds) {
    sourceDetail = `union: ${node.sharedListIds.map((id) => escapeHtml(id)).join(", ")}`;
  } else if (source === "advisor_defined") {
    sourceDetail = "advisor-defined plan";
  }

  const ruleLabel =
    node.ruleType === "choose_one"
      ? "choose one"
      : node.ruleType === "choose_n"
        ? `choose ${node.ruleValue ?? "?"}`
        : node.ruleType === "choose_units"
          ? `choose ${node.ruleValue ?? "?"} units`
          : `choose ${node.ruleValue ?? "?"} units (approved)`;

  const flex = node.flexibility?.openEnded
    ? `<span class="badge open-ended">open-ended</span>`
    : "";
  const note = node.note ? `<div class="note">${escapeHtml(unescapeMarkdownForHtml(node.note))}</div>` : "";
  const children =
    node.items?.map((c) => renderNode(c, sharedLists, tagPools, depth + 1)).join("") ?? "";

  return `<div class="node selection" style="margin-left:${pad}px">
    <span class="badge selection">${escapeHtml(ruleLabel)}</span>
    ${sourceDetail ? `<span class="source">${sourceDetail}</span>` : ""}
    ${flex}${note}
    ${renderConstraintsHtml(node.constraints)}
    ${children ? `<div class="children">${children}</div>` : ""}
  </div>`;
}

export function renderProgramMarkdown(bundle: VisualizeBundle): string {
  const { program, sharedLists, gir, tagPools } = bundle;
  const listMap = new Map(sharedLists.map((l) => [l.sharedListId, l]));
  const lines: string[] = [
    `# ${program.title} (${program.program})`,
    "",
    `- Level: ${program.level}`,
    `- Complete: ${program.complete}`,
  ];
  if (program.revisionId) lines.push(`- Revision: ${program.revisionId} (${program.status ?? "unknown"})`);
  if (program.catalogYear) lines.push(`- Catalog year: ${program.catalogYear}`);
  if (program.effectiveTerm) lines.push(`- Effective term: ${program.effectiveTerm}`);
  if (program.includesGir) lines.push(`- Includes GIR: ${program.includesGir}`);
  if (program.catalogSource) {
    lines.push(`- Catalog: [${program.catalogSource.slug}](${program.catalogSource.url})`);
    lines.push(`- Scraped: ${program.catalogSource.scrapedAt}`);
  }
  lines.push("");

  if (program.girCrosswalk?.length) {
    lines.push("## GIR crosswalk", "");
    for (const entry of program.girCrosswalk) {
      lines.push(`- ${entry.subjectId} → ${entry.satisfies.join(", ")}`);
    }
    lines.push("");
  }

  if (program.footnotes?.length) {
    lines.push("## Footnotes", "");
    for (const fn of program.footnotes) {
      lines.push(`${fn.id}. ${fn.text}`);
    }
    lines.push("");
  }

  lines.push("## Departmental requirements", "");
  for (const group of program.requirements) {
    lines.push(`### ${group.title} (\`${group.groupId}\`)`, "");
    lines.push(`Bucket: ${group.bucket} / ${group.subcategory}`, "");
    if (group.flexibility?.openEnded) lines.push("> Open-ended elective pool", "");
    lines.push(renderNodeToMd(group.root, listMap, tagPools, 0));
    lines.push("");
  }

  if (program.includesGir) {
    lines.push("## Institute GIR (reference)", "", `Template: ${gir.title}`, "");
    for (const group of gir.requirements) {
      lines.push(`### ${group.title}`, "");
      lines.push(renderNodeToMd(group.root, listMap, tagPools, 0));
      lines.push("");
    }
  }

  if (sharedLists.length) {
    lines.push("## Shared lists", "");
    for (const list of sharedLists) {
      lines.push(`### ${list.title} (\`${list.sharedListId}\`)`, "");
      lines.push(list.items.map((i) => `- ${sharedListItemLabel(i)}`).join("\n"));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderNodeToMd(
  node: RequirementNode,
  sharedLists: Map<string, SharedListDocument>,
  tagPools: TagPoolsFile,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  if (node.type === "subject") {
    return `${indent}- **${node.subjectId}**${node.note ? ` — ${node.note}` : ""}`;
  }
  if (node.type === "group") {
    const lines = [`${indent}- **All of:**`];
    if (node.constraints?.length) {
      lines.push(renderConstraintsMd(node.constraints));
    }
    for (const child of node.items) {
      lines.push(renderNodeToMd(child, sharedLists, tagPools, depth + 1));
    }
    return lines.join("\n");
  }
  const rule =
    node.ruleType === "choose_one"
      ? "Choose one"
      : node.ruleType === "choose_n"
        ? `Choose ${node.ruleValue}`
        : node.ruleType === "choose_units"
          ? `Choose ${node.ruleValue} units`
          : `Choose ${node.ruleValue} units (approved)`;
  let detail = "";
  if (node.itemsSource === "tag_pool" && node.tagPool) {
    detail = ` from tag pool **${tagPoolLabel(node.tagPool, tagPools)}** (\`${node.tagPool}\`)`;
  } else if (node.itemsSource === "shared_list" && node.sharedListId) {
    detail = ` from \`${node.sharedListId}\``;
  } else if (node.itemsSource === "shared_list_union" && node.sharedListIds) {
    detail = ` from union: ${node.sharedListIds.map((id) => `\`${id}\``).join(", ")}`;
  } else if (node.itemsSource === "advisor_defined") {
    detail = " (advisor-defined)";
  }
  const noteText = node.note ? ` — ${node.note}` : "";
  const lines = [
    `${indent}- **${rule}**${detail}${noteText}${node.flexibility?.openEnded ? " _(open-ended)_" : ""}`,
  ];
  if (node.constraints?.length) {
    lines.push(renderConstraintsMd(node.constraints));
  }
  if (node.items) {
    for (const child of node.items) {
      lines.push(renderNodeToMd(child, sharedLists, tagPools, depth + 1));
    }
  }
  return lines.join("\n");
}

export function renderProgramHtml(bundle: VisualizeBundle): string {
  const { program, sharedLists, gir, tagPools } = bundle;
  const listMap = new Map(sharedLists.map((l) => [l.sharedListId, l]));

  const metaRows = [
    ["Program", `${program.program} — ${program.title}`],
    ["Level", program.level],
    ["Complete", String(program.complete)],
    program.revisionId ? ["Revision", `${program.revisionId} (${program.status ?? "—"})`] : null,
    program.catalogYear ? ["Catalog year", program.catalogYear] : null,
    program.effectiveTerm ? ["Effective term", program.effectiveTerm] : null,
    program.includesGir ? ["Includes GIR", program.includesGir] : null,
    program.catalogSource
      ? [
          "Catalog source",
          `<a href="${escapeHtml(program.catalogSource.url)}">${escapeHtml(program.catalogSource.slug)}</a> (${escapeHtml(program.catalogSource.scrapedAt)})`,
        ]
      : null,
  ].filter(Boolean) as [string, string][];

  const crosswalk = (program.girCrosswalk ?? [])
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.subjectId)}</td><td>${e.satisfies.map(escapeHtml).join(", ")}</td><td>${escapeHtml(e.note ?? "")}</td></tr>`,
    )
    .join("");

  const footnotes = (program.footnotes ?? [])
    .map((f) => `<li><strong>${escapeHtml(f.id)}.</strong> ${escapeHtml(f.text)}</li>`)
    .join("");

  const groups = program.requirements
    .map((g) => {
      const flex = g.flexibility?.openEnded ? `<span class="badge open-ended">open-ended</span>` : "";
      const groupConstraints = renderConstraintsHtml(g.constraints);
      return `<section class="req-group">
        <h3>${escapeHtml(g.title)} <code>${escapeHtml(g.groupId)}</code> ${flex}</h3>
        <p class="meta">${escapeHtml(g.bucket)} / ${escapeHtml(g.subcategory)}</p>
        ${groupConstraints}
        ${renderNode(g.root, listMap, tagPools, 0)}
      </section>`;
    })
    .join("");

  const girSection = program.includesGir
    ? `<section><h2>Institute GIR (${escapeHtml(gir.id)})</h2>${gir.requirements
        .map(
          (g) =>
            `<section class="req-group"><h3>${escapeHtml(g.title)}</h3>${renderNode(g.root, listMap, tagPools, 0)}</section>`,
        )
        .join("")}</section>`
    : "";

  const sharedSection = sharedLists.length
    ? `<section><h2>Shared lists</h2>${sharedLists
        .map(
          (l) =>
            `<details><summary>${escapeHtml(l.title)} <code>${escapeHtml(l.sharedListId)}</code></summary><ul>${l.items
              .map((i) => `<li>${escapeHtml(sharedListItemLabel(i))}</li>`)
              .join("")}</ul></details>`,
        )
        .join("")}</section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(program.title)} — requirement tree</title>
  <style>
    :root { font-family: system-ui, sans-serif; line-height: 1.45; color: #1a1a1a; }
    body { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h2 { margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
    h3 { margin-top: 1.25rem; font-size: 1.1rem; }
    .meta-table { border-collapse: collapse; margin: 1rem 0; }
    .meta-table th, .meta-table td { text-align: left; padding: 0.25rem 0.75rem 0.25rem 0; vertical-align: top; }
    .meta-table th { color: #555; font-weight: 600; width: 140px; }
    .node { margin: 0.35rem 0; }
    .badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.1rem 0.45rem; border-radius: 4px; margin-right: 0.35rem; }
    .badge.subject { background: #e8f4ea; color: #1b5e20; }
    .badge.group { background: #e3f2fd; color: #0d47a1; }
    .badge.selection { background: #fff3e0; color: #e65100; }
    .badge.open-ended { background: #f3e5f5; color: #6a1b9a; }
    .note { font-size: 0.9rem; color: #555; margin: 0.2rem 0 0.4rem; }
    .constraints { font-size: 0.85rem; color: #444; margin: 0.25rem 0 0.5rem 1.25rem; }
    .source { font-size: 0.9rem; color: #444; }
    .children { border-left: 2px solid #eee; margin-left: 0.5rem; padding-left: 0.5rem; }
    code { font-size: 0.85em; background: #f5f5f5; padding: 0.1rem 0.3rem; border-radius: 3px; }
    details { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(program.title)}</h1>
  <p><code>${escapeHtml(program.program)}</code></p>
  <table class="meta-table">${metaRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join("")}</table>
  ${crosswalk ? `<section><h2>GIR crosswalk</h2><table class="meta-table"><thead><tr><th>Subject</th><th>Satisfies</th><th>Note</th></tr></thead><tbody>${crosswalk}</tbody></table></section>` : ""}
  ${footnotes ? `<section><h2>Footnotes</h2><ol>${footnotes}</ol></section>` : ""}
  <section><h2>Departmental requirements</h2>${groups}</section>
  ${girSection}
  ${sharedSection}
</body>
</html>`;
}
