import { z } from "zod";
import {
  BUCKETS,
  CONSTRAINT_TYPES,
  GIR_SATISFIES,
  INCLUDES_GIR,
  ITEMS_SOURCES,
  LEVELS,
  NODE_TYPES,
  OPENGRADES_TAG_FIELDS,
  REVISION_STATUSES,
  RULE_TYPES,
  SUBCATEGORIES,
  SUBJECT_ID_PATTERN,
} from "./enums";
import { requirementConstraintSchema } from "./requirement-constraints";

const SUBJECT_ID_REGEX = new RegExp(SUBJECT_ID_PATTERN);
const KEBAB_ID_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHARED_LIST_ID_REGEX = /^[a-z0-9-]+\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

const nonEmptyString = z.string().trim().min(1);
const optionalNote = z.string().trim().min(1).nullable().optional();
const positiveInt = z.number().int().positive();

export const levelSchema = z.enum(LEVELS);
export const bucketSchema = z.enum(BUCKETS);
export const subcategorySchema = z.enum(SUBCATEGORIES);
export const nodeTypeSchema = z.enum(NODE_TYPES);
export const ruleTypeSchema = z.enum(RULE_TYPES);
export const itemsSourceSchema = z.enum(ITEMS_SOURCES);

export const flexibilitySchema = z
  .object({
    openEnded: z.boolean().optional(),
    requiresCoherentPlan: z.boolean().optional(),
    advisorApproval: z.boolean().optional(),
    catalogText: nonEmptyString.optional(),
  })
  .strict();

export const subjectIdSchema = z
  .string()
  .regex(SUBJECT_ID_REGEX, "Invalid MIT subjectId format");

const subjectNodeSchema = z
  .object({
    type: z.literal("subject"),
    subjectId: subjectIdSchema,
    unitOverride: positiveInt.optional(),
    note: optionalNote,
  })
  .strict();

function validateSelectionSource(
  node: {
    ruleType: string;
    ruleValue?: number;
    approvalRequired?: boolean;
    items?: unknown[];
    itemsSource?: string;
    itemSetId?: string;
    sharedListId?: string;
    sharedListIds?: string[];
    tagPool?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const requiresRuleValue =
    node.ruleType === "choose_n" ||
    node.ruleType === "choose_units" ||
    node.ruleType === "choose_units_approved";
  if (requiresRuleValue && node.ruleValue === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ruleValue is required for choose_n/choose_units variants",
      path: ["ruleValue"],
    });
  }
  if (!requiresRuleValue && node.ruleValue !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ruleValue is not allowed for this ruleType",
      path: ["ruleValue"],
    });
  }

  if (node.ruleType === "choose_units_approved" && node.approvalRequired !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "approvalRequired must be true for choose_units_approved",
      path: ["approvalRequired"],
    });
  }

  const source = node.itemsSource ?? "explicit";
  if (source === "explicit" && !node.items?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "items are required when itemsSource is explicit",
      path: ["items"],
    });
  }
  if (source === "item_set") {
    if (!node.itemSetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "itemSetId is required when itemsSource is item_set",
        path: ["itemSetId"],
      });
    }
    if (node.items) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "items are not allowed when itemsSource is item_set",
        path: ["items"],
      });
    }
  }
  if (source === "shared_list") {
    if (!node.sharedListId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sharedListId is required when itemsSource is shared_list",
        path: ["sharedListId"],
      });
    }
    if (node.items) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "items are not allowed when itemsSource is shared_list",
        path: ["items"],
      });
    }
  }
  if (source === "shared_list_union") {
    if (!node.sharedListIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sharedListIds is required when itemsSource is shared_list_union",
        path: ["sharedListIds"],
      });
    }
    if (node.items) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "items are not allowed when itemsSource is shared_list_union",
        path: ["items"],
      });
    }
  }
  if (source === "tag_pool") {
    if (!node.tagPool) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tagPool is required when itemsSource is tag_pool",
        path: ["tagPool"],
      });
    }
    if (node.items) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "items are not allowed when itemsSource is tag_pool",
        path: ["items"],
      });
    }
  }
  if (source === "advisor_defined" && node.items) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "items are not allowed when itemsSource is advisor_defined",
      path: ["items"],
    });
  }
  if (source !== "item_set" && node.itemSetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "itemSetId is only allowed when itemsSource is item_set",
      path: ["itemSetId"],
    });
  }
  if (source !== "shared_list" && node.sharedListId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sharedListId is only allowed when itemsSource is shared_list",
      path: ["sharedListId"],
    });
  }
  if (source !== "shared_list_union" && node.sharedListIds?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sharedListIds is only allowed when itemsSource is shared_list_union",
      path: ["sharedListIds"],
    });
  }
  if (source !== "tag_pool" && node.tagPool) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tagPool is only allowed when itemsSource is tag_pool",
      path: ["tagPool"],
    });
  }
  if (
    node.ruleType === "choose_n" &&
    node.items &&
    node.ruleValue &&
    node.ruleValue > node.items.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ruleValue cannot exceed number of explicit items for choose_n",
      path: ["ruleValue"],
    });
  }
}

const groupNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      type: z.literal("group"),
      ruleType: z.literal("all_of"),
      items: z.array(requirementNodeSchema).min(1),
      note: optionalNote,
      flexibility: flexibilitySchema.optional(),
      constraints: z.array(requirementConstraintSchema).optional(),
    })
    .strict(),
);

export const openGradesTagRefSchema = z
  .object({
    field: z.enum(OPENGRADES_TAG_FIELDS),
    values: z.array(nonEmptyString).min(1),
  })
  .strict();

const selectionNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      type: z.literal("selection"),
      ruleType: z.enum([
        "choose_one",
        "choose_n",
        "choose_units",
        "choose_units_approved",
      ]),
      ruleValue: positiveInt.optional(),
      items: z.array(requirementNodeSchema).min(1).optional(),
      itemsSource: itemsSourceSchema.optional(),
      itemSetId: z.string().regex(KEBAB_ID_REGEX).optional(),
      sharedListId: z.string().regex(SHARED_LIST_ID_REGEX).optional(),
      sharedListIds: z.array(z.string().regex(SHARED_LIST_ID_REGEX)).min(1).optional(),
      tagPool: nonEmptyString.optional(),
      openGradesTag: openGradesTagRefSchema.optional(),
      approvalRequired: z.boolean().optional(),
      note: optionalNote,
      flexibility: flexibilitySchema.optional(),
      constraints: z.array(requirementConstraintSchema).optional(),
    })
    .strict()
    .superRefine((node, ctx) => validateSelectionSource(node, ctx)),
);

export const requirementNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([subjectNodeSchema, groupNodeSchema, selectionNodeSchema]),
);

export const requirementGroupSchema = z
  .object({
    groupId: z.string().regex(KEBAB_ID_REGEX, "groupId must be lowercase kebab-case"),
    title: nonEmptyString,
    bucket: bucketSchema,
    subcategory: subcategorySchema,
    note: optionalNote,
    flexibility: flexibilitySchema.optional(),
    constraints: z.array(requirementConstraintSchema).optional(),
    root: requirementNodeSchema,
  })
  .strict();

export const catalogSourceSchema = z
  .object({
    url: nonEmptyString,
    slug: nonEmptyString,
    scrapedAt: nonEmptyString,
    contentHash: nonEmptyString,
  })
  .strict();

export const eecsSourceSchema = z
  .object({
    url: nonEmptyString,
    programKey: nonEmptyString,
    enterYear: z.number().int().min(1990).max(2100),
    level: z.enum(["SB", "MNG"]),
    scrapedAt: nonEmptyString,
    contentHash: nonEmptyString,
  })
  .strict();

export const girCrosswalkEntrySchema = z
  .object({
    subjectId: subjectIdSchema,
    satisfies: z.array(z.enum(GIR_SATISFIES)).min(1),
    note: optionalNote,
  })
  .strict();

export const programFootnoteSchema = z
  .object({
    id: nonEmptyString,
    text: nonEmptyString,
    appliesTo: z.array(nonEmptyString).optional(),
  })
  .strict();

export const programConstraintSchema = z
  .object({
    type: z.enum(CONSTRAINT_TYPES),
    pools: z.array(z.string().regex(SHARED_LIST_ID_REGEX)).optional(),
    note: optionalNote,
  })
  .strict();

