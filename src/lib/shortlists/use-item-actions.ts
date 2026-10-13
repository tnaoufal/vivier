/**
 * The writes a person makes on one shortlist item (decide, assign, vote,
 * note, remove), behind one busy flag so a double click cannot send two
 * updates, with the toast on failure and a refresh of the board on
 * success. Shared by the card and the drawer; the callers only render
 * the buttons when the role allows (RLS checks it again).
 */
import { useCallback, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabase } from "@/lib/auth/supabase-client";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";

import { castVote, clearVote, removeItem, setItemAssignee, setItemNote, setItemStatus } from "./queries";
import type { VoteValue } from "./tally";

export interface ItemActions {
  busy: boolean;
  decide: (status: ShortlistItemStatus) => Promise<boolean>;
  assign: (userId: string | null) => Promise<boolean>;
  /** Casts `value`; casting the vote already held withdraws it. */
  vote: (value: VoteValue, current: VoteValue | null) => Promise<boolean>;
  saveNote: (note: string) => Promise<boolean>;
  remove: () => Promise<boolean>;
}

export function useItemActions(input: {
  orgId: string;
  itemId: string;
  userId: string | null;
  onChanged: () => void;
}): ItemActions {
  const t = useT();
  const { orgId, itemId, userId, onChanged } = input;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(
    async (write: (supabase: SupabaseClient) => Promise<void>, done?: string): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        const supabase = await requireSupabase();
        await write(supabase);
        onChanged();
        if (done) toast.success(done);
        return true;
      } catch (error) {
        console.error(error);
        toast.error(t("common.error"));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onChanged, t],
  );

  const decide = useCallback(
    (status: ShortlistItemStatus) =>
      run((supabase) => setItemStatus(supabase, orgId, itemId, status), t("shortlists.statusSaved")),
    [itemId, orgId, run, t],
  );

  const assign = useCallback(
    (assignee: string | null) => run((supabase) => setItemAssignee(supabase, orgId, itemId, assignee)),
    [itemId, orgId, run],
  );

  const vote = useCallback(
    (value: VoteValue, current: VoteValue | null) => {
      if (!userId) return Promise.resolve(false);
      const voter = userId;
      return run((supabase) =>
        current === value
          ? clearVote(supabase, orgId, itemId, voter)
          : castVote(supabase, { orgId, itemId, userId: voter, value }),
      );
    },
    [itemId, orgId, run, userId],
  );

  const saveNote = useCallback(
    (note: string) =>
      run((supabase) => setItemNote(supabase, orgId, itemId, note.trim() || null), t("shortlists.note.saved")),
    [itemId, orgId, run, t],
  );

  const remove = useCallback(
    () => run((supabase) => removeItem(supabase, orgId, itemId), t("shortlists.removed")),
    [itemId, orgId, run, t],
  );

  return { busy, decide, assign, vote, saveNote, remove };
}
