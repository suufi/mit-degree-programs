import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkFirstMustMatch,
  checkPaceByYear,
  checkRequirementConstraints,
  countChooseNWithMaxPerTerm,
  latestAllowedYearForNextCi,
} from "./constraints";
import { academicYearForTerm } from "./terms";
import type { MaxPerTermConstraint, PaceByYearConstraint } from "../schemas/requirement-constraints";
import type { ScheduledSubject } from "./types";

const maxCiHPerTerm: MaxPerTermConstraint = {
  type: "max_per_term",
  tagField: "communicationRequirement",
  tagValue: "CI-H",
  max: 1,
};

describe("academicYearForTerm", () => {
  it("maps entry fall through spring to year 1", () => {
    assert.equal(academicYearForTerm("2024-FA", "2024-FA"), 1);
    assert.equal(academicYearForTerm("2025-IAP", "2024-FA"), 1);
    assert.equal(academicYearForTerm("2025-SP", "2024-FA"), 1);
    assert.equal(academicYearForTerm("2025-FA", "2024-FA"), 2);
  });
});

describe("countChooseNWithMaxPerTerm", () => {
  it("counts only one CI-H per term toward the requirement", () => {
    const subjects: ScheduledSubject[] = [
      { subjectId: "21H.001", term: "2024-FA", communicationRequirement: "CI-H" },
      { subjectId: "21H.002", term: "2024-FA", communicationRequirement: "CI-H" },
      { subjectId: "21W.001", term: "2025-SP", communicationRequirement: "CI-HW" },
    ];

    const result = countChooseNWithMaxPerTerm(subjects, 2, maxCiHPerTerm);
    assert.equal(result.counted, 2);
    assert.equal(result.satisfied, true);
    assert.deepEqual(result.countingSubjectIds, ["21H.001", "21W.001"]);
  });

  it("fails when two CI-H in one term cannot reach required count alone", () => {
    const subjects: ScheduledSubject[] = [
      { subjectId: "21H.001", term: "2024-FA", communicationRequirement: "CI-H" },
      { subjectId: "21H.002", term: "2024-FA", communicationRequirement: "CI-H" },
    ];

    const result = countChooseNWithMaxPerTerm(subjects, 2, maxCiHPerTerm);
    assert.equal(result.counted, 1);
    assert.equal(result.satisfied, false);
  });
});

describe("checkFirstMustMatch", () => {
  it("requires CI-HW first without placement", () => {
    const schedule: ScheduledSubject[] = [
      { subjectId: "21H.001", term: "2024-FA", communicationRequirement: "CI-H" },
    ];

    const result = checkFirstMustMatch(
      schedule,
      {
        type: "first_must_match",
        tagField: "communicationRequirement",
        tagValue: "CI-HW",
        scope: "gir-communication",
        unless: { placement: ["FEE", "AP", "IB"] },
      },
      {},
      ["gir:ci-h", "gir:ci-m"],
    );

    assert.equal(result.satisfied, false);
  });

  it("waives CI-HW-first when student has placement", () => {
    const schedule: ScheduledSubject[] = [
      { subjectId: "21H.001", term: "2024-FA", communicationRequirement: "CI-H" },
    ];

    const result = checkFirstMustMatch(
      schedule,
      {
        type: "first_must_match",
        tagField: "communicationRequirement",
        tagValue: "CI-HW",
        scope: "gir-communication",
        unless: { placement: ["FEE", "AP", "IB"] },
      },
      { placements: ["AP"] },
      ["gir:ci-h", "gir:ci-m"],
    );

    assert.equal(result.satisfied, true);
  });
});

describe("checkPaceByYear", () => {
  const pace: PaceByYearConstraint = {
    type: "pace_by_year",
    tagPools: ["gir:ci-h", "gir:ci-m"],
    milestones: [
      { byEndOfYear: 1, minCount: 1 },
      { byEndOfYear: 2, minCount: 2 },
    ],
  };

  it("flags missing first-year CI", () => {
    const result = checkPaceByYear([], pace, "2024-FA");
    assert.equal(result.satisfied, false);
    assert.match(result.violations[0].message, /year 1/);
  });

  it("passes when milestones are met on schedule", () => {
    const schedule: ScheduledSubject[] = [
      { subjectId: "21W.001", term: "2025-SP", communicationRequirement: "CI-HW" },
      { subjectId: "6.UAT", term: "2025-FA", classTags: ["CI-M"] },
    ];

    const result = checkPaceByYear(schedule, pace, "2024-FA");
    assert.equal(result.satisfied, true);
  });
});

describe("latestAllowedYearForNextCi", () => {
  it("returns year 1 when no CI subjects are scheduled", () => {
    const pace: PaceByYearConstraint = {
      type: "pace_by_year",
      tagPools: ["gir:ci-h", "gir:ci-m"],
      milestones: [{ byEndOfYear: 1, minCount: 1 }],
    };

    assert.equal(latestAllowedYearForNextCi([], pace, "2024-FA"), 1);
  });
});

describe("checkRequirementConstraints", () => {
  it("evaluates bundled node constraints", () => {
    const subjects: ScheduledSubject[] = [
      { subjectId: "21W.001", term: "2024-FA", communicationRequirement: "CI-HW" },
      { subjectId: "21H.001", term: "2025-SP", communicationRequirement: "CI-H" },
    ];

    const result = checkRequirementConstraints(
      [maxCiHPerTerm],
      { subjects, entryTerm: "2024-FA", requiredCount: 2 },
    );

    assert.equal(result.satisfied, true);
  });
});
