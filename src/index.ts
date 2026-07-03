import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DegreeProgram, GirTemplate, SharedListDocument } from "./schemas/types.js";
import {
  validateDegreeProgram,
  validateGirTemplate,
  validateSharedList,
} from "./validators/index.js";
import { courseDirForProgram } from "./versioning/paths.js";
import {
  COURSE_6_SHARED_SCOPE,
  isCourse6Program,
} from "./schemas/course6-shared-lists.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(__dirname, "data");

export type DataKind = "draft" | "current";

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function loadGir(id = "gir-sb"): Promise<GirTemplate> {
  const filePath = path.join(DATA_ROOT, "institute", `${id}.json`);
  const data = await readJson<unknown>(filePath);
  const result = validateGirTemplate(data);
  if (!result.ok) {
    throw new Error(`Invalid GIR template ${id}: ${result.errors.map((e) => e.message).join("; ")}`);
  }
  return result.data;
}

function sharedListsRoot(kind: DataKind): string {
  return kind === "draft"
    ? path.join(DATA_ROOT, "degrees-departments/drafts/shared-lists")
    : path.join(DATA_ROOT, "degrees-departments/shared-lists");
}

function degreesRoot(kind: DataKind): string {
  return kind === "draft"
    ? path.join(DATA_ROOT, "degrees-departments/drafts/degrees")
    : path.join(DATA_ROOT, "degrees-departments/degrees");
}

function isSharedListForProgram(fileName: string, program: string): boolean {
  if (!fileName.endsWith(".json")) return false;
  if (fileName.startsWith(`${program}.`)) return true;
  // Course 6 programs also reference department-wide lists (course-6.*).
  return (
    isCourse6Program(program) && fileName.startsWith(`${COURSE_6_SHARED_SCOPE}.`)
  );
}

export async function loadSharedLists(
  program: string,
  opts?: { kind?: DataKind },
): Promise<SharedListDocument[]> {
  const { readdir } = await import("node:fs/promises");
  const sharedDir = sharedListsRoot(opts?.kind ?? "current");
  const lists: SharedListDocument[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (isSharedListForProgram(entry.name, program)) {
        const data = await readJson<unknown>(full);
        const result = validateSharedList(data);
        if (!result.ok) {
          throw new Error(
            `Invalid shared list ${entry.name}: ${result.errors.map((e) => e.message).join("; ")}`,
          );
        }
        lists.push(result.data);
      }
    }
  }

  await walk(sharedDir);
  return lists;
}

export async function loadProgram(
  program: string,
  opts?: { kind?: DataKind },
): Promise<DegreeProgram> {
  const courseDir = courseDirForProgram(program);
  // When a kind isn't specified, prefer promoted data but fall back to drafts.
  const kinds: DataKind[] = opts?.kind ? [opts.kind] : ["current", "draft"];

  let data: unknown;
  let usedKind: DataKind | undefined;
  for (const kind of kinds) {
    const filePath = path.join(degreesRoot(kind), courseDir, `${program}.json`);
    try {
      data = await readJson<unknown>(filePath);
      usedKind = kind;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (data === undefined || !usedKind) {
    throw new Error(`Degree program not found: ${program}`);
  }

  const sharedLists = await loadSharedLists(program, { kind: usedKind });
  const result = validateDegreeProgram(data, { sharedLists });
  if (!result.ok) {
    throw new Error(
      `Invalid degree program ${program}: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return result.data;
}

export { validateDegreeProgram, validateGirTemplate, validateSharedList };

export {
  evaluateCommunicationRequirement,
  communicationPaceDeadline,
  checkRequirementConstraints,
  countChooseNWithMaxPerTerm,
  checkPaceByYear,
  checkFirstMustMatch,
  checkMaxPerTerm,
  latestAllowedYearForNextCi,
  academicYearForTerm,
  describeConstraint,
} from "./evaluate/index.js";

export type {
  DegreeProgram,
  GirTemplate,
  SharedListDocument,
  RequirementNode,
  RequirementGroup,
  RequirementConstraint,
} from "./schemas/types.js";

export type {
  ScheduledSubject,
  StudentProfile,
  ConstraintCheckResult,
  ChooseNCountResult,
  CommunicationEvaluation,
} from "./evaluate/index.js";
