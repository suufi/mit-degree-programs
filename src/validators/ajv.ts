import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type {
  DegreeProgram,
  GirTemplate,
  ItemSet,
  SharedListDocument,
  ValidationError,
  ValidationResult,
} from "../schemas/types";
import {
  degreeProgramJsonSchema,
  girTemplateJsonSchema,
  itemSetJsonSchema,
  requirementNodeJsonSchema,
  sharedListJsonSchema,
} from "../schemas/json-schema";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(ajv);

ajv.addSchema(requirementNodeJsonSchema);
ajv.addSchema(degreeProgramJsonSchema);
ajv.addSchema(girTemplateJsonSchema);
ajv.addSchema(itemSetJsonSchema);
ajv.addSchema(sharedListJsonSchema);

const validateDegreeProgramFn = ajv.getSchema<DegreeProgram>(
  "https://sipb-mapping/schemas/degree-program.json",
)!;
const validateItemSetFn = ajv.getSchema<ItemSet>("https://sipb-mapping/schemas/item-set.json")!;
const validateSharedListFn = ajv.getSchema<SharedListDocument>(
  "https://sipb-mapping/schemas/shared-list.json",
)!;
const validateGirTemplateFn = ajv.getSchema<GirTemplate>(
  "https://sipb-mapping/schemas/gir-template.json",
)!;

function mapAjvErrors(errors: typeof validateDegreeProgramFn.errors): ValidationError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? "Invalid value",
    source: "ajv",
  }));
}

export function validateDegreeProgramWithAjv(input: unknown): ValidationResult<DegreeProgram> {
  const ok = validateDegreeProgramFn(input);
  if (!ok) {
    return { ok: false, errors: mapAjvErrors(validateDegreeProgramFn.errors) };
  }
  return { ok: true, data: input as DegreeProgram };
}

export function validateItemSetWithAjv(input: unknown): ValidationResult<ItemSet> {
  const ok = validateItemSetFn(input);
  if (!ok) {
    return { ok: false, errors: mapAjvErrors(validateItemSetFn.errors) };
  }
  return { ok: true, data: input as ItemSet };
}

export function validateSharedListWithAjv(input: unknown): ValidationResult<SharedListDocument> {
  const ok = validateSharedListFn(input);
  if (!ok) {
    return { ok: false, errors: mapAjvErrors(validateSharedListFn.errors) };
  }
  return { ok: true, data: input as SharedListDocument };
}

export function validateGirTemplateWithAjv(input: unknown): ValidationResult<GirTemplate> {
  const ok = validateGirTemplateFn(input);
  if (!ok) {
    return { ok: false, errors: mapAjvErrors(validateGirTemplateFn.errors) };
  }
  return { ok: true, data: input as GirTemplate };
}

export { ajv };
