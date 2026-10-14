/**
 * The upload runner bound to supabase-js under RLS: the hash through Web
 * Crypto, the duplicate look-up on documents (org_id, sha256), the
 * object in the private `cvs` bucket at <org_id>/<document_id>.pdf, the
 * documents row (status defaults to queued; uploaded_by must be the
 * caller; a fixed candidate_id makes the processor merge into that
 * profile). Removing an object is only granted to admins: for a member
 * the runner logs the orphan and moves on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { hashFile } from "./hash";
import type { UploadDeps } from "./upload-runner";

export const CV_BUCKET = "cvs";

/** The Postgres code of a unique-index violation: the same CV is already in the pool. */
export const UNIQUE_VIOLATION = "23505";

export interface UploadTarget {
  orgId: string;
  userId: string;
  /** The profile the new documents belong to, or null for a fresh upload. */
  candidateId: string | null;
}

export function supabaseUploadDeps(supabase: SupabaseClient, target: UploadTarget): UploadDeps {
  return {
    hash: hashFile,
    findDuplicate: async (sha256) => {
      const { data, error } = await supabase
        .from("documents")
        .select("id")
        .eq("org_id", target.orgId)
        .eq("sha256", sha256)
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as unknown[]).length > 0;
    },
    upload: async (path, file) => {
      const { error } = await supabase.storage
        .from(CV_BUCKET)
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (error) throw error;
    },
    insert: async (item, sha256) => {
      const { error } = await supabase.from("documents").insert({
        id: item.id,
        org_id: target.orgId,
        candidate_id: target.candidateId,
        storage_path: item.path,
        file_name: item.file.name.slice(0, 255) || "cv.pdf",
        mime_type: "application/pdf",
        byte_size: item.file.size,
        sha256,
        uploaded_by: target.userId,
      });
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return "duplicate";
        throw error;
      }
      return "ok";
    },
    remove: async (path) => {
      const { error } = await supabase.storage.from(CV_BUCKET).remove([path]);
      if (error) throw error;
    },
  };
}

/** A short-lived link to a CV, opened by the person in a new tab or shown in the viewer; with `download`, a link the browser saves under that file name. */
export async function signedCvUrl(
  supabase: SupabaseClient,
  path: string,
  expiresIn = 300,
  download?: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CV_BUCKET)
    .createSignedUrl(path, expiresIn, download ? { download } : undefined);
  if (error) throw error;
  const url = data?.signedUrl;
  if (!url) throw new Error("Storage answered no signed URL");
  return url;
}
