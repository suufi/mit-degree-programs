import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "src/data/scrape-artifacts");

export async function findLatestArtifact(program: string): Promise<string | null> {
  const dir = path.join(ARTIFACTS_DIR, program);
  try {
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".markdown"))
      .sort()
      .reverse();
    return files[0] ? path.join(dir, files[0]) : null;
  } catch {
    return null;
  }
}
