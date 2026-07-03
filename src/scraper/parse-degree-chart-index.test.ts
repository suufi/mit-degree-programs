import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferProgramId, parseDegreeChartIndexHtml } from "./parse-degree-chart-index";

const SAMPLE_HTML = `
<div id="undergraduatedegreestextcontainer">
  <h2>Undergraduate Degree Charts</h2>
  <h3 class="pspace">School of Architecture and Planning</h3>
  <p><a href="/degree-charts/architecture-course-4/">Architecture (Course&nbsp;4)</a></p>
  <p><a href="/degree-charts/computer-science-molecular-biology-course-6-7/">Computer Science and Molecular Biology (Course&nbsp;6-7)</a></p>
  <h3 class="pspace">MIT Schwarzman College of Computing</h3>
  <p><a href="/degree-charts/artifical-intelligence-decision-making-course-6-4/">Artificial Intelligence and Decision Making (6-4)</a></p>
</div>
<div id="graduatedegreestextcontainer">
  <h2>Graduate Degree Charts</h2>
  <h3 class="pspace">School of Architecture and Planning</h3>
  <p><a href="/degree-charts/master-architecture/">Architecture (MArch)</a></p>
  <p><a href="/degree-charts/master-architecture-studies/">Architecture Studies (SMArchS)</a></p>
</div>
</div> <!-- end #content -->
`;

describe("parseDegreeChartIndexHtml", () => {
  it("extracts undergrad and grad chart links with schools and program ids", () => {
    const index = parseDegreeChartIndexHtml(SAMPLE_HTML, {
      sourceUrl: "https://catalog.mit.edu/degree-charts/",
      scrapedAt: "2026-07-03",
      contentHash: "abc",
    });

    assert.equal(index.entries.length, 5);

    const course4 = index.entries.find((entry) => entry.slug === "architecture-course-4");
    assert.ok(course4);
    assert.equal(course4.programId, "4");
    assert.equal(course4.level, "undergraduate");
    assert.equal(course4.school, "School of Architecture and Planning");

    const sixSeven = index.entries.find(
      (entry) => entry.slug === "computer-science-molecular-biology-course-6-7",
    );
    assert.ok(sixSeven);
    assert.equal(sixSeven.programId, "6-7");

    const march = index.entries.find((entry) => entry.slug === "master-architecture");
    assert.ok(march);
    assert.equal(march.programId, "march");
    assert.equal(march.level, "graduate");

    const smArch = index.entries.find((entry) => entry.slug === "master-architecture-studies");
    assert.ok(smArch);
    assert.equal(smArch.programId, "sm-arch-studies");
  });
});

describe("inferProgramId", () => {
  it("reads course numbers from catalog titles", () => {
    assert.equal(inferProgramId("architecture-course-4", "Architecture (Course 4)"), "4");
    assert.equal(
      inferProgramId("computer-science-molecular-biology-course-6-7", "Foo (Course 6-7)"),
      "6-7",
    );
    assert.equal(
      inferProgramId("artifical-intelligence-decision-making-course-6-4", "AI (6-4)"),
      "6-4",
    );
    assert.equal(inferProgramId("anthropology-course-21a", "Anthropology (Course 21A)"), "21a");
  });
});
