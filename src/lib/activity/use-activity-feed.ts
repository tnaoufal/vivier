/**
 * The paged feed of one organisation: the first page on mount, more on
 * demand, and a reload of what is shown when the table changes. Names of
 * the briefs and candidates seen so far come along, so the list never
 * shows an id.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import type { ActivityRow } from "@/lib/db/types";

import { ACTIVITY_PAGE, readActivities, readActivityTargets } from "./activity";
import type { ActivityFamily } from "./describe";

export interface ActivityFeed {
  rows: ActivityRow[];
  briefs: Map<string, string>;
  candidates: Map<string, string>;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useActivityFeed(orgId: string, family: ActivityFamily | null, pageSize = ACTIVITY_PAGE): ActivityFeed {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [briefs, setBriefs] = useState<Map<string, string>>(new Map());
  const [candidates, setCandidates] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const rowsRef = useRef<ActivityRow[]>([]);
  const sequence = useRef(0);

  const mergeTargets = useCallback(async (fresh: ActivityRow[]) => {
    const supabase = await requireSupabase();
    const targets = await readActivityTargets(supabase, fresh);
    setBriefs((prev) => new Map([...prev, ...targets.briefs]));
    setCandidates((prev) => new Map([...prev, ...targets.candidates]));
  }, []);

  /** Re-reads from the top up to what is shown (at least one page). */
  const refresh = useCallback(async () => {
    const mine = ++sequence.current;
    const to = Math.max(rowsRef.current.length, pageSize) - 1;
    try {
      const supabase = await requireSupabase();
      const fresh = await readActivities(supabase, orgId, { family, from: 0, to });
      if (mine !== sequence.current) return;
      rowsRef.current = fresh;
      setRows(fresh);
      setHasMore(fresh.length === to + 1);
      setError(false);
      await mergeTargets(fresh);
    } catch (caught) {
      if (mine !== sequence.current) return;
      console.error(caught);
      setError(true);
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [family, mergeTargets, orgId, pageSize]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const mine = sequence.current;
    const from = rowsRef.current.length;
    setLoadingMore(true);
    try {
      const supabase = await requireSupabase();
      const next = await readActivities(supabase, orgId, { family, from, to: from + pageSize - 1 });
      if (mine !== sequence.current) return;
      const seen = new Set(rowsRef.current.map((row) => row.id));
      const merged = [...rowsRef.current, ...next.filter((row) => !seen.has(row.id))];
      rowsRef.current = merged;
      setRows(merged);
      setHasMore(next.length === pageSize);
      await mergeTargets(next);
    } catch (caught) {
      console.error(caught);
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [family, loadingMore, mergeTargets, orgId, pageSize]);

  useEffect(() => {
    rowsRef.current = [];
    setRows([]);
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const soon = debounce(() => void refresh());
    return subscribeToTable("activities", `org_id=eq.${orgId}`, soon);
  }, [orgId, refresh]);

  return { rows, briefs, candidates, loading, loadingMore, error, hasMore, loadMore, refresh };
}
