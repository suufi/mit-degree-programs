import type {
  Bucket,
  ConstraintType,
  GirSatisfies,
  IncludesGir,
  ItemsSource,
  Level,
  OpenGradesTagField,
  RevisionStatus,
  RuleType,
  Subcategory,
} from "./enums";
import type { RequirementConstraint } from "./requirement-constraints";

export type FlexibilityMetadata = {
  openEnded?: boolean;
  requiresCoherentPlan?: boolean;
  advisorApproval?: boolean;
  catalogText?: string;
};

export type SubjectNode = {
  type: "subject";
  subjectId: string;
  unitOverride?: number;
  note?: string | null;
};

export type GroupNode = {
  type: "group";
  ruleType: "all_of";
  items: RequirementNode[];
  note?: string | null;
  flexibility?: FlexibilityMetadata;
  constraints?: RequirementConstraint[];
};

type SelectionRuleType =
  | "choose_one"
  | "choose_n"
  | "choose_units"
  | "choose_units_approved";

export type OpenGradesTagRef = {
  field: OpenGradesTagField;
  values: string[];
};

export type SelectionNode = {
  type: "selection";
  ruleType: SelectionRuleType;
  ruleValue?: number;
  items?: RequirementNode[];
  itemsSource?: ItemsSource;
  itemSetId?: string;
  sharedListId?: string;
  sharedListIds?: string[];
  tagPool?: string;
  /** Optional override; otherwise resolved from tag-pools registry. */
  openGradesTag?: OpenGradesTagRef;
  approvalRequired?: boolean;
  note?: string | null;
  flexibility?: FlexibilityMetadata;
  constraints?: RequirementConstraint[];
};

export type RequirementNode = SubjectNode | GroupNode | SelectionNode;

export type RequirementGroup = {
  groupId: string;
  title: string;
  bucket: Bucket;
  subcategory: Subcategory;
  note?: string | null;
  flexibility?: FlexibilityMetadata;
  constraints?: RequirementConstraint[];
  root: RequirementNode;
};

export type CatalogSource = {
  url: string;
  slug: string;
  scrapedAt: string;
  contentHash: string;
};

/** EECS department page provenance (eecsis.mit.edu). */
export type EecsSource = {
  url: string;
  /** Page key such as 6-3_2025 — program plus entering class year. */
  programKey: string;
  /** MIT entering year the requirements apply to (e.g. 2025 → Fall 2025 entry). */
  enterYear: number;
  level: "SB" | "MNG";
  scrapedAt: string;
  contentHash: string;
};

export type GirCrosswalkEntry = {
  subjectId: string;
  satisfies: GirSatisfies[];
  note?: string;
};

export type ProgramFootnote = {
  id: string;
  text: string;
  appliesTo?: string[];
};

export type ProgramConstraint = {
  type: ConstraintType;
  pools?: string[];
  note?: string;
};

export type DegreeProgram = {
  schemaVersion?: string;
  program: string;
  title: string;
  level: Level;
  complete: boolean;
  /** Catalog year label, e.g. "2025". */
  catalogYear?: string;
  /** Effective term code, e.g. "2025-FA". */
  effectiveTerm?: string;
  /** Stable revision slug: `<program>-<date>-<contentHashPrefix>`. */
  revisionId?: string;
  /** Prior revision this snapshot replaces. */
  supersedes?: string;
  /** Successor revision when archived. */
  supersededBy?: string;
  status?: RevisionStatus;
  includesGir?: IncludesGir;
  catalogSource?: CatalogSource;
  eecsSource?: EecsSource;
  girCrosswalk?: GirCrosswalkEntry[];
  footnotes?: ProgramFootnote[];
  constraints?: ProgramConstraint[];
  requirements: RequirementGroup[];
};

export type DegreeManifestEntry = {
  courseDir: string;
  currentRevision: string;
  revisions: Array<{
    revisionId: string;
    status: RevisionStatus;
    archivedAt?: string;
  }>;
};

export type DegreeManifest = {
  schemaVersion: string;
  programs: Record<string, DegreeManifestEntry>;
};

export type GirTemplate = {
  schemaVersion?: string;
  id: string;
  title: string;
  catalogSources?: CatalogSource[];
  requirements: RequirementGroup[];
};

export type ItemSetConstraint = {
  type: "no_double_count_within_program" | string;
  note?: string | null;
};

export type ItemSet = {
  itemSetId: string;
  title: string;
  items: SubjectNode[];
  constraints?: ItemSetConstraint[];
  note?: string | null;
};

/**
 * Group item inside a shared list — a small `all_of` cluster of subjects that
 * must be taken together to satisfy a single slot (e.g. 7.093 & 7.094 on the
 * COMPBIO/BIORE lists, which the source page joins with `&`).
 *
 * Restricted to leaf `SubjectNode` children so shared lists remain flat
 * enough for `itemsSource: "shared_list_union"` selectors to reason about.
 */
export type SharedListGroupNode = {
  type: "group";
  ruleType: "all_of";
  items: SubjectNode[];
  note?: string | null;
};

export type SharedListItem = SubjectNode | SharedListGroupNode;

export type SharedListDocument = {
  sharedListId: string;
  program: string;
  title: string;
  items: SharedListItem[];
  constraints?: ItemSetConstraint[];
  note?: string | null;
  version?: string;
};

export type ValidationError = {
  path: string;
  message: string;
  source: "zod" | "ajv" | "semantic";
};

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ValidationError[] };

export type RuleTypeForNode<TNode extends RequirementNode["type"]> = TNode extends "group"
  ? "all_of"
  : TNode extends "selection"
    ? Exclude<RuleType, "all_of">
    : never;

export type {
  RequirementConstraint,
  MaxPerTermConstraint,
  FirstMustMatchConstraint,
  PaceByYearConstraint,
  PaceMilestone,
} from "./requirement-constraints";
