/** Undergrad programs with detailed requirements on eecsis.mit.edu. */
export const EECS_UNDERGRAD_PROGRAMS = ["6-3", "6-4", "6-5", "6-7", "6-14"] as const;

/** MEng programs on eecsis.mit.edu (URL uses 6-P* form). */
export const EECS_MENG_PROGRAMS = ["6-P3", "6-P4", "6-P5", "6-P7", "6-P14"] as const;

export type EecsUrlProgramId =
  | (typeof EECS_UNDERGRAD_PROGRAMS)[number]
  | (typeof EECS_MENG_PROGRAMS)[number];

export type EecsProgramQuery = {
  /**
   * Storage/draft program id. Year-scoped for historical builds (e.g.
   * `6-7-2017`) so they never collide with the current program's `6-7.json`.
   * Bare (`6-7`, `6-3p`) when no entering year is requested.
   */
  catalogProgramId: string;
  /**
   * Base catalog id with the entering year stripped (e.g. `6-7`, `6-3p`).
   * Keys the shared scrape-artifact directory (`eecs-6-7`) so historical and
   * current years share one artifact folder.
   */
  catalogBaseId: string;
  /** EECS `program=` query value (e.g. 6-7_2017, 6-P7). */
  eecsProgramKey: string;
  enterYear?: number;
};

/** Extract the EECS `program` query param from a URL or return the raw key. */
export function eecsProgramKeyFromInput(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/[?&]program=([^&#]+)/i)?.[1];
  return decodeURIComponent(fromUrl ?? trimmed).replace(/\\/g, "");
}

/**
 * Parse 6-7, 6-7_2017, 6-7-2017, 6-P7, 6-3p, 6-P14_2022, a year-scoped storage
 * id, or a full eecsis degree_requirements URL.
 *
 * The entering year may be suffixed with `_YYYY` (EECS URL form) or `-YYYY`
 * (our storage form); both round-trip. When a year is present the storage
 * `catalogProgramId` is year-scoped (`6-7-2017`) while `catalogBaseId` stays
 * bare (`6-7`) for artifact lookup and `eecsProgramKey` uses the `_YYYY` form
 * the EECS site expects.
 */
export function parseEecsProgramQuery(input: string): EecsProgramQuery | undefined {
  const raw = eecsProgramKeyFromInput(input);
  const yearMatch = raw.match(/^(.+?)[_-](\d{4})$/);
  const enterYear = yearMatch
    ? Number.parseInt(yearMatch[2] ?? "", 10)
    : undefined;
  const baseKey = yearMatch ? yearMatch[1]! : raw;

  let catalogBaseId: string;
  let eecsBaseKey: string;

  const mengUpper = baseKey.match(/^6-P(\d+)$/i);
  const mengLower = baseKey.match(/^6-(\d+)p$/i);
  if (mengUpper) {
    catalogBaseId = `6-${mengUpper[1]}p`;
    eecsBaseKey = `6-P${mengUpper[1]}`;
  } else if (mengLower) {
    catalogBaseId = `6-${mengLower[1]}p`;
    eecsBaseKey = `6-P${mengLower[1]}`;
  } else if ((EECS_UNDERGRAD_PROGRAMS as readonly string[]).includes(baseKey)) {
    catalogBaseId = baseKey;
    eecsBaseKey = baseKey;
  } else {
    return undefined;
  }

  const catalogProgramId =
    enterYear != null ? `${catalogBaseId}-${enterYear}` : catalogBaseId;
  const eecsProgramKey =
    enterYear != null ? `${eecsBaseKey}_${enterYear}` : eecsBaseKey;

  return { catalogProgramId, catalogBaseId, eecsProgramKey, enterYear };
}

export function eecsUrlForProgramKey(eecsProgramKey: string): string {
  return `https://eecsis.mit.edu/degree_requirements.pcgi?program=${encodeURIComponent(eecsProgramKey)}`;
}

/** Catalog draft id for an EECS URL program (e.g. 6-P3 → 6-3p). */
export function catalogProgramIdFromEecs(eecsProgramId: string): string {
  const parsed = parseEecsProgramQuery(eecsProgramId);
  if (parsed) return parsed.catalogProgramId;

  const meng = eecsProgramId.match(/^6-P(\d+)$/i);
  if (meng) return `6-${meng[1]}p`;
  return eecsProgramId;
}

/** EECS URL query param for a catalog program id (e.g. 6-3p → 6-P3). */
export function eecsUrlProgramId(catalogProgramId: string): EecsUrlProgramId | undefined {
  const meng = catalogProgramId.match(/^6-(\d+)p$/i);
  if (meng) return `6-P${meng[1]}` as EecsUrlProgramId;
  if ((EECS_UNDERGRAD_PROGRAMS as readonly string[]).includes(catalogProgramId)) {
    return catalogProgramId as EecsUrlProgramId;
  }
  const direct = catalogProgramId.toUpperCase();
  if ((EECS_MENG_PROGRAMS as readonly string[]).includes(direct)) {
    return direct as EecsUrlProgramId;
  }
  return undefined;
}

export function isEecsSourcedProgram(programId: string): boolean {
  return Boolean(parseEecsProgramQuery(programId) ?? eecsUrlProgramId(programId));
}

export function eecsUrlForProgram(programId: string): string | undefined {
  const parsed = parseEecsProgramQuery(programId);
  if (parsed) return eecsUrlForProgramKey(parsed.eecsProgramKey);
  const eecsId = eecsUrlProgramId(programId);
  if (!eecsId) return undefined;
  return eecsUrlForProgramKey(eecsId);
}

/** @deprecated use isEecsSourcedProgram */
export function isEecsEnrichableProgram(programId: string): boolean {
  return isEecsSourcedProgram(programId);
}
