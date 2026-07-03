import { SUBJECT_ID_PATTERN } from "./enums";

export { SUBJECT_ID_PATTERN };
export const KEBAB_ID_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
export const SHARED_LIST_ID_PATTERN = "^[a-z0-9-]+\\.[a-z0-9]+(?:-[a-z0-9]+)*$";

const baseProperties = {
  note: { type: ["string", "null"] },
} as const;

const flexibilityProperties = {
  flexibility: {
    type: "object",
    additionalProperties: false,
    properties: {
      openEnded: { type: "boolean" },
      requiresCoherentPlan: { type: "boolean" },
      advisorApproval: { type: "boolean" },
      catalogText: { type: "string", minLength: 1 },
    },
  },
} as const;

const requirementConstraintProperties = {
  constraints: {
    type: "array",
    items: {
      $ref: "https://sipb-mapping/schemas/requirement-node.json#/$defs/RequirementConstraint",
    },
  },
} as const;

export const requirementNodeJsonSchema = {
  $id: "https://sipb-mapping/schemas/requirement-node.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    PaceMilestone: {
      type: "object",
      additionalProperties: false,
      required: ["byEndOfYear", "minCount"],
      properties: {
        byEndOfYear: { type: "integer", minimum: 1 },
        minCount: { type: "integer", minimum: 0 },
      },
    },
    RequirementConstraint: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "tagField", "tagValue", "max"],
          properties: {
            type: { const: "max_per_term" },
            tagField: {
              enum: ["communicationRequirement", "hassAttribute", "girAttribute", "classTags"],
            },
            tagValue: { type: "string", minLength: 1 },
            max: { type: "integer", minimum: 1 },
            note: { type: ["string", "null"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "tagField", "tagValue", "scope"],
          properties: {
            type: { const: "first_must_match" },
            tagField: {
              enum: ["communicationRequirement", "hassAttribute", "girAttribute", "classTags"],
            },
            tagValue: { type: "string", minLength: 1 },
            scope: { type: "string", minLength: 1 },
            unless: {
              type: "object",
              additionalProperties: false,
              required: ["placement"],
              properties: {
                placement: {
                  type: "array",
                  minItems: 1,
                  items: { enum: ["FEE", "AP", "IB"] },
                },
              },
            },
            note: { type: ["string", "null"] },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "milestones", "tagPools"],
          properties: {
            type: { const: "pace_by_year" },
            milestones: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/$defs/PaceMilestone" },
            },
            tagPools: {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
            note: { type: ["string", "null"] },
          },
        },
      ],
    },
    SubjectNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "subjectId"],
      properties: {
        type: { const: "subject" },
        subjectId: { type: "string", pattern: SUBJECT_ID_PATTERN },
        unitOverride: { type: "integer", minimum: 1 },
        ...baseProperties,
      },
    },
    GroupNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ruleType", "items"],
      properties: {
        type: { const: "group" },
        ruleType: { const: "all_of" },
        items: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/RequirementNode" },
        },
        ...baseProperties,
        ...flexibilityProperties,
        ...requirementConstraintProperties,
      },
    },
    SelectionNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ruleType"],
      properties: {
        type: { const: "selection" },
        ruleType: {
          enum: ["choose_one", "choose_n", "choose_units", "choose_units_approved"],
        },
        ruleValue: { type: "integer", minimum: 1 },
        items: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/RequirementNode" },
        },
        itemsSource: {
          enum: [
            "explicit",
            "item_set",
            "advisor_defined",
            "shared_list",
            "shared_list_union",
            "tag_pool",
          ],
        },
        itemSetId: { type: "string", pattern: KEBAB_ID_PATTERN },
        sharedListId: { type: "string", pattern: SHARED_LIST_ID_PATTERN },
        sharedListIds: {
          type: "array",
          minItems: 1,
          items: { type: "string", pattern: SHARED_LIST_ID_PATTERN },
        },
        tagPool: { type: "string", minLength: 1 },
        openGradesTag: {
          type: "object",
          additionalProperties: false,
          required: ["field", "values"],
          properties: {
            field: {
              enum: ["communicationRequirement", "hassAttribute", "girAttribute", "classTags"],
            },
            values: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          },
        },
        approvalRequired: { type: "boolean" },
        ...baseProperties,
        ...flexibilityProperties,
        ...requirementConstraintProperties,
      },
      allOf: [
        {
          if: { properties: { ruleType: { enum: ["choose_n", "choose_units", "choose_units_approved"] } } },
          then: { required: ["ruleValue"] },
          else: { not: { required: ["ruleValue"] } },
        },
        {
          if: { properties: { ruleType: { const: "choose_units_approved" } } },
          then: { properties: { approvalRequired: { const: true } }, required: ["approvalRequired"] },
        },
        {
          if: { properties: { itemsSource: { const: "explicit" } }, required: ["itemsSource"] },
          then: { required: ["items"] },
        },
        {
          if: { properties: { itemsSource: { const: "item_set" } }, required: ["itemsSource"] },
          then: { required: ["itemSetId"], not: { required: ["items"] } },
        },
        {
          if: { properties: { itemsSource: { const: "advisor_defined" } }, required: ["itemsSource"] },
          then: { not: { required: ["items"] } },
        },
        {
          if: { properties: { itemsSource: { const: "shared_list" } }, required: ["itemsSource"] },
          then: { required: ["sharedListId"], not: { required: ["items"] } },
        },
        {
          if: { properties: { itemsSource: { const: "shared_list_union" } }, required: ["itemsSource"] },
          then: { required: ["sharedListIds"], not: { required: ["items"] } },
        },
        {
          if: { properties: { itemsSource: { const: "tag_pool" } }, required: ["itemsSource"] },
          then: { required: ["tagPool"], not: { required: ["items"] } },
        },
      ],
    },
    RequirementNode: {
      oneOf: [
        { $ref: "#/$defs/SubjectNode" },
        { $ref: "#/$defs/GroupNode" },
        { $ref: "#/$defs/SelectionNode" },
      ],
    },
  },
  $ref: "#/$defs/RequirementNode",
} as const;

