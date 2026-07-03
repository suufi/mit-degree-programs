import {
  validateDegreeProgram,
  validateItemSet,
  validateSharedList,
} from "../validators/index";
import type { DegreeProgram, ItemSet, SharedListDocument } from "../schemas/types";

const sharedList: SharedListDocument = {
  sharedListId: "6.lab-restricted-electives",
  program: "6",
  title: "Lab Restricted Electives",
  items: [
    { type: "subject", subjectId: "6.2050" },
    { type: "subject", subjectId: "6.2060" },
  ],
};

const itemSet: ItemSet = {
  itemSetId: "6-ai-electives",
  title: "AI Electives",
  items: [
    { type: "subject", subjectId: "6.3900" },
    { type: "subject", subjectId: "6.7910" },
  ],
};

const degreeProgram: DegreeProgram = {
  schemaVersion: "1",
  program: "6",
  title: "Example Program",
  level: "undergraduate",
  complete: false,
  requirements: [
    {
      groupId: "6-fundamentals",
      title: "Fundamentals",
      bucket: "departmental",
      subcategory: "fundamentals",
      root: {
        type: "selection",
        ruleType: "choose_n",
        ruleValue: 1,
        itemsSource: "explicit",
        items: [
          { type: "subject", subjectId: "6.100A" },
          { type: "subject", subjectId: "6.1010" },
        ],
      },
    },
    {
      groupId: "6-labs",
      title: "Laboratories",
      bucket: "departmental",
      subcategory: "lab",
      root: {
        type: "selection",
        ruleType: "choose_units",
        ruleValue: 12,
        itemsSource: "shared_list",
        sharedListId: "6.lab-restricted-electives",
      },
    },
    {
      groupId: "6-flex-approved",
      title: "Advisor Approved Focus",
      bucket: "elective",
      subcategory: "elective_focus",
      root: {
        type: "selection",
        ruleType: "choose_units_approved",
        ruleValue: 24,
        itemsSource: "advisor_defined",
        approvalRequired: true,
      },
    },
  ],
};

const sharedListResult = validateSharedList(sharedList);
const itemSetResult = validateItemSet(itemSet);
const zodProgramResult = validateDegreeProgram(degreeProgram, {
  engine: "zod",
  sharedLists: [sharedList],
});
const ajvProgramResult = validateDegreeProgram(degreeProgram, {
  engine: "ajv",
  sharedLists: [sharedList],
});

console.log("sharedList:", sharedListResult.ok ? "ok" : sharedListResult.errors);
console.log("itemSet:", itemSetResult.ok ? "ok" : itemSetResult.errors);
console.log("program(zod):", zodProgramResult.ok ? "ok" : zodProgramResult.errors);
console.log("program(ajv):", ajvProgramResult.ok ? "ok" : ajvProgramResult.errors);
