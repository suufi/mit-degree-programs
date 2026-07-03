#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  HTML_OUT,
  PROJECT_ROOT,
  REVIEW_PROGRAMS,
  REVIEW_ROOT,
  collectDegreeReviewRows,
  csvCell,
  parseSiteArgs,
  type DegreeReviewRow,
} from "./review-lib";

const MANIFEST_HEADERS = [
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
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function manifestRow(row: DegreeReviewRow): string[] {
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
  ];
}

function writeManifestCsv(rows: DegreeReviewRow[]) {
  const csv = [
    MANIFEST_HEADERS.map(csvCell).join(","),
    ...rows.map((row) => manifestRow(row).map(csvCell).join(",")),
  ].join("\n");
  writeFileSync(path.join(REVIEW_ROOT, "manifest.csv"), `${csv}\n`, "utf8");
}

function writeManifestJson(rows: DegreeReviewRow[]) {
  writeFileSync(
    path.join(REVIEW_ROOT, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: rows.length,
        programs: rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function copyProgramPages(rows: DegreeReviewRow[]) {
  rmSync(REVIEW_PROGRAMS, { recursive: true, force: true });
  mkdirSync(REVIEW_PROGRAMS, { recursive: true });

  for (const row of rows) {
    const from = path.join(HTML_OUT, `${row.program}.html`);
    const to = path.join(REVIEW_PROGRAMS, `${row.program}.html`);
    if (!existsSync(from)) continue;
    copyFileSync(from, to);
  }
}

function rowHtml(row: DegreeReviewRow): string {
  const localHref = row.reviewPath === "(not generated)"
    ? ""
    : `programs/${encodeURIComponent(row.program)}.html`;
  const localCell = localHref
    ? `<a href="${localHref}">Open HTML</a>`
    : `<span class="missing">Missing</span>`;
  const publishedCell = row.reviewUrl
    ? `<a href="${escapeHtml(row.reviewUrl)}">${escapeHtml(row.reviewUrl)}</a>`
    : "";
  const sourceCell = row.sourceUrl
    ? `<a href="${escapeHtml(row.sourceUrl)}">Source</a>`
    : "";

  return `<tr>
    <td>${escapeHtml(row.group)}</td>
    <td><code>${escapeHtml(row.program)}</code></td>
    <td>${escapeHtml(row.title)}</td>
    <td>${escapeHtml(row.level)}</td>
    <td>${escapeHtml(row.catalogYear)}</td>
    <td>${escapeHtml(row.complete)}</td>
    <td>${escapeHtml(row.sourceType)}</td>
    <td>${sourceCell}</td>
    <td>${localCell}</td>
    <td>${publishedCell}</td>
    <td><code>${escapeHtml(row.markdownPath)}</code></td>
  </tr>`;
}

function writeIndexHtml(rows: DegreeReviewRow[], siteBase: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Degree Review Site</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, sans-serif;
      line-height: 1.45;
      color: #1f2933;
      background: #f7fafc;
    }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, #d7f0ff 0, transparent 30%),
        linear-gradient(180deg, #f8fbff 0, #eef4f8 100%);
    }
    main {
      max-width: 1240px;
      margin: 0 auto;
      padding: 32px 20px 56px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 2rem;
    }
    .lede {
      max-width: 760px;
      margin: 0 0 20px;
      color: #52606d;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin: 20px 0 24px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.86);
      border: 1px solid #d9e2ec;
      border-radius: 14px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
      backdrop-filter: blur(8px);
    }
    input, select {
      font: inherit;
      padding: 10px 12px;
      border: 1px solid #bcccdc;
      border-radius: 10px;
      background: white;
      min-width: 220px;
    }
    .pill {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      background: #102a43;
      color: white;
      font-size: 0.9rem;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-left: auto;
    }
    .links a {
      color: #0b69a3;
      text-decoration: none;
      font-weight: 600;
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid #d9e2ec;
      border-radius: 16px;
      background: white;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1050px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e6edf3;
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #f8fafc;
      z-index: 1;
      font-size: 0.9rem;
    }
    tbody tr:nth-child(even) {
      background: #fbfdff;
    }
    code {
      font-size: 0.88em;
      background: #f2f5f7;
      padding: 2px 6px;
      border-radius: 6px;
    }
    a {
      color: #0b69a3;
    }
    .missing {
      color: #9b1c1c;
      font-weight: 600;
    }
    .meta {
      margin-top: 16px;
      color: #52606d;
      font-size: 0.92rem;
    }
  </style>
</head>
<body>
  <main>
    <h1>Degree Review Site</h1>
    <p class="lede">
      This bundle is spreadsheet-friendly and GitHub Pages-friendly. Every draft program has a standalone HTML page, plus a CSV/JSON manifest for external review tracking.
    </p>
    <div class="toolbar">
      <span class="pill">${rows.length} programs</span>
      <input id="search" type="search" placeholder="Filter by program, title, group, or source type" />
      <select id="level">
        <option value="">All levels</option>
        <option value="undergraduate">Undergraduate</option>
        <option value="graduate">Graduate</option>
      </select>
      <select id="group">
        <option value="">All groups</option>
        ${Array.from(new Set(rows.map((row) => row.group)))
          .map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
          .join("")}
      </select>
      <div class="links">
        <a href="manifest.csv">Download CSV</a>
        <a href="manifest.json">Download JSON</a>
      </div>
    </div>
    <div class="table-wrap">
      <table id="review-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Program</th>
            <th>Title</th>
            <th>Level</th>
            <th>Year</th>
            <th>Complete?</th>
            <th>Source Type</th>
            <th>Source</th>
            <th>Local HTML</th>
            <th>Published URL</th>
            <th>Markdown</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => rowHtml(row)).join("\n")}
        </tbody>
      </table>
    </div>
    <p class="meta">
      Generated from draft degree data. ${siteBase ? `Published URL base: <code>${escapeHtml(siteBase)}</code>.` : "No published URL base configured yet."}
    </p>
  </main>
  <script>
    const search = document.getElementById("search");
    const level = document.getElementById("level");
    const group = document.getElementById("group");
    const rows = Array.from(document.querySelectorAll("#review-table tbody tr"));

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      const levelValue = level.value;
      const groupValue = group.value;

      for (const row of rows) {
        const text = row.textContent.toLowerCase();
        const rowLevel = row.children[3].textContent.trim();
        const rowGroup = row.children[0].textContent.trim();
        const matchesQuery = !query || text.includes(query);
        const matchesLevel = !levelValue || rowLevel === levelValue;
        const matchesGroup = !groupValue || rowGroup === groupValue;
        row.hidden = !(matchesQuery && matchesLevel && matchesGroup);
      }
    }

    search.addEventListener("input", applyFilters);
    level.addEventListener("change", applyFilters);
    group.addEventListener("change", applyFilters);
  </script>
</body>
</html>`;

  writeFileSync(path.join(REVIEW_ROOT, "index.html"), `${html}\n`, "utf8");
}

function main() {
  const { siteBase } = parseSiteArgs(process.argv.slice(2));
  const rows = collectDegreeReviewRows(siteBase);

  mkdirSync(REVIEW_ROOT, { recursive: true });
  copyProgramPages(rows);
  writeManifestCsv(rows);
  writeManifestJson(rows);
  writeIndexHtml(rows, siteBase);
  writeFileSync(path.join(REVIEW_ROOT, ".nojekyll"), "\n", "utf8");

  console.log(
    `Built review site for ${rows.length} programs at ${path.relative(PROJECT_ROOT, REVIEW_ROOT)}`,
  );
}

main();