export const degreeProgramJsonSchema = {
  $id: "https://sipb-mapping/schemas/degree-program.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["program", "title", "level", "complete", "requirements"],
  properties: {
    schemaVersion: { type: "string", minLength: 1 },
    program: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    level: { enum: ["undergraduate", "graduate"] },
    complete: { type: "boolean" },
    catalogYear: { type: "string", minLength: 1 },
    effectiveTerm: { type: "string", minLength: 1 },
    revisionId: { type: "string", minLength: 1 },
    supersedes: { type: "string", minLength: 1 },
    supersededBy: { type: "string", minLength: 1 },
    status: { enum: ["current", "archived", "draft"] },
    includesGir: { enum: ["sb"] },
    catalogSource: {
      type: "object",
      additionalProperties: false,
      required: ["url", "slug", "scrapedAt", "contentHash"],
      properties: {
        url: { type: "string", minLength: 1 },
        slug: { type: "string", minLength: 1 },
        scrapedAt: { type: "string", minLength: 1 },
        contentHash: { type: "string", minLength: 1 },
      },
    },
    eecsSource: {
      type: "object",
      additionalProperties: false,
      required: ["url", "programKey", "enterYear", "level", "scrapedAt", "contentHash"],
      properties: {
        url: { type: "string", minLength: 1 },
        programKey: { type: "string", minLength: 1 },
        enterYear: { type: "integer", minimum: 1990, maximum: 2100 },
        level: { enum: ["SB", "MNG"] },
        scrapedAt: { type: "string", minLength: 1 },
        contentHash: { type: "string", minLength: 1 },
      },
    },
    girCrosswalk: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subjectId", "satisfies"],
        properties: {
          subjectId: { type: "string", pattern: SUBJECT_ID_PATTERN },
          satisfies: {
            type: "array",
            minItems: 1,
            items: { enum: ["science", "hass", "rest", "lab", "pe"] },
          },
          note: { type: ["string", "null"] },
        },
      },
    },
    footnotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
          appliesTo: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    constraints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type"],
        properties: {
          type: { enum: ["no_double_count", "exclusive_pools"] },
          pools: {
            type: "array",
            items: { type: "string", pattern: SHARED_LIST_ID_PATTERN },
          },
          note: { type: ["string", "null"] },
        },
      },
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["groupId", "title", "bucket", "subcategory", "root"],
        properties: {
          groupId: { type: "string", pattern: KEBAB_ID_PATTERN },
          title: { type: "string", minLength: 1 },
          bucket: { enum: ["gir", "departmental", "elective", "thesis", "unrestricted"] },
          subcategory: {
            enum: [
              "science",
              "hass",
              "rest",
              "lab",
              "required_subjects",
              "fundamentals",
              "restricted_electives",
              "communication",
              "seminar",
              "thesis_preparation",
              "thesis",
              "history_theory_criticism",
              "urbanism",
              "computation",
              "elective_subjects",
              "elective_focus",
              "laboratory",
              "pe",
            ],
          },
          ...baseProperties,
          ...flexibilityProperties,
          ...requirementConstraintProperties,
          root: { $ref: "https://sipb-mapping/schemas/requirement-node.json" },
        },
      },
    },
  },
} as const;

