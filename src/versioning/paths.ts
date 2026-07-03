import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../..");
export const DATA_ROOT = path.join(PROJECT_ROOT, "src/data/degrees-departments");

/** Cluster numeric MIT course programs (e.g. 6-7 and 4-b → course-6 / course-4). */
export function courseDirForProgram(program: string): string {
  const match = program.match(/^(\d+)/);
  return match ? `course-${match[1]}` : program;
}

export function degreePath(program: string, kind: "current" | "draft" = "current"): string {
  const courseDir = courseDirForProgram(program);
  const base = kind === "draft" ? path.join(DATA_ROOT, "drafts/degrees") : path.join(DATA_ROOT, "degrees");
  return path.join(base, courseDir, `${program}.json`);
}

export function versionPath(program: string, revisionId: string): string {
  return path.join(DATA_ROOT, "versions", program, `${revisionId}.json`);
}

export function manifestPath(): string {
  return path.join(DATA_ROOT, "manifest.json");
}

export function sharedListsDir(program: string, kind: "current" | "draft" = "current"): string {
  const courseDir = courseDirForProgram(program);
  const base =
    kind === "draft"
      ? path.join(DATA_ROOT, "drafts/shared-lists")
      : path.join(DATA_ROOT, "shared-lists");
  return path.join(base, courseDir);
}

export function sharedListPath(
  program: string,
  sharedListId: string,
  kind: "current" | "draft" = "current",
): string {
  return path.join(sharedListsDir(program, kind), `${sharedListId}.json`);
}

export function visualizeOutPath(program: string): string {
  return path.join(PROJECT_ROOT, "tools/visualize/out", `${program}.html`);
}

export function visualizeMdPath(program: string): string {
  return path.join(PROJECT_ROOT, "docs/degrees", `${program}.md`);
}
