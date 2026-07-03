import { z } from "zod";
import type {
  DegreeProgram,
  ProgramConstraint,
  ProgramFootnote,
  RequirementGroup,
  SharedListDocument,
} from "../schemas/types";
import { generateGeminiJson } from "../llm/gemini";
import { validateDegreeProgram } from "../validators/index";
import type { DegreeChartAst } from "./parse-degree-chart";
import { mergeRequirementGroups } from "./normalize-common";

const llmEnrichmentSchema = z.object({
  footnotes: z
    .array(
      z.object({
        id: z.string(),
        appliesTo: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  constraints: z
    .array(
      z.object({
        type: z.enum(["no_double_count", "exclusive_pools"]),
        pools: z.array(z.string()).optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  requirementGroups: z.array(z.record(z.string(), z.unknown())).optional(),
  reviewNotes: z.array(z.string()).optional(),
});

export type LlmEnrichment = z.infer<typeof llmEnrichmentSchema>;

export function needsLlmEnrichment(ast: DegreeChartAst, program: DegreeProgram): boolean {
  const proseRows = ast.departmentalRows.filter((row) => row.kind === "prose");
  const ambiguousUnits = ast.departmentalRows.filter(
    (row) =>
      row.kind === "choose_units" &&
      (/consultation with advisor|coherent plan|subject to approval/i.test(row.text) ||
        !/\d+\.\d+/.test(row.text)),
  );
  const footnotesNeedingLinks = (program.footnotes ?? []).some(
    (footnote) =>
      /but not both|not both|either .+ or/i.test(footnote.text) && !footnote.appliesTo?.length,
  );
  return proseRows.length > 0 || ambiguousUnits.length > 0 || footnotesNeedingLinks;
}

function extractRelevantMarkdown(markdown: string): string {
  const withoutNav = markdown.split(/Print Options/i)[0] ?? markdown;
  return withoutNav.slice(0, 12000);
}

function buildPrompt(
  ast: DegreeChartAst,
  program: DegreeProgram,
  sharedLists: SharedListDocument[],
  markdown: string,
): string {
  const prose = ast.departmentalRows.filter((row) => row.kind === "prose" || row.kind === "choose_units");
  const poolIds = sharedLists.map((list) => list.sharedListId);

  return `You are enriching MIT degree requirement JSON produced by a rule-based parser.

Return JSON only with this shape:
{
  "footnotes": [{ "id": "1", "appliesTo": ["program.slug"] }],
  "constraints": [{ "type": "exclusive_pools", "pools": ["program.slug"], "note": "..." }],
  "requirementGroups": [],
  "reviewNotes": ["human review items"]
}

Rules:
- Program id prefix for shared lists: "${program.program}."
- Known sharedListIds: ${JSON.stringify(poolIds)}
- Use exclusive_pools only when a footnote says subjects cannot count toward multiple pools.
- Do NOT set flexibility.openEnded when enumerated shared lists already define the pool.
- For advisor-defined unit requirements without a subject list, use itemsSource "advisor_defined" with choose_units or choose_units_approved.
- requirementGroups must follow schema: groupId, title, bucket, subcategory, root (subject/group/selection nodes).
- Leave arrays empty when nothing to add.
- Do not duplicate requirement groups already present.

Program: ${program.title} (${program.program}, ${program.level})
Existing footnotes: ${JSON.stringify(program.footnotes, null, 2)}
Existing constraints: ${JSON.stringify(program.constraints ?? [], null, 2)}
Existing group titles: ${JSON.stringify(program.requirements.map((group) => group.title))}
Unresolved rows: ${JSON.stringify(prose, null, 2)}
AST footnotes: ${JSON.stringify(ast.footnotes, null, 2)}

Catalog markdown excerpt:
${extractRelevantMarkdown(markdown)}`;
}

function mergeFootnotes(
  base: ProgramFootnote[],
  patches: LlmEnrichment["footnotes"],
): ProgramFootnote[] {
  if (!patches?.length) return base;
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  return base.map((footnote) => {
    const patch = patchById.get(footnote.id);
    if (!patch?.appliesTo?.length) return footnote;
    return { ...footnote, appliesTo: patch.appliesTo };
  });
}

function mergeConstraints(
  base: ProgramConstraint[],
  patches: LlmEnrichment["constraints"],
): ProgramConstraint[] {
  if (!patches?.length) return base;
  const merged = [...base];
  for (const patch of patches) {
    const duplicate = merged.some(
      (constraint) =>
        constraint.type === patch.type &&
        JSON.stringify(constraint.pools ?? []) === JSON.stringify(patch.pools ?? []),
    );
    if (!duplicate) merged.push(patch);
  }
  return merged;
}

function stripOpenEndedFromEnumeratedLists(program: DegreeProgram): DegreeProgram {
  const requirements = program.requirements.map((group) => {
    const root = group.root;
    const hasEnumeratedUnion =
      root.type === "selection" &&
      (root.itemsSource === "shared_list_union" || root.itemsSource === "shared_list") &&
      ((root.sharedListIds?.length ?? 0) > 0 || Boolean(root.sharedListId));

    if (!hasEnumeratedUnion || !group.flexibility?.openEnded) return group;
    const { openEnded: _removed, ...restFlex } = group.flexibility;
    return {
      ...group,
      flexibility: Object.keys(restFlex).length > 0 ? restFlex : undefined,
    };
  });
  return { ...program, requirements };
}

export async function enrichDegreeWithGemini(
  ast: DegreeChartAst,
  program: DegreeProgram,
  sharedLists: SharedListDocument[],
  markdown: string,
): Promise<{ program: DegreeProgram; sharedLists: SharedListDocument[]; enrichment?: LlmEnrichment }> {
  if (!needsLlmEnrichment(ast, program)) {
    return { program: stripOpenEndedFromEnumeratedLists(program), sharedLists };
  }

  const prompt = buildPrompt(ast, program, sharedLists, markdown);
  const enrichment = llmEnrichmentSchema.parse(await generateGeminiJson<unknown>(prompt));

  let nextProgram: DegreeProgram = {
    ...program,
    footnotes: mergeFootnotes(program.footnotes ?? [], enrichment.footnotes),
    constraints: mergeConstraints(program.constraints ?? [], enrichment.constraints),
  };

  if (enrichment.requirementGroups?.length) {
    const parsedGroups = enrichment.requirementGroups as RequirementGroup[];
    const candidate = {
      ...nextProgram,
      requirements: mergeRequirementGroups([...nextProgram.requirements, ...parsedGroups]),
    };
    const groupValidation = validateDegreeProgram(candidate, { sharedLists });
    if (groupValidation.ok) {
      nextProgram = groupValidation.data;
    }
  }

  nextProgram = stripOpenEndedFromEnumeratedLists(nextProgram);

  const validated = validateDegreeProgram(nextProgram, { sharedLists });
  if (!validated.ok) {
    throw new Error(
      `Gemini enrichment failed validation: ${validated.errors.map((error) => error.message).join("; ")}`,
    );
  }

  return { program: validated.data, sharedLists, enrichment };
}