const catalogSourceProperties = {
  url: { type: "string", minLength: 1 },
  slug: { type: "string", minLength: 1 },
  scrapedAt: { type: "string", minLength: 1 },
  contentHash: { type: "string", minLength: 1 },
} as const;

export const girTemplateJsonSchema = {
  $id: "https://sipb-mapping/schemas/gir-template.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "requirements"],
  properties: {
    schemaVersion: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    catalogSources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "slug", "scrapedAt", "contentHash"],
        properties: catalogSourceProperties,
      },
    },
    requirements: degreeProgramJsonSchema.properties.requirements,
  },
} as const;

export const itemSetJsonSchema = {
  $id: "https://sipb-mapping/schemas/item-set.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["itemSetId", "title", "items"],
  properties: {
    itemSetId: { type: "string", pattern: KEBAB_ID_PATTERN },
    title: { type: "string", minLength: 1 },
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "subjectId"],
        properties: {
          type: { const: "subject" },
          subjectId: { type: "string", pattern: SUBJECT_ID_PATTERN },
          unitOverride: { type: "integer", minimum: 1 },
          ...baseProperties,
        },
      },
    },
    constraints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type"],
        properties: {
          type: { type: "string", minLength: 1 },
          ...baseProperties,
        },
      },
    },
    ...baseProperties,
  },
} as const;

const sharedListSubjectItem = {
  type: "object",
  additionalProperties: false,
  required: ["type", "subjectId"],
  properties: {
    type: { const: "subject" },
    subjectId: { type: "string", pattern: SUBJECT_ID_PATTERN },
    unitOverride: { type: "integer", minimum: 1 },
    ...baseProperties,
  },
} as const;

const sharedListGroupItem = {
  type: "object",
  additionalProperties: false,
  required: ["type", "ruleType", "items"],
  properties: {
    type: { const: "group" },
    ruleType: { const: "all_of" },
    items: {
      type: "array",
      minItems: 2,
      items: sharedListSubjectItem,
    },
    ...baseProperties,
  },
} as const;

export const sharedListJsonSchema = {
  $id: "https://sipb-mapping/schemas/shared-list.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["sharedListId", "program", "title", "items"],
  properties: {
    sharedListId: { type: "string", pattern: SHARED_LIST_ID_PATTERN },
    program: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    items: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [sharedListSubjectItem, sharedListGroupItem],
      },
    },
    constraints: itemSetJsonSchema.properties.constraints,
    ...baseProperties,
    version: { type: "string", minLength: 1 },
  },
} as const;
