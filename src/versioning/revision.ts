import { createHash } from "node:crypto";
import type { CatalogSource, DegreeManifest, DegreeProgram } from "../schemas/types";

export function computeRevisionId(
  program: string,
  catalogSource?: CatalogSource,
  content?: unknown,
): string {
  const date = catalogSource?.scrapedAt ?? new Date().toISOString().slice(0, 10);
  let hashPrefix: string;
  if (catalogSource?.contentHash) {
    hashPrefix = catalogSource.contentHash.slice(0, 8);
  } else if (content !== undefined) {
    hashPrefix = createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex")
      .slice(0, 8);
  } else {
    hashPrefix = createHash("sha256").update(date).digest("hex").slice(0, 8);
  }
  return `${program}-${date}-${hashPrefix}`;
}

export function inferCatalogYear(scrapedAt?: string): string | undefined {
  if (!scrapedAt) return undefined;
  const year = scrapedAt.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : undefined;
}

export function inferEffectiveTerm(scrapedAt?: string): string | undefined {
  const year = inferCatalogYear(scrapedAt);
  if (!year) return undefined;
  const month = Number(scrapedAt?.slice(5, 7) ?? 0);
  const term = month >= 1 && month <= 5 ? "SP" : "FA";
  return `${year}-${term}`;
}

export function stampRevisionMetadata(
  program: DegreeProgram,
  options?: { status?: DegreeProgram["status"]; supersedes?: string },
): DegreeProgram {
  const revisionId = computeRevisionId(program.program, program.catalogSource, program);
  return {
    ...program,
    revisionId,
    catalogYear: program.catalogYear ?? inferCatalogYear(program.catalogSource?.scrapedAt),
    effectiveTerm:
      program.effectiveTerm ?? inferEffectiveTerm(program.catalogSource?.scrapedAt),
    status: options?.status ?? program.status ?? "draft",
    supersedes: options?.supersedes ?? program.supersedes,
  };
}

export function archiveRevision(program: DegreeProgram, supersededBy: string): DegreeProgram {
  return {
    ...program,
    status: "archived",
    supersededBy,
  };
}

export function emptyManifest(): DegreeManifest {
  return { schemaVersion: "1", programs: {} };
}