export const degreeProgramSchema = z
  .object({
    schemaVersion: z.string().trim().min(1).optional(),
    program: nonEmptyString,
    title: nonEmptyString,
    level: levelSchema,
    complete: z.boolean(),
    catalogYear: nonEmptyString.optional(),
    effectiveTerm: nonEmptyString.optional(),
    revisionId: nonEmptyString.optional(),
    supersedes: nonEmptyString.optional(),
    supersededBy: nonEmptyString.optional(),
    status: z.enum(REVISION_STATUSES).optional(),
    includesGir: z.enum(INCLUDES_GIR).optional(),
    catalogSource: catalogSourceSchema.optional(),
    eecsSource: eecsSourceSchema.optional(),
    girCrosswalk: z.array(girCrosswalkEntrySchema).optional(),
    footnotes: z.array(programFootnoteSchema).optional(),
    constraints: z.array(programConstraintSchema).optional(),
    requirements: z.array(requirementGroupSchema),
  })
  .strict()
  .superRefine((program, ctx) => {
    const seen = new Set<string>();
    for (const [idx, req] of program.requirements.entries()) {
      if (seen.has(req.groupId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate groupId: ${req.groupId}`,
          path: ["requirements", idx, "groupId"],
        });
      }
      seen.add(req.groupId);
    }
  });

export const girTemplateSchema = z
  .object({
    schemaVersion: z.string().trim().min(1).optional(),
    id: nonEmptyString,
    title: nonEmptyString,
    catalogSources: z.array(catalogSourceSchema).optional(),
    requirements: z.array(requirementGroupSchema),
  })
  .strict();

export const itemSetConstraintSchema = z
  .object({
    type: nonEmptyString,
    note: optionalNote,
  })
  .strict();

export const itemSetSchema = z
  .object({
    itemSetId: z.string().regex(KEBAB_ID_REGEX, "itemSetId must be lowercase kebab-case"),
    title: nonEmptyString,
    items: z.array(subjectNodeSchema).min(1),
    constraints: z.array(itemSetConstraintSchema).optional(),
    note: optionalNote,
  })
  .strict();

const sharedListGroupItemSchema = z
  .object({
    type: z.literal("group"),
    ruleType: z.literal("all_of"),
    items: z.array(subjectNodeSchema).min(2),
    note: optionalNote,
  })
  .strict();

export const sharedListItemSchema = z.union([
  subjectNodeSchema,
  sharedListGroupItemSchema,
]);

export const sharedListSchema = z
  .object({
    sharedListId: z
      .string()
      .regex(SHARED_LIST_ID_REGEX, "sharedListId must match <program>.<list-slug>"),
    program: nonEmptyString,
    title: nonEmptyString,
    items: z.array(sharedListItemSchema).min(1),
    constraints: z.array(itemSetConstraintSchema).optional(),
    note: optionalNote,
    version: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((list, ctx) => {
    const prefix = `${list.program}.`;
    if (!list.sharedListId.startsWith(prefix)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sharedListId must be prefixed by program plus '.'",
        path: ["sharedListId"],
      });
    }
  });

export const sharedListRegistrySchema = z
  .array(sharedListSchema)
  .superRefine((lists, ctx) => {
    const seen = new Set<string>();
    for (const [idx, list] of lists.entries()) {
      if (seen.has(list.sharedListId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate sharedListId: ${list.sharedListId}`,
          path: [idx, "sharedListId"],
        });
      }
      seen.add(list.sharedListId);
    }
  });

export type SubjectNodeInput = z.input<typeof subjectNodeSchema>;
export type GroupNodeInput = z.input<typeof groupNodeSchema>;
export type SelectionNodeInput = z.input<typeof selectionNodeSchema>;
export type RequirementNodeInput = z.input<typeof requirementNodeSchema>;
export type RequirementGroupInput = z.input<typeof requirementGroupSchema>;
export type DegreeProgramInput = z.input<typeof degreeProgramSchema>;
export type GirTemplateInput = z.input<typeof girTemplateSchema>;
export type ItemSetInput = z.input<typeof itemSetSchema>;
export type SharedListInput = z.input<typeof sharedListSchema>;
