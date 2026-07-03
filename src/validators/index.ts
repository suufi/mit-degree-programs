import type { ZodIssue } from "zod";
import {
  degreeProgramSchema,
  girTemplateSchema,
  itemSetSchema,
  sharedListRegistrySchema,
  sharedListSchema,
} from "../schemas/zod";
import type {
  DegreeProgram,
  GirTemplate,
  RequirementNode,
  SharedListDocument,
  ValidationError,
  ValidationResult,
} from "../schemas/types";
import {
  validateDegreeProgramWithAjv,
  validateGirTemplateWithAjv,
  validateItemSetWithAjv,
  validateSharedListWithAjv,
} from "./ajv";
import { buildSharedListRegistry } from "../resolution/shared-list-registry";
import { isValidSharedListRefForProgram } from "../schemas/course6-shared-lists";

type ValidatorEngine = "zod" | "ajv";

function normalizeZodIssues(issues: ZodIssue[]): ValidationError[] {
  return issues.map((issue) => ({
    path: issue.path.length ? `/${issue.path.join("/")}` : "/",
    message: issue.message,
    source: "zod",
  }));
}

function collectSharedListRefs(node: RequirementNode, sink: string[]): void {
  if (node.type === "selection") {
    if (node.itemsSource === "shared_list" && node.sharedListId) {
      sink.push(node.sharedListId);
    }
    if (node.itemsSource === "shared_list_union" && node.sharedListIds) {
      sink.push(...node.sharedListIds);
    }
    if (node.items) {
      node.items.forEach((child) => collectSharedListRefs(child, sink));
    }
  }
  if (node.type === "group" && node.items) {
    node.items.forEach((child) => collectSharedListRefs(child, sink));
  }
}

function validateSharedListReferences(
  program: DegreeProgram,
  sharedLists: SharedListDocument[] | undefined,
): ValidationError[] {
  if (!sharedLists) return [];
  const { registry, errors } = buildSharedListRegistry(sharedLists);
  const refs: string[] = [];

  program.requirements.forEach((group) => collectSharedListRefs(group.root, refs));

  for (const ref of refs) {
    const list = registry.get(ref);
    if (!list) {
      errors.push({
        path: "/requirements",
        message: `Missing sharedListId reference: ${ref}`,
        source: "semantic",
      });
      continue;
    }
    if (!isValidSharedListRefForProgram(program.program, ref, list.program)) {
      errors.push({
        path: "/requirements",
        message: `sharedListId ${ref} is not valid for program ${program.program} (owned by ${list.program}).`,
        source: "semantic",
      });
    }
  }
  return errors;
}

export function validateDegreeProgram(
  input: unknown,
  options?: {
    engine?: ValidatorEngine;
    sharedLists?: SharedListDocument[];
  },
): ValidationResult<DegreeProgram> {
  const engine = options?.engine ?? "zod";
  const parsedSharedLists = options?.sharedLists
    ? sharedListRegistrySchema.safeParse(options.sharedLists)
    : undefined;

  if (parsedSharedLists && !parsedSharedLists.success) {
    return { ok: false, errors: normalizeZodIssues(parsedSharedLists.error.issues) };
  }

  if (engine === "ajv") {
    const ajvResult = validateDegreeProgramWithAjv(input);
    if (!ajvResult.ok) return ajvResult;
    const semanticErrors = validateSharedListReferences(ajvResult.data, parsedSharedLists?.data);
    if (semanticErrors.length > 0) return { ok: false, errors: semanticErrors };
    return ajvResult;
  }

  const parsed = degreeProgramSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: normalizeZodIssues(parsed.error.issues) };
  }
  const programData = parsed.data as DegreeProgram;
  const semanticErrors = validateSharedListReferences(programData, parsedSharedLists?.data);
  if (semanticErrors.length > 0) return { ok: false, errors: semanticErrors };
  return { ok: true, data: programData };
}

export function validateGirTemplate(
  input: unknown,
  engine: ValidatorEngine = "zod",
): ValidationResult<GirTemplate> {
  if (engine === "ajv") return validateGirTemplateWithAjv(input);
  const parsed = girTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: normalizeZodIssues(parsed.error.issues) };
  }
  return { ok: true, data: parsed.data as GirTemplate };
}

export function validateItemSet(
  input: unknown,
  engine: ValidatorEngine = "zod",
): ValidationResult<ReturnType<typeof itemSetSchema.parse>> {
  if (engine === "ajv") return validateItemSetWithAjv(input);
  const parsed = itemSetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: normalizeZodIssues(parsed.error.issues) };
  }
  return { ok: true, data: parsed.data };
}

export function validateSharedList(
  input: unknown,
  engine: ValidatorEngine = "zod",
): ValidationResult<SharedListDocument> {
  if (engine === "ajv") return validateSharedListWithAjv(input);
  const parsed = sharedListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: normalizeZodIssues(parsed.error.issues) };
  }
  return { ok: true, data: parsed.data };
}
