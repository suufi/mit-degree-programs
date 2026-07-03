import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanEecsMarkdown } from "../src/scraper/eecs/clean-eecs-markdown";
import { parseEecsRequirementsMarkdown } from "../src/scraper/eecs/parse-eecs-requirements";

const projectRoot = path.resolve(".");

const seeds = [
  {
    upload:
      "/Users/suufi/.cursor/projects/Users-suufi-LocalProjects-mit-opengrades-mobile/uploads/degree_requirements.pcgi-0.md",
    program: "6-5",
    eecs: "6-5",
  },
  {
    upload:
      "/Users/suufi/.cursor/projects/Users-suufi-LocalProjects-mit-opengrades-mobile/uploads/degree_requirements.pcgi-1.md",
    program: "6-7",
    eecs: "6-7",
  },
  {
    upload:
      "/Users/suufi/.cursor/projects/Users-suufi-LocalProjects-mit-opengrades-mobile/uploads/degree_requirements.pcgi-2.md",
    program: "6-14",
    eecs: "6-14",
  },
];

for (const { upload, program, eecs } of seeds) {
  const raw = readFileSync(upload, "utf8");
  const cleaned = cleanEecsMarkdown(raw);
  const ast = parseEecsRequirementsMarkdown(cleaned, program);
  const enterYear = ast.enterYear ?? 2025;
  const dir = path.join(projectRoot, "src/data/scrape-artifacts", `eecs-${program}`);
  mkdirSync(dir, { recursive: true });
  const base = `2026-07-03-${enterYear}`;
  const markdownPath = path.join(dir, `${base}.markdown`);
  const metaPath = path.join(dir, `${base}.meta.json`);
  writeFileSync(markdownPath, cleaned);
  const meta = {
    programId: program,
    eecsProgramId: eecs,
    url: `https://eecsis.mit.edu/degree_requirements.pcgi?program=${eecs}`,
    contentHash: createHash("sha256").update(cleaned).digest("hex"),
    scrapedAt: "2026-07-03",
    programKey: ast.programKey,
    enterYear,
    level: ast.level === "graduate" ? "MNG" : "SB",
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  const requiredItems =
    ast.requiredRoot?.type === "group" ? ast.requiredRoot.items.length : 0;
  console.log(program, {
    requiredItems,
    tracks: ast.tracks.length,
    lists: ast.subjectLists.length,
    electives: ast.electiveRules.length,
    constraints: ast.additionalConstraints.length,
    notes: ast.notes.length,
  });
}
