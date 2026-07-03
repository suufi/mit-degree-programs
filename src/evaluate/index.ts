import type { GirTemplate, RequirementGroup, RequirementNode, SelectionNode } from "../schemas/types";
import {
  checkRequirementConstraints,
  countChooseNWithMaxPerTerm,
  filterSubjectsForTagPool,
  latestAllowedYearForNextCi,
} from "./constraints";
import type {
  ConstraintCheckResult,
  ScheduledSubject,
  StudentProfile,
} from "./types";

export type CommunicationEvaluation = {
  groupId: "gir-communication";
  hassPortion: {
    required: number;
    countResult: ReturnType<typeof countChooseNWithMaxPerTerm> | null;
    constraints: ConstraintCheckResult;
  };
  pace: ConstraintCheckResult;
  overall: ConstraintCheckResult;
};

function findSelectionByTagPool(
  node: RequirementNode,
  tagPool: string,
): SelectionNode | null {
  if (node.type === "selection" && node.tagPool === tagPool) {
    return node;
  }
  if (node.type === "group") {
    for (const child of node.items) {
      const found = findSelectionByTagPool(child, tagPool);
      if (found) return found;
    }
  }
  return null;
}

export function findRequirementGroup(
  gir: GirTemplate,
  groupId: string,
): RequirementGroup | undefined {
  return gir.requirements.find((group) => group.groupId === groupId);
}

export function evaluateCommunicationRequirement(
  gir: GirTemplate,
  schedule: ScheduledSubject[],
  options: {
    entryTerm: string;
    profile?: StudentProfile;
  },
): CommunicationEvaluation | null {
  const group = findRequirementGroup(gir, "gir-communication");
  if (!group) {
    return null;
  }

  const ciHSelection = findSelectionByTagPool(group.root, "gir:ci-h");
  const hassSubjects = filterSubjectsForTagPool(schedule, "gir:ci-h");
  const paceConstraint = group.constraints?.find((c) => c.type === "pace_by_year");

  let countResult: CommunicationEvaluation["hassPortion"]["countResult"] = null;
  const hassViolations: ConstraintCheckResult = { satisfied: true, violations: [] };

  if (ciHSelection?.ruleValue) {
    const maxPerTerm = ciHSelection.constraints?.find((c) => c.type === "max_per_term");
    if (maxPerTerm) {
      countResult = countChooseNWithMaxPerTerm(hassSubjects, ciHSelection.ruleValue, maxPerTerm);
      if (!countResult.satisfied) {
        hassViolations.satisfied = false;
        hassViolations.violations.push({
          constraintType: "choose_n",
          message: `Need ${ciHSelection.ruleValue} CI-H/HW HASS subjects but only ${countResult.counted} count toward the requirement.`,
        });
      }
    }

    const firstMustMatch = ciHSelection.constraints?.find((c) => c.type === "first_must_match");
    if (firstMustMatch) {
      const firstCheck = checkRequirementConstraints([firstMustMatch], {
        subjects: schedule,
        entryTerm: options.entryTerm,
        profile: options.profile,
        tagPoolsInScope: ["gir:ci-h", "gir:ci-m"],
      });
      if (!firstCheck.satisfied) {
        hassViolations.satisfied = false;
        hassViolations.violations.push(...firstCheck.violations);
      }
    }
  }

  let pace: ConstraintCheckResult = { satisfied: true, violations: [] };
  if (paceConstraint) {
    pace = checkRequirementConstraints([paceConstraint], {
      subjects: schedule,
      entryTerm: options.entryTerm,
    });
  }

  const overallViolations = [...hassViolations.violations, ...pace.violations];

  return {
    groupId: "gir-communication",
    hassPortion: {
      required: ciHSelection?.ruleValue ?? 2,
      countResult,
      constraints: hassViolations,
    },
    pace,
    overall: {
      satisfied: overallViolations.length === 0,
      violations: overallViolations,
    },
  };
}

export function communicationPaceDeadline(
  gir: GirTemplate,
  schedule: ScheduledSubject[],
  entryTerm: string,
): number | null {
  const group = findRequirementGroup(gir, "gir-communication");
  const paceConstraint = group?.constraints?.find((c) => c.type === "pace_by_year");
  if (!paceConstraint || paceConstraint.type !== "pace_by_year") {
    return null;
  }
  return latestAllowedYearForNextCi(schedule, paceConstraint, entryTerm);
}

export * from "./constraints";
export * from "./terms";
export * from "./types";
