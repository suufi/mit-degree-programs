import type {
  DegreeProgram,
  RequirementGroup,
  RequirementNode,
  SharedListDocument,
  SharedListItem,
} from "../../schemas/types";
import { makeSharedListId, sharedListOwnerProgram } from "../../schemas/shared-lists";
import { validateDegreeProgram } from "../../validators/index";
import { subjectNode } from "../parse-degree-chart";
import { mergeRequirementGroups, slugifyGroupId } from "../normalize-common";
import type { EecsElectiveRule, EecsRequirementsAst, EecsTrack } from "./parse-eecs-requirements";

function trackMatchesFilter(
  track: EecsTrack,
  filter: "cs" | "aid-cs-ee" | "ee",
): boolean {
  if (filter === "aid-cs-ee") return true;
  if (filter === "ee") {
    return track.areas.some((area) => /\bEE\b/.test(area.toUpperCase()));
  }
  return track.areas.some((area) => {
    const normalized = area.toUpperCase();
    return normalized === "CS" || normalized.startsWith("CS,") || normalized.endsWith(",CS");
  });
}

function trackSelectionNode(
  programId: string,
  tracks: EecsTrack[],
  chooseN: number,
  note: string,
): RequirementNode {
  return {
    type: "selection",
    ruleType: "choose_one",
    itemsSource: "explicit",
    note,
    items: tracks.map((track) => ({
      type: "selection",
      ruleType: "choose_n",
      ruleValue: chooseN,
      itemsSource: "shared_list",
      sharedListId: makeSharedListId(programId, track.slug),
      note: track.title,
    })),
  };
}

function buildTrackSharedLists(
  programId: string,
  tracks: EecsTrack[],
): SharedListDocument[] {
  return tracks.map((track) => ({
    sharedListId: makeSharedListId(programId, track.slug),
    program: sharedListOwnerProgram(programId, track.slug),
    title: track.title,
    items: track.subjectIds.map((id) => subjectNode(id)),
    version: "1",
  }));
}

function buildSubjectListDocuments(
  programId: string,
  ast: EecsRequirementsAst,
): SharedListDocument[] {
  return ast.subjectLists.map((list) => {
    const items: SharedListItem[] = list.items.map((item) => {
      if (item.kind === "subject") return subjectNode(item.subjectId);
      return {
        type: "group" as const,
        ruleType: "all_of" as const,
        items: item.subjectIds.map((id) => subjectNode(id)),
      };
    });
    return {
      sharedListId: makeSharedListId(programId, list.slug),
      program: sharedListOwnerProgram(programId, list.slug),
      title: list.title,
      items,
      version: "1",
    };
  });
}

function listRuleNode(
  programId: string,
  rule: EecsElectiveRule,
  ast: EecsRequirementsAst,
): RequirementNode {
  if (rule.explicitSubjectIds?.length) {
    return {
      type: "selection",
      ruleType: "choose_n",
      ruleValue: rule.chooseN,
      itemsSource: "explicit",
      items: rule.explicitSubjectIds.map((id) => subjectNode(id)),
      note: rule.text,
    };
  }

  const sharedListIds = (rule.listSlugs ?? [])
    .map((slug) => ast.subjectLists.find((list) => list.slug === slug))
    .filter((list): list is NonNullable<typeof list> => Boolean(list))
    .map((list) => makeSharedListId(programId, list.slug));

  if (sharedListIds.length > 0) {
    return {
      type: "selection",
      ruleType: "choose_n",
      ruleValue: rule.chooseN,
      itemsSource: "shared_list_union",
      sharedListIds,
      note: rule.text,
    };
  }

  return {
    type: "selection",
    ruleType: "choose_n",
    ruleValue: rule.chooseN,
    itemsSource: "tag_pool",
    tag: "eecs-elective-pool",
    note: rule.text,
  };
}

