/**
 * The messages that mention the signed-in person in the current
 * organisation, newest first, with the object each is about named;
 * re-read on every change of the organisation's comments.
 */
import { useEffect } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { useOrg } from "@/lib/org/org-context";

import { MENTIONS_LIMIT, listMyMentions } from "./queries";
import type { MentionItem } from "./thread";

export interface MentionsState {
  items: MentionItem[];
  loading: boolean;
  /** True when the last read failed. */
  error: boolean;
  refresh: () => Promise<void>;
}

export function useMyMentions(limit: number = MENTIONS_LIMIT): MentionsState {
  const { org } = useOrg();
  const { user } = useAuth();
  const orgId = org?.id ?? null;
  const userId = user?.id ?? null;
  const query = useQuery(
    `mentions:${orgId ?? "none"}:${userId ?? "none"}:${limit}`,
    async () => {
      if (!orgId || !userId) return [];
      const supabase = await requireSupabase();
      return listMyMentions(supabase, orgId, userId, limit);
    },
    orgId !== null && userId !== null,
  );
  const refresh = query.refresh;
  useEffect(
    () =>
      orgId
        ? subscribeToTable(
            "comments",
            `org_id=eq.${orgId}`,
            debounce(() => void refresh()),
          )
        : undefined,
    [orgId, refresh],
  );
  return { items: query.data ?? [], loading: query.loading, error: query.error !== null, refresh };
}
