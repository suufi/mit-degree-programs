# Degrees and Departments Workspace

Ground truth for MIT degree requirements. Validated with `npm run validate:degrees`.

## Layout

- `degrees/` — current degree program JSON (`course-<n>/<program>.json`)
- `drafts/` — scraper output pending review (`drafts/degrees/`, `drafts/shared-lists/`)
- `versions/<program>/` — immutable revision snapshots (`<revisionId>.json`)
- `manifest.json` — maps each program to its `currentRevision`
- `shared-lists/` — reusable subject pools referenced by programs
- `../institute/gir-sb.json` — shared SB GIR template (referenced via `includesGir: "sb"`)
- `../institute/tag-pools.json` — canonical `tagPool` → MITOpenGrades Class field mapping

## Scraper workflow

```bash
npm run scrape -- --program 6-7
npm run build:degrees -- --program 6-7          # writes drafts/ only
npm run diff:degree -- --program 6-7            # compare draft vs current
npm run build:degrees -- --program 6-7 --promote   # promote draft to current (+ archive if destructive)
npm run validate:degrees
```

Use `--force` with `--promote` after reviewing destructive diffs.

Scrape artifacts: `src/data/scrape-artifacts/<program>/`

## Versioning

Each promoted revision gets a stable `revisionId` (`<program>-<date>-<hash>`). Prior `current` snapshots are archived under `versions/` and linked via `supersedes` / `supersededBy` in the JSON and `manifest.json`.

## Visualization

```bash
npm run visualize -- --program 6-7     # → tools/visualize/out/6-7.html
npm run visualize:md -- --program 6-7  # → docs/degrees/6-7.md
```

Open `tools/visualize/index.html` for usage notes, or open the generated HTML file directly.

## Tag pools

Canonical OpenGrades mapping lives in `src/schemas/tag-mapping.ts` and `src/data/institute/tag-pools.json` (fields: `communicationRequirement`, `hassAttribute`, `girAttribute` from MITOpenGrades `Class.ts`).

Suggested naming:

- Degrees: `<program>.json` (example: `6-7.json`)
- Shared lists: `<program>.<slug>.json` (example: `6-7.biore.json`)
- Revisions: `versions/<program>/<revisionId>.json`
