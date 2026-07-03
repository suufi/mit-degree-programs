export const LEVELS = ["undergraduate", "graduate"] as const;
export type Level = (typeof LEVELS)[number];

export const BUCKETS = [
  "gir",
  "departmental",
  "elective",
  "thesis",
  "unrestricted",
] as const;
export type Bucket = (typeof BUCKETS)[number];

export const SUBCATEGORIES = [
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
] as const;
export type Subcategory = (typeof SUBCATEGORIES)[number];

export const NODE_TYPES = ["subject", "group", "selection"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const RULE_TYPES = [
  "all_of",
  "choose_one",
  "choose_n",
  "choose_units",
  "choose_units_approved",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const ITEMS_SOURCES = [
  "explicit",
  "item_set",
  "advisor_defined",
  "shared_list",
  "shared_list_union",
  "tag_pool",
] as const;
export type ItemsSource = (typeof ITEMS_SOURCES)[number];

export const GIR_SATISFIES = ["science", "hass", "rest", "lab", "pe"] as const;
export type GirSatisfies = (typeof GIR_SATISFIES)[number];

export const CONSTRAINT_TYPES = ["no_double_count", "exclusive_pools"] as const;
export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];

/** Structured rules on requirement nodes (pacing, per-term caps, ordering). */
export const REQUIREMENT_CONSTRAINT_TYPES = [
  "max_per_term",
  "first_must_match",
  "pace_by_year",
] as const;
export type RequirementConstraintType = (typeof REQUIREMENT_CONSTRAINT_TYPES)[number];

/** CI placement exemptions for first_must_match constraints. */
export const PLACEMENT_TYPES = ["FEE", "AP", "IB"] as const;
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

export const INCLUDES_GIR = ["sb"] as const;
export type IncludesGir = (typeof INCLUDES_GIR)[number];

export const REVISION_STATUSES = ["current", "archived", "draft"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** MITOpenGrades Class model fields used for tag-pool resolution. */
export const OPENGRADES_TAG_FIELDS = [
  "communicationRequirement",
  "hassAttribute",
  "girAttribute",
  "classTags",
] as const;
export type OpenGradesTagField = (typeof OPENGRADES_TAG_FIELDS)[number];

export const COMMUNICATION_REQUIREMENTS = ["CI-H", "CI-HW"] as const;
export const HASS_ATTRIBUTES = ["HASS-A", "HASS-E", "HASS-H", "HASS-S"] as const;
export const GIR_ATTRIBUTES = [
  "BIOL",
  "CAL1",
  "CAL2",
  "CHEM",
  "LAB",
  "PLAB",
  "PHY1",
  "PHY2",
  "REST",
] as const;

export const MEMBERSHIP_TYPES = ["required", "option"] as const;
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

/** MIT subject number pattern (includes CC cross-registration and 6.UAR-style IDs). */
export const SUBJECT_ID_PATTERN =
  "^(?:[0-9]{1,2}[A-Z]?|CC)\\.[0-9A-Z]{1,4}[A-Z]?$";
