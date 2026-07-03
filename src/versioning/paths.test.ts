import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { courseDirForProgram } from "./paths";

describe("courseDirForProgram", () => {
  it("clusters course 6 variants under course-6", () => {
    assert.equal(courseDirForProgram("6-7"), "course-6");
    assert.equal(courseDirForProgram("6-4"), "course-6");
    assert.equal(courseDirForProgram("6-p"), "course-6");
  });

  it("clusters other numeric course programs under course-N", () => {
    assert.equal(courseDirForProgram("4"), "course-4");
    assert.equal(courseDirForProgram("4-b"), "course-4");
    assert.equal(courseDirForProgram("2-a"), "course-2");
    assert.equal(courseDirForProgram("10-c"), "course-10");
    assert.equal(courseDirForProgram("1-12"), "course-1");
  });

  it("keeps non-numeric program ids as their own folder", () => {
    assert.equal(courseDirForProgram("march"), "march");
    assert.equal(courseDirForProgram("phd-transportation"), "phd-transportation");
  });
});
