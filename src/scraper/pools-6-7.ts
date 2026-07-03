export function subjectNode(subjectId: string) {
  return { type: "subject" as const, subjectId };
}

function poolItems(ids: string[]) {
  return ids.map(subjectNode);
}

export const POOL_6_7_BIORE = poolItems([
  "7.08", "7.093", "7.094", "7.20", "7.21", "7.23", "7.24", "7.26", "7.27", "7.28",
  "7.29", "7.30", "7.31", "7.32", "7.33", "7.35", "7.371", "7.45", "7.46", "7.49",
  "9.17", "9.26",
]);

export const POOL_6_7_COMPBIO = poolItems([
  "1.088", "6.8701", "7.093", "7.094", "7.32", "7.33", "18.413",
]);

export const POOL_6_7_AI_D_AUS = poolItems([
  "6.3730", "6.4200", "6.5151", "6.5831", "6.7411", "6.8371", "6.8701", "6.8711", "18.404",
]);
