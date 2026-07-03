import type { OpenGradesTagField } from "../schemas/enums";
import { resolveOpenGradesTag } from "../schemas/tag-mapping";
import type {
  FirstMustMatchConstraint,
  MaxPerTermConstraint,
  PaceByYearConstraint,
  RequirementConstraint,
} from "../schemas/requirement-constraints";
import { academicYearForTerm, sortByTerm } from "./terms";
import type {
  ChooseNCountResult,
  ClassTags,
  ConstraintCheckResult,
  ConstraintViolation,
  FieldValue,
  ScheduledSubject,
  StudentProfile,
  TagFieldAccessor,
} from "./types";

export const defaultTagFieldAccessor: TagFieldAccessor = (subject, field) => {
  switch (field) {
    case "communicationRequirement":
      return subject.communicationRequirement;
    case "hassAttribute":
      return subject.hassAttribute;
    case "girAttribute":
      return subject.girAttribute;
    case "classTags":
      return subject.classTags;
    default:
      return undefined;
  }
};

export function getTagFieldValue(
  subject: ClassTags,
  field: OpenGradesTagField,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): FieldValue {
  return accessor(subject, field);
}

export function subjectMatchesTagValue(
  subject: ClassTags,
  field: OpenGradesTagField,
  tagValue: string,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): boolean {
  const value = getTagFieldValue(subject, field, accessor);
  if (Array.isArray(value)) {
    return value.includes(tagValue);
  }
  return value === tagValue;
}

export function subjectMatchesTagPool(
  subject: ClassTags,
  tagPool: string,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): boolean {
  const mapping = resolveOpenGradesTag(tagPool);
  if (!mapping?.field) {
    return false;
  }
  const value = getTagFieldValue(subject, mapping.field, accessor);
  if (Array.isArray(value)) {
    return mapping.values.some((tag) => value.includes(tag));
  }
  return mapping.values.includes(value as string);
}

