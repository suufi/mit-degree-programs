import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { cleanEecsMarkdown } from "./clean-eecs-markdown";
import {
  catalogProgramIdFromEecs,
  eecsUrlForProgram,
  eecsUrlProgramId,
} from "./eecs-program-ids";
import { normalizeEecsToSchema } from "./normalize-eecs";
import { parseEecsRequirementsMarkdown } from "./parse-eecs-requirements";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures/6-3.markdown");

describe("eecs program ids", () => {
  it("maps catalog and EECS URL program ids", () => {
    assert.equal(eecsUrlProgramId("6-3"), "6-3");
    assert.equal(eecsUrlProgramId("6-3p"), "6-P3");
    assert.equal(catalogProgramIdFromEecs("6-P14"), "6-14p");
    assert.equal(
      eecsUrlForProgram("6-14p"),
      "https://eecsis.mit.edu/degree_requirements.pcgi?program=6-P14",
    );
  });

  it("parses entering-year program keys and URLs", async () => {
    const { parseEecsProgramQuery, eecsUrlForProgramKey } = await import(
      "./fetch-eecs-requirements.js"
    );
    const fromKey = parseEecsProgramQuery("6-7_2017");
    assert.deepEqual(fromKey, {
      catalogProgramId: "6-7-2017",
      catalogBaseId: "6-7",
      eecsProgramKey: "6-7_2017",
      enterYear: 2017,
    });
    assert.equal(
      eecsUrlForProgramKey("6-7_2017"),
      "https://eecsis.mit.edu/degree_requirements.pcgi?program=6-7_2017",
    );
    const fromUrl = parseEecsProgramQuery(
      "https://eecsis.mit.edu/degree_requirements.pcgi?program=6-7_2017",
    );
    assert.equal(fromUrl?.catalogProgramId, "6-7-2017");
    assert.equal(fromUrl?.catalogBaseId, "6-7");
    assert.equal(fromUrl?.enterYear, 2017);
    assert.equal(eecsUrlForProgram("6-7_2017"), eecsUrlForProgramKey("6-7_2017"));
    // Year-scoped storage id round-trips back to the same query.
    const fromStorage = parseEecsProgramQuery("6-7-2017");
    assert.deepEqual(fromStorage, fromKey);
    // Bare ids stay bare (current program), no year scoping.
    assert.equal(parseEecsProgramQuery("6-7")?.catalogProgramId, "6-7");
    assert.equal(parseEecsProgramQuery("6-P14_2022")?.catalogProgramId, "6-14p-2022");
  });
});

describe("cleanEecsMarkdown", () => {
  it("trims navigation and separator rows", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const cleaned = cleanEecsMarkdown(raw);
    assert.ok(!cleaned.includes("MIT EECS Logo"));
    assert.ok(cleaned.startsWith("###"));
    assert.ok(cleaned.includes("search.cgi?search=6.1000"));
  });
});

