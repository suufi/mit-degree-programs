export type DegreeLevel = "undergraduate" | "graduate";

export type DegreeChartIndexEntry = {
  slug: string;
  url: string;
  title: string;
  level: DegreeLevel;
  school: string;
  schools: string[];
  programId: string;
};

export type DegreeChartIndex = {
  schemaVersion: "1";
  sourceUrl: string;
  scrapedAt: string;
  contentHash: string;
  entries: DegreeChartIndexEntry[];
};

const CATALOG_BASE = "https://catalog.mit.edu";
export const DEGREE_CHART_INDEX_URL = `${CATALOG_BASE}/degree-charts/`;

const UNDERGRAD_CONTAINER_RE =
  /<div id="undergraduatedegreestextcontainer"[\s\S]*?<\/div>\s*<div id="graduatedegreestextcontainer"/;
const GRAD_CONTAINER_RE =
  /<div id="graduatedegreestextcontainer"[\s\S]*?<\/div>\s*<\/div> <!-- end #content -->/;
const CHART_LINK_RE =
  /<a\s+href="(\/degree-charts\/[^"#?]+?)\/?">([^<]+)<\/a>/gi;

function decodeHtmlText(text: string): string {
  return text
    .replace(/&#8203;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugFromHref(href: string): string {
  return href.replace(/^\/degree-charts\//, "").replace(/\/$/, "");
}

function toAbsoluteUrl(href: string): string {
  const path = href.startsWith("/") ? href : `/${href}`;
  const normalized = path.endsWith("/") ? path : `${path}/`;
  return `${CATALOG_BASE}${normalized}`;
}

/** Infer internal program id from catalog title text, falling back to slug. */
export function inferProgramId(slug: string, title: string): string {
  const courseMatch =
    title.match(/Course\s*([0-9]+(?:-[A-Za-z0-9]+)?[A-Za-z]?)/i) ??
    title.match(/\(([0-9]+-[0-9]+[A-Za-z]?)\)/);
  if (courseMatch) {
    return courseMatch[1]!.toLowerCase();
  }

  if (/Architecture Studies/i.test(title)) return "sm-arch-studies";
  if (/\(MArch\)/i.test(title)) return "march";

  return slug;
}

function parseContainer(
  html: string,
  level: DegreeLevel,
): Array<Omit<DegreeChartIndexEntry, "schools">> {
  const entries: Array<Omit<DegreeChartIndexEntry, "schools">> = [];
  const schoolSections = html.split(/<h3[^>]*>/).slice(1);

  for (const section of schoolSections) {
    const schoolEnd = section.indexOf("</h3>");
    if (schoolEnd < 0) continue;

    const school = decodeHtmlText(section.slice(0, schoolEnd));
    const linksHtml = section.slice(schoolEnd);

    for (const linkMatch of linksHtml.matchAll(CHART_LINK_RE)) {
      const href = linkMatch[1]!;
      const title = decodeHtmlText(linkMatch[2]!);
      const slug = slugFromHref(href);
      entries.push({
        slug,
        url: toAbsoluteUrl(href),
        title,
        level,
        school,
        programId: inferProgramId(slug, title),
      });
    }
  }

  return entries;
}

function extractContainer(html: string, level: DegreeLevel): string {
  const pattern =
    level === "undergraduate" ? UNDERGRAD_CONTAINER_RE : GRAD_CONTAINER_RE;
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Could not find ${level} degree chart section in index HTML`);
  }
  return match[0]!;
}

function dedupeEntries(
  entries: Array<Omit<DegreeChartIndexEntry, "schools">>,
): DegreeChartIndexEntry[] {
  const bySlug = new Map<string, DegreeChartIndexEntry>();

  for (const entry of entries) {
    const existing = bySlug.get(entry.slug);
    if (!existing) {
      bySlug.set(entry.slug, { ...entry, schools: [entry.school] });
      continue;
    }
    if (!existing.schools.includes(entry.school)) {
      existing.schools.push(entry.school);
    }
  }

  return [...bySlug.values()];
}

export function parseDegreeChartIndexHtml(
  html: string,
  meta: { sourceUrl: string; scrapedAt: string; contentHash: string },
): DegreeChartIndex {
  const undergrad = parseContainer(extractContainer(html, "undergraduate"), "undergraduate");
  const graduate = parseContainer(extractContainer(html, "graduate"), "graduate");

  return {
    schemaVersion: "1",
    sourceUrl: meta.sourceUrl,
    scrapedAt: meta.scrapedAt,
    contentHash: meta.contentHash,
    entries: dedupeEntries([...undergrad, ...graduate]),
  };
}