export function filterSubjectsForTagPool(
  subjects: ScheduledSubject[],
  tagPool: string,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ScheduledSubject[] {
  return subjects.filter((subject) => subjectMatchesTagPool(subject, tagPool, accessor));
}

export function filterSubjectsForTagPools(
  subjects: ScheduledSubject[],
  tagPools: string[],
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ScheduledSubject[] {
  return subjects.filter((subject) =>
    tagPools.some((pool) => subjectMatchesTagPool(subject, pool, accessor)),
  );
}

/**
 * Count subjects toward a choose_n slot, applying max_per_term caps.
 * Subjects not matching `limitedTagValue` are counted without a per-term cap.
 */
export function countChooseNWithMaxPerTerm(
  subjects: ScheduledSubject[],
  required: number,
  constraint: MaxPerTermConstraint,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ChooseNCountResult {
  const limited = constraint.tagValue;
  const byTerm = new Map<string, ScheduledSubject[]>();
  for (const subject of subjects) {
    const bucket = byTerm.get(subject.term) ?? [];
    bucket.push(subject);
    byTerm.set(subject.term, bucket);
  }

  const countingSubjectIds: string[] = [];
  let counted = 0;

  for (const termSubjects of byTerm.values()) {
    const limitedInTerm = termSubjects.filter((subject) =>
      subjectMatchesTagValue(subject, constraint.tagField, limited, accessor),
    );
    const unlimitedInTerm = termSubjects.filter(
      (subject) => !subjectMatchesTagValue(subject, constraint.tagField, limited, accessor),
    );

    const limitedCount = Math.min(limitedInTerm.length, constraint.max);
    for (let i = 0; i < limitedCount; i++) {
      countingSubjectIds.push(limitedInTerm[i].subjectId);
    }
    for (const subject of unlimitedInTerm) {
      countingSubjectIds.push(subject.subjectId);
    }
    counted += limitedCount + unlimitedInTerm.length;
  }

  return {
    required,
    counted,
    satisfied: counted >= required,
    countingSubjectIds,
  };
}

export function checkMaxPerTerm(
  subjects: ScheduledSubject[],
  required: number,
  constraint: MaxPerTermConstraint,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ConstraintCheckResult {
  const result = countChooseNWithMaxPerTerm(subjects, required, constraint, accessor);
  if (result.satisfied) {
    return { satisfied: true, violations: [] };
  }
  return {
    satisfied: false,
    violations: [
      {
        constraintType: "max_per_term",
        message: `Need ${required} countable subjects but only ${result.counted} count after applying max ${constraint.max} ${constraint.tagValue} per term.`,
      },
    ],
  };
}

export function checkFirstMustMatch(
  subjects: ScheduledSubject[],
  constraint: FirstMustMatchConstraint,
  profile: StudentProfile,
  tagPoolsInScope: string[],
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ConstraintCheckResult {
  const exemptPlacements = constraint.unless?.placement ?? [];
  if (profile.placements?.some((placement) => exemptPlacements.includes(placement))) {
    return { satisfied: true, violations: [] };
  }

  const inScope = filterSubjectsForTagPools(subjects, tagPoolsInScope, accessor);
  const ordered = sortByTerm(inScope);
  if (ordered.length === 0) {
    return { satisfied: true, violations: [] };
  }

  const first = ordered[0];
  if (subjectMatchesTagValue(first, constraint.tagField, constraint.tagValue, accessor)) {
    return { satisfied: true, violations: [] };
  }

  return {
    satisfied: false,
    violations: [
      {
        constraintType: "first_must_match",
        scope: constraint.scope,
        message: `First CI subject (${first.subjectId} in ${first.term}) must be ${constraint.tagValue} without ${exemptPlacements.join("/")} placement.`,
      },
    ],
  };
}

export function countSubjectsByAcademicYear(
  subjects: ScheduledSubject[],
  entryTerm: string,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const subject of subjects) {
    const year = academicYearForTerm(subject.term, entryTerm);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return counts;
}

/** Cumulative CI count through the end of each academic year. */
export function cumulativeCiCountByYear(
  subjects: ScheduledSubject[],
  entryTerm: string,
  tagPools: string[],
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): Map<number, number> {
  const matching = sortByTerm(filterSubjectsForTagPools(subjects, tagPools, accessor));
  const cumulative = new Map<number, number>();
  if (matching.length === 0) {
    return cumulative;
  }

  let running = 0;
  let lastYear = 0;
  for (const subject of matching) {
    const year = academicYearForTerm(subject.term, entryTerm);
    running += 1;
    cumulative.set(year, running);
    lastYear = Math.max(lastYear, year);
  }

  let carry = 0;
  for (let year = 1; year <= lastYear; year++) {
    if (cumulative.has(year)) {
      carry = cumulative.get(year)!;
    } else {
      cumulative.set(year, carry);
    }
  }

  return cumulative;
}

export function checkPaceByYear(
  subjects: ScheduledSubject[],
  constraint: PaceByYearConstraint,
  entryTerm: string,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ConstraintCheckResult {
  const cumulative = cumulativeCiCountByYear(
    subjects,
    entryTerm,
    constraint.tagPools,
    accessor,
  );
  const violations: ConstraintViolation[] = [];

  for (const milestone of constraint.milestones) {
    const count = cumulative.get(milestone.byEndOfYear) ?? 0;
    if (count < milestone.minCount) {
      violations.push({
        constraintType: "pace_by_year",
        message: `By end of year ${milestone.byEndOfYear}, need at least ${milestone.minCount} CI subject(s) but have ${count}.`,
      });
    }
  }

  return { satisfied: violations.length === 0, violations };
}

export function checkRequirementConstraints(
  constraints: RequirementConstraint[],
  context: {
    subjects: ScheduledSubject[];
    entryTerm: string;
    profile?: StudentProfile;
    requiredCount?: number;
    tagPoolsInScope?: string[];
  },
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): ConstraintCheckResult {
  const violations: ConstraintViolation[] = [];
  const profile = context.profile ?? {};

  for (const constraint of constraints) {
    if (constraint.type === "max_per_term") {
      const required = context.requiredCount ?? 0;
      const result = checkMaxPerTerm(context.subjects, required, constraint, accessor);
      violations.push(...result.violations);
      continue;
    }

    if (constraint.type === "first_must_match") {
      const pools = context.tagPoolsInScope ?? [];
      const result = checkFirstMustMatch(
        context.subjects,
        constraint,
        profile,
        pools,
        accessor,
      );
      violations.push(...result.violations);
      continue;
    }

    if (constraint.type === "pace_by_year") {
      const result = checkPaceByYear(context.subjects, constraint, context.entryTerm, accessor);
      violations.push(...result.violations);
    }
  }

  return { satisfied: violations.length === 0, violations };
}

/**
 * Returns the latest academic year by which a new CI subject must be scheduled
 * to stay on pace, given subjects already on the schedule.
 */
export function latestAllowedYearForNextCi(
  subjects: ScheduledSubject[],
  constraint: PaceByYearConstraint,
  entryTerm: string,
  accessor: TagFieldAccessor = defaultTagFieldAccessor,
): number | null {
  const cumulative = cumulativeCiCountByYear(
    subjects,
    entryTerm,
    constraint.tagPools,
    accessor,
  );
  const currentTotal = filterSubjectsForTagPools(subjects, constraint.tagPools, accessor).length;

  for (const milestone of constraint.milestones) {
    const countAtYear = cumulative.get(milestone.byEndOfYear) ?? 0;
    if (countAtYear < milestone.minCount && currentTotal < milestone.minCount) {
      return milestone.byEndOfYear;
    }
  }

  return null;
}

export function describeConstraint(constraint: RequirementConstraint): string {
  switch (constraint.type) {
    case "max_per_term":
      return `Max ${constraint.max} ${constraint.tagValue} per term (${constraint.tagField})`;
    case "first_must_match":
      return `First in ${constraint.scope} must be ${constraint.tagValue}`;
    case "pace_by_year":
      return `Pace: ${constraint.milestones.map((m) => `≥${m.minCount} by year ${m.byEndOfYear}`).join(", ")}`;
    default:
      return "Unknown constraint";
  }
}