describe("parseEecsRequirementsMarkdown", () => {
  it("extracts entering year, tracks, and subject lists for 6-3", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const markdown = cleanEecsMarkdown(raw);
    const ast = parseEecsRequirementsMarkdown(markdown, "6-3");

    assert.equal(ast.programKey, "6-3_2025");
    assert.equal(ast.enterYear, 2025);
    assert.equal(ast.level, "undergraduate");
    assert.ok(ast.requiredRoot?.type === "group");
    assert.ok(ast.tracks.length >= 8, `expected tracks, got ${ast.tracks.length}`);
    assert.ok(ast.subjectLists.some((list) => list.slug === "aus2"));
    assert.equal(ast.electiveRules.length, 3);
  });

  it("parses 6-4 required subjects, electives, and area lists", async () => {
    const raw = await readFile(
      path.join(
        __dirname,
        "../../data/scrape-artifacts/eecs-6-4/2026-07-03-2025.markdown",
      ),
      "utf8",
    );
    const markdown = cleanEecsMarkdown(raw);
    const ast = parseEecsRequirementsMarkdown(markdown, "6-4");

    assert.equal(ast.programKey, "6-4_2025");
    assert.ok(ast.requiredRoot?.type === "group");
    const requiredItems =
      ast.requiredRoot?.type === "group" ? ast.requiredRoot.items : [];
    assert.ok(
      requiredItems.length <= 12,
      `expected compact required tree, got ${requiredItems.length} top-level items`,
    );
    assert.ok(
      ast.subjectLists.some((list) => list.slug === "center-subjects"),
      "expected center-subjects shared list",
    );
    assert.ok(
      ast.subjectLists.some((list) => list.slug === "model-centric"),
      "expected model-centric area list",
    );
    assert.equal(ast.electiveRules.length, 3);
    assert.ok(ast.additionalConstraints.length >= 5);
  });

  it("parses 6-5 with EE track electives", async () => {
    const raw = await readFile(
      path.join(
        __dirname,
        "../../data/scrape-artifacts/eecs-6-5/2026-07-03-2025.markdown",
      ),
      "utf8",
    );
    const ast = parseEecsRequirementsMarkdown(cleanEecsMarkdown(raw), "6-5");
    assert.equal(ast.programKey, "6-5_2025");
    const requiredItems =
      ast.requiredRoot?.type === "group" ? ast.requiredRoot.items.length : 0;
    assert.ok(requiredItems <= 6);
    assert.equal(ast.electiveRules.length, 3);
    assert.ok(ast.tracks.length >= 10);
    assert.ok(ast.electiveRules.some((rule) => rule.trackFilter === "ee"));
  });

  it("parses 6-7 with biology electives", async () => {
    const raw = await readFile(
      path.join(
        __dirname,
        "../../data/scrape-artifacts/eecs-6-7/2026-07-03-2024.markdown",
      ),
      "utf8",
    );
    const ast = parseEecsRequirementsMarkdown(cleanEecsMarkdown(raw), "6-7");
    assert.equal(ast.programKey, "6-7_2024");
    assert.equal(ast.electiveRules.length, 2);
    const compbio = ast.subjectLists.find((list) => list.slug === "compbio");
    const biore = ast.subjectLists.find((list) => list.slug === "biore");
    assert.ok(compbio, "expected compbio list");
    assert.ok(biore, "expected biore list");
    // 7.093 & 7.094 must be collapsed into a single all_of group in both lists.
    const compbioGroup = compbio.items.find(
      (item) => item.kind === "group" && item.subjectIds.includes("7.093") && item.subjectIds.includes("7.094"),
    );
    const bioreGroup = biore.items.find(
      (item) => item.kind === "group" && item.subjectIds.includes("7.093") && item.subjectIds.includes("7.094"),
    );
    assert.ok(compbioGroup, "expected 7.093 & 7.094 pair in COMPBIO");
    assert.ok(bioreGroup, "expected 7.093 & 7.094 pair in BIORE");
    // Prereq contamination should not leak into COMPBIO (18.03 etc. must be absent).
    assert.ok(
      !compbio.subjectIds.includes("18.03"),
      "18.03 should not appear in COMPBIO after prereq filtering",
    );
    assert.ok(
      !biore.subjectIds.includes("18.03"),
      "18.03 should not appear in BIORE after prereq filtering",
    );
    assert.ok(
      !biore.subjectIds.includes("6.100A"),
      "6.100A should not appear in BIORE after prereq filtering",
    );
  });

  it("parses 6-14 with economics electives", async () => {
    const raw = await readFile(
      path.join(
        __dirname,
        "../../data/scrape-artifacts/eecs-6-14/2026-07-03-2017.markdown",
      ),
      "utf8",
    );
    const ast = parseEecsRequirementsMarkdown(cleanEecsMarkdown(raw), "6-14");
    assert.equal(ast.programKey, "6-14_2017");
    assert.ok(ast.electiveRules.some((rule) => rule.groupTitle === "economics elective"));
    assert.ok(ast.subjectLists.some((list) => list.slug === "econds"));
  });

  it("parses inline SB header without markdown h3 (6-4 style)", () => {
    const markdown = `Degree Requirements for 6-4\\_2025    SB in Artificial Intelligence and Decision Making

_Required subjects:_`;
    const ast = parseEecsRequirementsMarkdown(markdown, "6-4");
    assert.equal(ast.programKey, "6-4_2025");
    assert.equal(ast.enterYear, 2025);
    assert.equal(ast.level, "undergraduate");
    assert.match(ast.pageTitle ?? "", /Artificial Intelligence/i);
  });
});

describe("normalizeEecsToSchema", () => {
  it("builds degree draft from EECS page without catalog", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const markdown = cleanEecsMarkdown(raw);
    const ast = parseEecsRequirementsMarkdown(markdown, "6-3");
    const { program, sharedLists } = normalizeEecsToSchema(ast, {
      programId: "6-3",
      scrapeMeta: {
        programId: "6-3",
        eecsProgramId: "6-3",
        url: "https://eecsis.mit.edu/degree_requirements.pcgi?program=6-3",
        markdownPath: fixturePath,
        contentHash: "test",
        scrapedAt: "2026-07-03",
        programKey: "6-3_2025",
        enterYear: 2025,
        level: "SB",
      },
    });

    assert.equal(program.eecsSource?.programKey, "6-3_2025");
    assert.equal(program.eecsSource?.enterYear, 2025);
    assert.ok(program.requirements.some((g) => g.title === "Required Subjects"));
    assert.ok(program.requirements.some((g) => g.title === "CS Track Electives"));
    assert.ok(sharedLists.some((l) => l.sharedListId.startsWith("course-6.track-")));
  });
});
