#!/usr/bin/env node
/**
 * Builds a spreadsheet-friendly review table for every draft degree program.
 *
 * Outputs:
 *   - docs/degree-review.csv
 *   - a tab-separated table on stdout
 *
 * Usage:
 *   npm run review:table
 *   npm run review:table -- --site-base https://owner.github.io/repo
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  PROJECT_ROOT,
  collectDegreeReviewRows,
  csvCell,
  parseSiteArgs,
  type DegreeReviewRow,
} from "./review-lib.js";

const HEADERS = [
  "Group",
  "Program Code",
  "Title",
  "Level",
  "Catalog Year",
  "Data Complete?",
  "Source Type",
  "Source URL (website)",
  "HTML Review File",
  "Published Review URL",
  "Markdown File",
  "Reviewer",
  "Matches Website? (Y/N)",
  "Discrepancies / Notes",
];

function rowValues(row: DegreeReviewRow): string[] {
  return [
    row.group,
    row.program,
    row.title,
    row.level,
    row.catalogYear,
    row.complete,
    row.sourceType,
    row.sourceUrl,
    row.reviewPath,
    row.reviewUrl,
    row.markdownPath,
    "",
    "",
    "",
  ];
}

function main() {
  const { siteBase } = parseSiteArgs(process.argv.slice(2));
  const rows = collectDegreeReviewRows(siteBase);

  const csv = [
    HEADERS.map(csvCell).join(","),
    ...rows.map((row) => rowValues(row).map(csvCell).join(",")),
  ].join("\n");
  const csvOut = path.join(PROJECT_ROOT, "docs/degree-review.csv");
  writeFileSync(csvOut, `${csv}\n`, "utf8");

  const tsv = [
    HEADERS.join("\t"),
    ...rows.map((row) => rowValues(row).join("\t")),
  ].join("\n");

  console.log(tsv);
  console.error(`\nWrote ${rows.length} programs to ${path.relative(PROJECT_ROOT, csvOut)}`);
}

main();