function buildElectiveGroups(
  programId: string,
  ast: EecsRequirementsAst,
): RequirementGroup[] {
  const groups: RequirementGroup[] = [];
  const csTracks = ast.tracks.filter((track) => trackMatchesFilter(track, "cs"));
  const eeTracks = ast.tracks.filter((track) => trackMatchesFilter(track, "ee"));
  const allTracks = ast.tracks;
  const handled = new Set<EecsElectiveRule>();

  for (const rule of ast.electiveRules) {
    if (rule.trackFilter === "cs" && csTracks.length > 0) {
      groups.push({
        groupId: slugifyGroupId(programId, "cs-track-electives"),
        title: "CS Track Electives",
        bucket: "elective",
        subcategory: "elective_subjects",
        note: rule.text,
        root: trackSelectionNode(programId, csTracks, rule.chooseN, rule.text),
      });
      handled.add(rule);
    } else if (rule.trackFilter === "ee" && eeTracks.length > 0) {
      groups.push({
        groupId: slugifyGroupId(
          programId,
          rule.differentTrack ? "additional-ee-track-electives" : "ee-track-electives",
        ),
        title: rule.differentTrack ? "Additional EE Track Electives" : "EE Track Electives",
        bucket: "elective",
        subcategory: "elective_subjects",
        note: rule.text,
        flexibility: rule.differentTrack
          ? { catalogText: "Must be a different EE track than the first EE track electives." }
          : undefined,
        root: trackSelectionNode(programId, eeTracks, rule.chooseN, rule.text),
      });
      handled.add(rule);
    } else if (rule.trackFilter === "aid-cs-ee" && allTracks.length > 0) {
      groups.push({
        groupId: slugifyGroupId(programId, "cs-ai-ee-track-electives"),
        title: "AI+D, CS, or EE Track Electives",
        bucket: "elective",
        subcategory: "elective_subjects",
        note: rule.text,
        flexibility: rule.differentTrack
          ? { catalogText: "Must be a different track than the CS track electives." }
          : undefined,
        root: trackSelectionNode(programId, allTracks, rule.chooseN, rule.text),
      });
      handled.add(rule);
    }
  }

  const titledRules = new Map<string, EecsElectiveRule[]>();
  for (const rule of ast.electiveRules) {
    if (handled.has(rule) || rule.trackFilter || !rule.groupTitle) continue;
    const bucket = titledRules.get(rule.groupTitle) ?? [];
    bucket.push(rule);
    titledRules.set(rule.groupTitle, bucket);
  }

  for (const [title, rules] of titledRules) {
    for (const rule of rules) handled.add(rule);
    const slug = slugifyGroupId(programId, title);
    groups.push({
      groupId: slug,
      title,
      bucket: "elective",
      subcategory: "elective_subjects",
      root:
        rules.length === 1
          ? listRuleNode(programId, rules[0]!, ast)
          : {
              type: "group",
              ruleType: "all_of",
              items: rules.map((rule) => listRuleNode(programId, rule, ast)),
            },
    });
  }

  const listOnlyRules = ast.electiveRules.filter(
    (rule) =>
      !handled.has(rule) &&
      !rule.trackFilter &&
      (rule.listSlugs?.length || rule.explicitSubjectIds?.length),
  );

  if (listOnlyRules.length > 1 && ast.tracks.length === 0) {
    for (const rule of listOnlyRules) handled.add(rule);
    groups.push({
      groupId: slugifyGroupId(programId, "elective-subjects"),
      title: "Elective Subjects",
      bucket: "elective",
      subcategory: "elective_subjects",
      root: {
        type: "group",
        ruleType: "all_of",
        items: listOnlyRules.map((rule) => listRuleNode(programId, rule, ast)),
      },
    });
  }

  for (const rule of ast.electiveRules) {
    if (handled.has(rule) || rule.trackFilter) continue;

    const title =
      rule.groupTitle ??
      (rule.listSlugs?.length || rule.explicitSubjectIds?.length
        ? "Additional Elective"
        : undefined);
    if (!title) continue;

    groups.push({
      groupId: slugifyGroupId(programId, title),
      title,
      bucket: "elective",
      subcategory: "elective_subjects",
      note: rule.text,
      flexibility: rule.listSlugs && rule.listSlugs.length < 5
        ? { catalogText: rule.text }
        : undefined,
      root: listRuleNode(programId, rule, ast),
    });
  }

  return groups;
}

