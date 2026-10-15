/**
 * The shortlist of the brief page as its rows read it: the items with
 * their candidate and the thread's count per item, read for the
 * shortlist the analysis controller knows, live on the shortlist's
 * items and the organisation's comments, and only while the shortlist
 * group is on screen (`enabled`; what was read stays). A decision made
 * from a row or the reading pane shows at once and the next read
 * confirms it (a refused write puts the row back and says so in a
 * toast of two words); one write at a time per item.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useT, type TranslationKey } from "@/lib/i18n";
import { readBoard, setItemStatus, type Board, type BoardItem } from "@/lib/shortlists/queries";
import { toast } from "@/lib/toast";

const EMPTY_BOARD: Board = { items: [], threadCounts: new Map() };

/** The toast of a decision: two words. */
export const DECISION_TOASTS: Record<ShortlistItemStatus, TranslationKey> = {
  retained: "shortlists.toast.retained",
  dismissed: "shortlists.toast.dismissed",
  to_review: "shortlists.toast.to_review",
};

export interface BoardState {
  /** The items in their stored order, a decision just made already applied. */
  items: readonly BoardItem[];
  threadCounts: ReadonlyMap<string, number>;
  /** True until the first read answers. */
  loading: boolean;
  /** True when the last read failed; `retry` reads again. */
  failed: boolean;
  retry: () => void;
  refresh: () => Promise<void>;
  /** Writes a decision on one item; false when it was refused. */
  decide: (itemId: string, status: ShortlistItemStatus) => Promise<boolean>;
  /** The item a write is under way for. */
  busyId: string | null;
}

export function useBoard({
  orgId,
  shortlistId,
  enabled,
}: {
  orgId: string;
  /** Null until the brief has a shortlist. */
  shortlistId: string | null;
  /** True while the shortlist group is on screen: the reads and the subscriptions run then. */
  enabled: boolean;
}): BoardState {
  const t = useT();
  const active = enabled && shortlistId !== null;
  const board = useQuery(
    `board:${orgId}:${shortlistId ?? ""}`,
    async () =>
      shortlistId ? readBoard(await requireSupabase(), orgId, shortlistId) : EMPTY_BOARD,
    active,
  );
  const refresh = board.refresh;

  useEffect(() => {
    if (!active || !shortlistId) return undefined;
    const soon = debounce(() => {
      void refresh();
    }, 300);
    const stops = [
      subscribeToTable("shortlist_items", `shortlist_id=eq.${shortlistId}`, soon),
      subscribeToTable("comments", `org_id=eq.${orgId}`, soon),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [active, orgId, refresh, shortlistId]);

  // A decision shows at once; the read that follows the write is the truth and clears it.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, ShortlistItemStatus>>(
    () => new Map(),
  );
  useEffect(() => {
    setOverrides(new Map());
  }, [board.data]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);

  const decide = useCallback(
    async (itemId: string, status: ShortlistItemStatus): Promise<boolean> => {
      if (busyRef.current !== null) return false;
      busyRef.current = itemId;
      setBusyId(itemId);
      setOverrides((current) => new Map(current).set(itemId, status));
      try {
        await setItemStatus(await requireSupabase(), orgId, itemId, status);
        toast.success(t(DECISION_TOASTS[status]));
        await refresh();
        return true;
      } catch (error) {
        console.error(error);
        setOverrides((current) => {
          const next = new Map(current);
          next.delete(itemId);
          return next;
        });
        toast.error(t("common.error"));
        return false;
      } finally {
        busyRef.current = null;
        setBusyId(null);
      }
    },
    [orgId, refresh, t],
  );

  const items = useMemo<readonly BoardItem[]>(() => {
    const read = board.data?.items ?? [];
    if (overrides.size === 0) return read;
    return read.map((item) => {
      const status = overrides.get(item.id);
      return status && status !== item.status ? { ...item, status } : item;
    });
  }, [board.data, overrides]);

  return {
    items,
    threadCounts: board.data?.threadCounts ?? EMPTY_BOARD.threadCounts,
    loading: active && board.loading && board.data === null,
    failed: board.error !== null,
    retry: () => {
      void refresh();
    },
    refresh,
    decide,
    busyId,
  };
}
