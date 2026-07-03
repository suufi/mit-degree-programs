import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJsonFromText } from "./gemini";

describe("extractJsonFromText", () => {
  it("parses plain JSON objects", () => {
    assert.deepEqual(extractJsonFromText('{"footnotes":[]}'), { footnotes: [] });
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"reviewNotes":["note"]}\n```';
    assert.deepEqual(extractJsonFromText(raw), { reviewNotes: ["note"] });
  });

  it("ignores trailing prose after a JSON object", () => {
    const json = JSON.stringify({ footnotes: [{ id: "1" }], constraints: [] });
    const raw = `${json}\n\nHere is a summary of the changes.`;
    assert.deepEqual(extractJsonFromText(raw), { footnotes: [{ id: "1" }], constraints: [] });
  });

  it("parses only the first top-level JSON value", () => {
    const first = { footnotes: [] };
    const second = { reviewNotes: ["extra"] };
    const raw = `${JSON.stringify(first)}\n${JSON.stringify(second)}`;
    assert.deepEqual(extractJsonFromText(raw), first);
  });
});
