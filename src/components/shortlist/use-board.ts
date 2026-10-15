/**
 * The shortlist of the brief page as its rows read it: the items with
 * their candidate and the thread's count per item, read for the
 * shortlist the analysis controller knows, live on the shortlist's
 * items and on the messages of their threads, and only while the page
 * needs it (`enabled`: the shortlist group on screen, or a profile of
 * the shortlist read from another group; what was read stays). A
 * decision made from a row or the reading pane shows at once, as the
 * person's own (who, now), until a read shows it or a read started once
 * it was stored says what stands (a refused write puts the row back and
 * says so in a toast of two words); one write at a time.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable, type RealtimeChange } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useT, type TranslationKey } from "@/lib/i18n";
import { readBoard, setItemStatus, type Board, type BoardItem } from "@/lib/shortlists/queries";
import {
  unsettledDecisions,
  withShownDecisions,
  type ShownDecision,
} from "@/lib/shortlists/shown-decisions";
import { toast } from "@/lib/toast";

const EMPTY_BOARD: Board = { items: [], threadCounts: new Map() };

/** A board as one read answered it, with how many decisions this page had stored when the read started. */
interface BoardRead extends Board {
  after: number;
}

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
  /** True while the page needs the board (the shortlist group, or a shortlisted profile read from another group): the reads and the subscriptions run then. */
  enabled: boolean;
}): BoardState {
  const t = useT();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const active = enabled && shortlistId !== null;
  // How many decisions this page stored: a read notes it as it starts, so a read that started after a write is the truth for it.
  const written = useRef(0);
  const board = useQuery(
    `board:${orgId}:${shortlistId ?? ""}`,
    async (): Promise<BoardRead> => {
      const after = written.current;
      const read = shortlistId
        ? await readBoard(await requireSupabase(), orgId, shortlistId)
        : EMPTY_BOARD;
      return { ...read, after };
    },
    active,
  );
  const refresh = board.refresh;
  // The items read, for the messages: one on another thread (a brief, a profile, another shortlist) changes nothing here.
  const readIds = useMemo(
    () => new Set((board.data?.items ?? []).map((item) => item.id)),
    [board.data],
  );
  const itemIds = useRef<ReadonlySet<string>>(readIds);
  itemIds.current = readIds;

  useEffect(() => {
    if (!active || !shortlistId) return undefined;
    const soon = debounce(() => {
      void refresh();
    }, 300);
    const onMessage = (change: RealtimeChange) => {
      // An edit changes no count.
      if (change.eventType === "UPDATE") return;
      const row = change.eventType === "DELETE" ? change.old : change.new;
      const itemId = row["shortlist_item_id"];
      // A removal may not name its thread (row-level security keeps the old row to its id): read again.
      if (typeof itemId === "string" ? itemIds.current.has(itemId) : change.eventType === "DELETE")
        soon();
    };
    const stops = [
      subscribeToTable("shortlist_items", `shortlist_id=eq.${shortlistId}`, soon),
      subscribeToTable("comments", `org_id=eq.${orgId}`, onMessage),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [active, orgId, refresh, shortlistId]);

  // A decision shows at once; it gives way to a read that shows it, or to one started once it was stored (the truth, whatever it says).
  const [overrides, setOverrides] = useState<ReadonlyMap<string, ShownDecision>>(() => new Map());
  useEffect(() => {
    const read = board.data;
    if (read) setOverrides((current) => unsettledDecisions(current, read));
  }, [board.data]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);

  const decide = useCallback(
    async (itemId: string, status: ShortlistItemStatus): Promise<boolean> => {
      if (busyRef.current !== null) return false;
      busyRef.current = itemId;
      setBusyId(itemId);
      // The database stamps the person and the moment; the row says the same until the read does.
      const shown: ShownDecision = {
        status,
        by: userId,
        at: new Date().toISOString(),
        write: null,
      };
      setOverrides((current) => new Map(current).set(itemId, shown));
      try {
        await setItemStatus(await requireSupabase(), orgId, itemId, status);
        const write = ++written.current;
        setOverrides((current) =>
          current.get(itemId) === shown
            ? new Map(current).set(itemId, { ...shown, write })
            : current,
        );
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
    [orgId, refresh, t, userId],
  );

  const items = useMemo<readonly BoardItem[]>(
    () => withShownDecisions(board.data?.items ?? [], overrides),
    [board.data, overrides],
  );

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
