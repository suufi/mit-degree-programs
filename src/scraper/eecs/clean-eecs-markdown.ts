/**
 * Strip navigation chrome and table separators from EECS pages.
 * Subject ids are extracted from catalog links by the parser — avoid
 * rewriting link text globally, which can break large track tables.
 */
export function cleanEecsMarkdown(raw: string): string {
  const reqStart = raw.search(/#{0,3}\s*Degree Requirements for/i);
  let md = reqStart >= 0 ? raw.slice(reqStart) : raw;

  md = md.replace(/^\|[\s\-:|]+\|$/gm, "");
  md = md.replace(/^-{3,}\s*$/gm, "");
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

/** Compact a cell/line for display or footnotes — not used for id extraction. */
export function stripEecsCourseDescription(text: string): string {
  return text
    .replace(
      /\[[^\]]*\]\(https?:\/\/student\.mit\.edu\/catalog\/search\.cgi\?search=([^)&\s]+)[^)]*\)/gi,
      "$1",
    )
    .replace(/\*\*(\d+\.[A-Za-z0-9]+)[^*]*\*\*/g, "$1")
    .replace(/\s+Prereqs?:[\s\S]*?(Units:\s*\d+-\d+-\d+)?/gi, "")
    .trim();
}
