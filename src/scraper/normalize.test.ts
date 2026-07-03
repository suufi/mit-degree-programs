import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseDegreeChartMarkdown } from "./parse-degree-chart";
import { normalizeToSchema } from "./normalize-to-schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

async function loadArtifact(slug: string): Promise<string> {
  return readFile(
    path.join(PROJECT_ROOT, "src/data/scrape-artifacts", slug, "2026-07-03.markdown"),
    "utf8",
  );
}

describe("parseDegreeChartMarkdown", () => {
  it("parses 6-7 undergrad pools and choose-one rows", async () => {
    const markdown = await loadArtifact("computer-science-molecular-biology-course-6-7");
    const ast = parseDegreeChartMarkdown(markdown);

    assert.equal(ast.level, "undergraduate");
    assert.ok(ast.pools.some((pool) => pool.slug === "biore"));
    assert.ok(ast.pools.some((pool) => pool.slug === "ai-d-aus"));
    assert.ok(ast.pools.some((pool) => pool.slug === "compbio"));
    assert.ok(ast.departmentalRows.some((row) => row.kind === "pool_union"));
    assert.ok(ast.departmentalRows.some((row) => row.kind === "choose_one"));
  });

  it("parses architecture course 4 restricted elective pools", async () => {
    const markdown = await loadArtifact("architecture-course-4");
    const ast = parseDegreeChartMarkdown(markdown);

    assert.equal(ast.level, "undergraduate");
    assert.ok(ast.pools.length >= 3);
    assert.ok(ast.pools.some((pool) => /computation/i.test(pool.title)));
    assert.ok(ast.departmentalRows.some((row) => row.kind === "choose_units"));
  });
});

describe("normalizeToSchema", () => {
  it("uses shared_list_union without openEnded for defined 6-7 pools", async () => {
    const markdown = await loadArtifact("computer-science-molecular-biology-course-6-7");
    const ast = parseDegreeChartMarkdown(markdown);
    const { program, sharedLists } = normalizeToSchema(ast, undefined, {
      programId: "6-7",
      slug: "computer-science-molecular-biology-course-6-7",
      url: "https://catalog.mit.edu/degree-charts/computer-science-molecular-biology-course-6-7/",
      title: "Computer Science and Molecular Biology (Course 6-7)",
      level: "undergraduate",
      school: "Interdisciplinary Programs",
      schools: ["Interdisciplinary Programs"],
    });

    assert.equal(program.program, "6-7");
    assert.equal(sharedLists.length, 3);
    const restricted = program.requirements.find((group) =>
      /restricted elective/i.test(group.title),
    );
    assert.ok(restricted);
    assert.equal(restricted.flexibility?.openEnded, undefined);
    assert.equal(restricted.root.type, "selection");
    if (restricted.root.type === "selection") {
      assert.equal(restricted.root.itemsSource, "shared_list_union");
      const ids = restricted.root.sharedListIds?.sort();
      assert.deepEqual(ids, ["6-7.biore", "6-7.compbio", "course-6.ai-d-aus"]);
    }
  });

  it("maps architecture restricted electives to enumerated shared lists", async () => {
    const markdown = await loadArtifact("architecture-course-4");
    const ast = parseDegreeChartMarkdown(markdown);
    const { program, sharedLists } = normalizeToSchema(ast, undefined, {
      programId: "4",
      slug: "architecture-course-4",
      url: "https://catalog.mit.edu/degree-charts/architecture-course-4/",
      title: "Architecture (Course 4)",
      level: "undergraduate",
      school: "School of Architecture and Planning",
      schools: ["School of Architecture and Planning"],
    });

    assert.ok(sharedLists.length >= 3);
    const restricted = program.requirements.find((group) =>
      /restricted elective/i.test(group.title),
    );
    assert.ok(restricted);
    assert.equal(restricted.flexibility?.openEnded, undefined);
    if (restricted.root.type === "selection") {
      assert.ok(
        restricted.root.itemsSource === "shared_list_union" ||
          restricted.root.itemsSource === "shared_list",
      );
    }
  });
});
