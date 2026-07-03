import { z } from "zod";
import { sharedListRegistrySchema, sharedListSchema } from "./zod";
import {
  COURSE_6_SHARED_SCOPE,
  resolveSharedListScope,
} from "./course6-shared-lists";

export const SHARED_LISTS_FOLDER_NAME = "shared-lists";

export const sharedListDocumentSchema = sharedListSchema;
export const sharedListDocumentsSchema = sharedListRegistrySchema;

export type SharedListDocument = z.infer<typeof sharedListDocumentSchema>;
export type SharedListDocuments = z.infer<typeof sharedListDocumentsSchema>;

export { COURSE_6_SHARED_SCOPE };

export function makeSharedListId(program: string, listSlug: string): string {
  return resolveSharedListScope(program, listSlug).sharedListId;
}

export function sharedListOwnerProgram(program: string, listSlug: string): string {
  return resolveSharedListScope(program, listSlug).ownerProgram;
}
