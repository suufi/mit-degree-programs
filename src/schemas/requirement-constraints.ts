import { z } from "zod";
import { OPENGRADES_TAG_FIELDS, PLACEMENT_TYPES, REQUIREMENT_CONSTRAINT_TYPES } from "./enums";

const nonEmptyString = z.string().trim().min(1);
const optionalNote = z.string().trim().min(1).nullable().optional();
const positiveInt = z.number().int().positive();

export const paceMilestoneSchema = z
  .object({
    byEndOfYear: positiveInt,
    minCount: z.number().int().nonnegative(),
  })
  .strict();

export const placementUnlessSchema = z
  .object({
    placement: z.array(z.enum(PLACEMENT_TYPES)).min(1),
  })
  .strict();

export const maxPerTermConstraintSchema = z
  .object({
    type: z.literal("max_per_term"),
    tagField: z.enum(OPENGRADES_TAG_FIELDS),
    tagValue: nonEmptyString,
    max: positiveInt,
    note: optionalNote,
  })
  .strict();

export const firstMustMatchConstraintSchema = z
  .object({
    type: z.literal("first_must_match"),
    tagField: z.enum(OPENGRADES_TAG_FIELDS),
    tagValue: nonEmptyString,
    /** Requirement group id (e.g. `gir-communication`) defining ordering scope. */
    scope: nonEmptyString,
    unless: placementUnlessSchema.optional(),
    note: optionalNote,
  })
  .strict();

export const paceByYearConstraintSchema = z
  .object({
    type: z.literal("pace_by_year"),
    milestones: z.array(paceMilestoneSchema).min(1),
    /** Tag pools whose fulfilled subjects count toward pace (e.g. `gir:ci-h`, `gir:ci-m`). */
    tagPools: z.array(nonEmptyString).min(1),
    note: optionalNote,
  })
  .strict()
  .superRefine((constraint, ctx) => {
    for (let i = 1; i < constraint.milestones.length; i++) {
      const prev = constraint.milestones[i - 1];
      const curr = constraint.milestones[i];
      if (curr.byEndOfYear <= prev.byEndOfYear) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pace_by_year milestones must be sorted by ascending byEndOfYear",
          path: ["milestones", i, "byEndOfYear"],
        });
      }
      if (curr.minCount < prev.minCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pace_by_year minCount must be non-decreasing across milestones",
          path: ["milestones", i, "minCount"],
        });
      }
    }
  });

export const requirementConstraintSchema = z.discriminatedUnion("type", [
  maxPerTermConstraintSchema,
  firstMustMatchConstraintSchema,
  paceByYearConstraintSchema,
]);

export type PaceMilestone = z.infer<typeof paceMilestoneSchema>;
export type PlacementUnless = z.infer<typeof placementUnlessSchema>;
export type MaxPerTermConstraint = z.infer<typeof maxPerTermConstraintSchema>;
export type FirstMustMatchConstraint = z.infer<typeof firstMustMatchConstraintSchema>;
export type PaceByYearConstraint = z.infer<typeof paceByYearConstraintSchema>;
export type RequirementConstraint = z.infer<typeof requirementConstraintSchema>;

export const REQUIREMENT_CONSTRAINT_TYPE_VALUES = REQUIREMENT_CONSTRAINT_TYPES;
