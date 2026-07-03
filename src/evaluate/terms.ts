const TERM_SEASON_ORDER: Record<string, number> = {
  FA: 0,
  IAP: 1,
  SP: 2,
};

export function parseTerm(term: string): { year: number; season: string } {
  const [yearPart, season] = term.split("-");
  const year = Number(yearPart);
  if (!yearPart || Number.isNaN(year) || !(season in TERM_SEASON_ORDER)) {
    throw new Error(`Invalid MIT term code: ${term}`);
  }
  return { year, season };
}

/** Monotonic index for comparing terms in academic-year order. */
export function academicTermIndex(term: string): number {
  const { season } = parseTerm(term);
  return academicYearStartYear(term) * 3 + TERM_SEASON_ORDER[season];
}

/** @deprecated Prefer academicTermIndex for schedule ordering. */
export function termIndex(term: string): number {
  const { year, season } = parseTerm(term);
  return year * 3 + TERM_SEASON_ORDER[season];
}

export function compareTerms(a: string, b: string): number {
  return academicTermIndex(a) - academicTermIndex(b);
}

/** Calendar year of the fall term that starts this subject's academic year. */
export function academicYearStartYear(term: string): number {
  const { year, season } = parseTerm(term);
  if (season === "FA") {
    return year;
  }
  return year - 1;
}

/**
 * Academic year relative to entry (1 = first year through FA/IAP/SP of entry cycle).
 * Entry term is typically the student's first FA (e.g. `2024-FA`).
 */
export function academicYearForTerm(term: string, entryTerm: string): number {
  const start = academicYearStartYear(term);
  const entryStart = academicYearStartYear(entryTerm);
  if (start < entryStart) {
    return 0;
  }
  return start - entryStart + 1;
}

export function sortByTerm<T extends { term: string }>(subjects: T[]): T[] {
  return [...subjects].sort((a, b) => compareTerms(a.term, b.term));
}
