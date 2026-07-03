import type { OpenGradesTagField, PlacementType } from "../schemas/enums";

/** OpenGrades Class tag fields used when evaluating tag-pool constraints. */
export type ClassTags = {
  communicationRequirement?: string | null;
  hassAttribute?: string | null;
  girAttribute?: string[];
  classTags?: string[];
};

/** A subject on a student's schedule or transcript. */
export type ScheduledSubject = ClassTags & {
  subjectId: string;
  /** MIT term code, e.g. `2025-FA`, `2025-SP`, `2025-IAP`. */
  term: string;
};

export type StudentProfile = {
  /** CI placement exemptions (FEE, AP, IB). */
  placements?: PlacementType[];
};

export type ConstraintViolation = {
  constraintType: string;
  message: string;
  /** Related requirement group id when applicable. */
  scope?: string;
};

export type ConstraintCheckResult = {
  satisfied: boolean;
  violations: ConstraintViolation[];
};

export type ChooseNCountResult = {
  required: number;
  counted: number;
  satisfied: boolean;
  /** Subject ids that count toward the requirement after applying constraints. */
  countingSubjectIds: string[];
};

export type FieldValue = string | string[] | null | undefined;

export type TagFieldAccessor = (subject: ClassTags, field: OpenGradesTagField) => FieldValue;
