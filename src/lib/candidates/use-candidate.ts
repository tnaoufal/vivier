/**
 * The React side of one profile, shared by the pool's detail pane and
 * the candidate's page. `useCandidate` reads the row and its documents
 * for an id (readCandidate, listCandidateDocuments) and follows the
 * documents through realtime: the service merges a CV into the profile,
 * so both are read again when one changes. `useCandidateUpdate` is the
 * one write of the sheet and its menu: an update under RLS on the
 * columns the grant allows, a toast on failure (and one on success when
 * a sentence is given), then whatever the caller reads again.
 */
import { useCallback, useEffect } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { CandidateRow, DocumentRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";

import { listCandidateDocuments, readCandidate } from "./queries";

export interface CandidateState {
  /** The profile; null while it loads, when it does not exist and when the read failed. */
  candidate: CandidateRow | null;
  documents: DocumentRow[];
  /** True until the first read of the profile answered. */
  loading: boolean;
  /** The read's error, when it failed. */
  error: string | null;
  refreshCandidate: () => Promise<void>;
  refreshDocuments: () => Promise<void>;
}

export function useCandidate(orgId: string, candidateId: string): CandidateState {
  const candidate = useQuery(`candidate:${orgId}:${candidateId}`, async () =>
    readCandidate(await requireSupabase(), orgId, candidateId),
  );
  const documents = useQuery(`candidate-documents:${orgId}:${candidateId}`, async () =>
    listCandidateDocuments(await requireSupabase(), orgId, candidateId),
  );
  const refreshCandidate = candidate.refresh;
  const refreshDocuments = documents.refresh;
  useEffect(() => {
    const onDocuments = debounce(() => {
      void refreshDocuments();
      void refreshCandidate();
    }, 400);
    return subscribeToTable("documents", `candidate_id=eq.${candidateId}`, onDocuments);
  }, [candidateId, refreshCandidate, refreshDocuments]);
  return {
    candidate: candidate.data ?? null,
    documents: documents.data ?? [],
    loading: candidate.loading && !candidate.data,
    error: candidate.error,
    refreshCandidate,
    refreshDocuments,
  };
}

export type CandidateUpdate = (patch: Record<string, unknown>, done?: string) => Promise<boolean>;

/** One update of the profile under RLS; true when it went through (and `onChanged` ran). */
export function useCandidateUpdate(
  orgId: string,
  candidateId: string,
  onChanged: () => void | Promise<void>,
): CandidateUpdate {
  const t = useT();
  return useCallback(
    async (patch: Record<string, unknown>, done?: string): Promise<boolean> => {
      try {
        const supabase = await requireSupabase();
        const { error } = await supabase
          .from("candidates")
          .update(patch)
          .eq("id", candidateId)
          .eq("org_id", orgId);
        if (error) {
          console.error(error);
          toast.error(t("common.error"));
          return false;
        }
        await onChanged();
        if (done) toast.success(done);
        return true;
      } catch (error) {
        console.error(error);
        toast.error(t("common.error"));
        return false;
      }
    },
    [orgId, candidateId, onChanged, t],
  );
}