function patchFootnoteAppliesTo(program: DegreeProgram): DegreeProgram {
  const groupIds = new Set(program.requirements.map((group) => group.groupId));
  const poolIds = [
    "cs-track-electives",
    "cs-ai-ee-track-electives",
    "additional-elective",
    "aus2",
  ]
    .map((slug) => makeSharedListId(program.program, slug))
    .filter((id) => {
      const slug = id.split(".")[1] ?? "";
      return [...groupIds].some((groupId) => groupId.includes(slug));
    });

  const footnotes = program.footnotes?.map((footnote) => {
    if (!/advanced undergraduate|independent inquiry|eecs tracks/i.test(footnote.text)) {
      return footnote;
    }
    return poolIds.length > 0 ? { ...footnote, appliesTo: poolIds } : footnote;
  });
  return footnotes ? { ...program, footnotes } : program;
}

export function enrichCourse6WithEecs(
  program: DegreeProgram,
  sharedLists: SharedListDocument[],
  eecs: EecsRequirementsAst,
): { program: DegreeProgram; sharedLists: SharedListDocument[] } {
  const trackLists = buildTrackSharedLists(program.program, eecs.tracks);
  const subjectLists = buildSubjectListDocuments(program.program, eecs);
  const mergedLists = [...trackLists, ...subjectLists];

  const listById = new Map<string, SharedListDocument>();
  for (const list of [...sharedLists, ...mergedLists]) {
    listById.set(list.sharedListId, list);
  }

  const catalogCore = program.requirements.filter(
    (group) =>
      !/track elective|additional elective|elective subjects|restricted elective|computational biology|economics elective|communication-intensive|computer science elective/i.test(
        group.title,
      ) && group.title !== "Select 12 units of the following:",
  );

  const renamedCore =
    program.requirements.some((group) => group.title === "Required Subjects")
      ? []
      : program.requirements
          .filter((group) => group.title === "Select 12 units of the following:")
          .map((group) => ({
            ...group,
            groupId: slugifyGroupId(program.program, "computer-science-requirements"),
            title: "Computer Science Requirements",
            subcategory: "required_subjects" as const,
          }));

  const electiveGroups = buildElectiveGroups(program.program, eecs);
  const requirements = mergeRequirementGroups([
    ...catalogCore,
    ...renamedCore,
    ...electiveGroups,
  ]);

  let nextProgram: DegreeProgram = {
    ...program,
    requirements,
  };

  if (eecs.additionalConstraints.length > 0) {
    const maxFootnoteId = Math.max(
      0,
      ...((nextProgram.footnotes ?? [])
        .map((f) => Number.parseInt(f.id, 10))
        .filter(Number.isFinite)),
    );
    const constraintFootnotes = eecs.additionalConstraints.map((text, index) => ({
      id: String(maxFootnoteId + index + 1),
      text,
    }));
    nextProgram = {
      ...nextProgram,
      footnotes: [...(nextProgram.footnotes ?? []), ...constraintFootnotes],
    };
  }

  nextProgram = patchFootnoteAppliesTo(nextProgram);

  const validated = validateDegreeProgram(nextProgram, {
    sharedLists: [...listById.values()],
  });
  if (!validated.ok) {
    throw new Error(
      `EECS enrichment failed validation: ${validated.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`,
    );
  }

  return {
    program: validated.data,
    sharedLists: [...listById.values()],
  };
}
