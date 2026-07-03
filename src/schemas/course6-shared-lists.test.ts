import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeCourse6SharedListId,
  resolveSharedListScope,
} from "../schemas/course6-shared-lists";
import { makeSharedListId, sharedListOwnerProgram } from "../schemas/shared-lists";

describe("course6 shared list scope", () => {
  it("uses course-6 scope for department tracks and ai-d-aus", () => {
    assert.equal(
      makeSharedListId("6-3", "track-theory"),
      "course-6.track-theory",
    );
    assert.equal(sharedListOwnerProgram("6-3", "track-theory"), "course-6");
    assert.equal(makeSharedListId("6-4", "ai-d-aus"), "course-6.ai-d-aus");
    assert.equal(makeSharedListId("6-7", "compbio"), "6-7.compbio");
  });

  it("canonicalizes legacy per-program ids", () => {
    assert.equal(
      canonicalizeCourse6SharedListId("6-3.track-theory"),
      "course-6.track-theory",
    );
    assert.equal(
      canonicalizeCourse6SharedListId("6-7.ai-d-aus"),
      "course-6.ai-d-aus",
    );
    assert.equal(
      canonicalizeCourse6SharedListId("6-7.biore"),
      "6-7.biore",
    );
  });

  it("resolveSharedListScope matches makeSharedListId", () => {
    const scope = resolveSharedListScope("6-14", "aus2");
    assert.equal(scope.sharedListId, "course-6.aus2");
    assert.equal(scope.ownerProgram, "course-6");
  });
});
