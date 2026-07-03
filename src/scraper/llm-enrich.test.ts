import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsLlmEnrichment } from "./llm-enrich";
import type { DegreeChartAst } from "./parse-degree-chart";
import type { DegreeProgram } from "../schemas/types";

const baseProgram: DegreeProgram = {
  schemaVersion: "2",
  program: "6-7",
  title: "Test",
  level: "undergraduate",
  complete: false,
  footnotes: [{ id: "3", text: "but not both pools" }],
  requirements: [],
};

describe("needsLlmEnrichment", () => {
  it("flags ambiguous prose and footnotes without appliesTo", () => {
    const ast: DegreeChartAst = {
      level: "undergraduate",
      title: "Test",
      girCrosswalk: [],
      departmentalRows: [
        { kind: "prose", text: "In consultation with advisor, select 60 units" },
      ],
      pools: [],
      footnotes: [],
    };
    assert.equal(needsLlmEnrichment(ast, baseProgram), true);
  });

  it("returns false when rules already resolved everything", () => {
    const ast: DegreeChartAst = {
      level: "undergraduate",
      title: "Test",
      girCrosswalk: [],
      departmentalRows: [{ kind: "subjects", subjectIds: ["6.1000"] }],
      pools: [],
      footnotes: [],
    };
    const program = {
      ...baseProgram,
      footnotes: [{ id: "1", text: "note", appliesTo: ["6-7.biore"] }],
    };
    assert.equal(needsLlmEnrichment(ast, program), false);
  });
});
