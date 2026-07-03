import type { OpenGradesTagField } from "./enums";

/**
 * Canonical mapping from sipb-mapping `tagPool` IDs to MITOpenGrades Class model
 * fields (`models/Class.ts`: communicationRequirement, hassAttribute, girAttribute).
 */
export type TagPoolMapping = {
  tagPool: string;
  label: string;
  field: OpenGradesTagField | null;
  values: string[];
  /** Class.ts source for documentation. */
  classModelField?: string;
};

export const TAG_POOL_MAPPINGS: Record<string, TagPoolMapping> = {
  "gir:science": {
    tagPool: "gir:science",
    label: "Science Requirement (all core slots)",
    field: "girAttribute",
    values: ["CHEM", "BIOL", "PHY1", "PHY2", "CAL1", "CAL2"],
    classModelField: "girAttribute",
  },
  "gir:chem": {
    tagPool: "gir:chem",
    label: "Chemistry (GIR)",
    field: "girAttribute",
    values: ["CHEM"],
    classModelField: "girAttribute",
  },
  "gir:biol": {
    tagPool: "gir:biol",
    label: "Biology (GIR)",
    field: "girAttribute",
    values: ["BIOL"],
    classModelField: "girAttribute",
  },
  "gir:phy1": {
    tagPool: "gir:phy1",
    label: "Physics I (GIR)",
    field: "girAttribute",
    values: ["PHY1"],
    classModelField: "girAttribute",
  },
  "gir:phy2": {
    tagPool: "gir:phy2",
    label: "Physics II (GIR)",
    field: "girAttribute",
    values: ["PHY2"],
    classModelField: "girAttribute",
  },
  "gir:cal1": {
    tagPool: "gir:cal1",
    label: "Calculus I (GIR)",
    field: "girAttribute",
    values: ["CAL1"],
    classModelField: "girAttribute",
  },
  "gir:cal2": {
    tagPool: "gir:cal2",
    label: "Calculus II (GIR)",
    field: "girAttribute",
    values: ["CAL2"],
    classModelField: "girAttribute",
  },
  "gir:hass": {
    tagPool: "gir:hass",
    label: "HASS (any)",
    field: "hassAttribute",
    values: ["HASS-A", "HASS-E", "HASS-H", "HASS-S"],
    classModelField: "hassAttribute",
  },
  "gir:hass-h": {
    tagPool: "gir:hass-h",
    label: "HASS — Humanities",
    field: "hassAttribute",
    values: ["HASS-H"],
    classModelField: "hassAttribute",
  },
  "gir:hass-a": {
    tagPool: "gir:hass-a",
    label: "HASS — Arts",
    field: "hassAttribute",
    values: ["HASS-A"],
    classModelField: "hassAttribute",
  },
  "gir:hass-s": {
    tagPool: "gir:hass-s",
    label: "HASS — Social Sciences",
    field: "hassAttribute",
    values: ["HASS-S"],
    classModelField: "hassAttribute",
  },
  "gir:hass-e": {
    tagPool: "gir:hass-e",
    label: "HASS — Electives",
    field: "hassAttribute",
    values: ["HASS-E"],
    classModelField: "hassAttribute",
  },
  "gir:rest": {
    tagPool: "gir:rest",
    label: "REST",
    field: "girAttribute",
    values: ["REST"],
    classModelField: "girAttribute",
  },
  "gir:lab": {
    tagPool: "gir:lab",
    label: "Laboratory",
    field: "girAttribute",
    values: ["LAB", "PLAB"],
    classModelField: "girAttribute",
  },
  "gir:communication": {
    tagPool: "gir:communication",
    label: "Communication Requirement (CI overall)",
    field: null,
    values: ["CI-H", "CI-HW", "CI-M"],
  },
  "gir:ci-h": {
    tagPool: "gir:ci-h",
    label: "Communication — HASS portion (CI-H/HW)",
    field: "communicationRequirement",
    values: ["CI-H", "CI-HW"],
    classModelField: "communicationRequirement",
  },
  "gir:ci-m": {
    tagPool: "gir:ci-m",
    label: "Communication — major portion (CI-M)",
    field: "classTags",
    values: ["CI-M"],
    classModelField: "classTags",
  },
  "gir:pe": {
    tagPool: "gir:pe",
    label: "Physical Education courses",
    field: null,
    values: [],
  },
  "gir:pe-swim": {
    tagPool: "gir:pe-swim",
    label: "PE swimming requirement",
    field: null,
    values: [],
  },
};

export function resolveOpenGradesTag(tagPool: string): TagPoolMapping | undefined {
  return TAG_POOL_MAPPINGS[tagPool];
}

export function openGradesTagRef(tagPool: string) {
  const mapping = TAG_POOL_MAPPINGS[tagPool];
  if (!mapping?.field) return undefined;
  return { field: mapping.field, values: mapping.values };
}
