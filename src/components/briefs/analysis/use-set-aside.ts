/**
 * The profiles an analysis set aside, as the "Écartés" group lists
 * them: the ones the full reading set aside (no_fit, the closest
 * first, from the results on screen), then the ones the triage set
 * aside (another job, or a card it could not judge), read from
 * search_triage fifty at a time under RLS (each page after the last id
 * read, so a verdict written meanwhile hides no row), with the
 * profiles of the rows shown read in lots. Nothing is read until the
 * group is on screen (`enabled`; most visits never open it); another
 * analysis starts afresh. A profile brought back to be read in full
 * leaves the list at once. The model proposed this; a person can
 * always look, and decides.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";
import { appendPage, SET_ASIDE_PAGE } from "@/lib/briefs/presentation";
import { listSetAside, type SetAsideEntry } from "@/lib/briefs/queries";
import type { MatchResult } from "@/lib/db/types";
import { readProfilesById, type ProfileCandidate } from "@/lib/shortlists/queries";
import type { ReadingSubject } from "@/lib/shortlists/groups";

import type { RowCandidate } from "./use-analysis";

/** The triage's rows read so far, the last id read (the next page starts after it), how many there are in all, and whether the last page ended the list. */
interface TriageList {
  searchId: string;
  rows: SetAsideEntry[];
  cursor: string | null;
  total: number;
  ended: boolean;
}

export interface SetAsideList {
  /** The rows of the group: the readings' no_fit first, then the triage's pages. */
  subjects: readonly ReadingSubject[];
  /** True while the first page is being read. */
  loading: boolean;
  /** True when the last page could not be read: `retry` reads it again. */
  failed: boolean;
  /** True while triage pages are left to read. */
  hasMore: boolean;
  /** True while a page is being read. */
  busy: boolean;
  more: () => Promise<void>;
  retry: () => Promise<void>;
  /** A profile brought back to be read in full leaves the triage's rows at once. */
  drop: (candidateId: string) => void;
  candidateOf: (candidateId: string) => RowCandidate;
}

export function useSetAside({
  orgId,
  searchId,
  triageCount,
  read,
  enabled,
}: {
  orgId: string;
  /** The analysis on screen; null without one. */
  searchId: string | null;
  /** The profiles the triage set aside (0 without a triage). */
  triageCount: number;
  /** The full readings decided no_fit, closest first. */
  read: readonly MatchResult[];
  /** True while the group is on screen. */
  enabled: boolean;
}): SetAsideList {
  const [triage, setTriage] = useState<TriageList | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const triageRef = useRef(triage);
  triageRef.current = triage;
  // One page at a time: a second click while one is read would ask for the same page.
  const reading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadPage = useCallback(async () => {
    if (searchId === null || reading.current) return;
    reading.current = true;
    setBusy(true);
    setFailed(false);
    const known = triageRef.current?.searchId === searchId ? triageRef.current : null;
    try {
      const page = await listSetAside(await requireSupabase(), orgId, searchId, {
        after: known?.cursor ?? null,
        limit: SET_ASIDE_PAGE,
      });
      if (!mounted.current) return;
      setTriage((current) => {
        const before = current?.searchId === searchId ? current : null;
        const rows = appendPage(before?.rows ?? [], page.rows);
        return {
          searchId,
          rows,
          cursor: page.rows[page.rows.length - 1]?.candidateId ?? before?.cursor ?? null,
          // The first page counts them all; a shorter page ends the list, whatever the count said.
          total: page.total ?? before?.total ?? rows.length,
          ended: page.rows.length < SET_ASIDE_PAGE,
        };
      });
    } catch (error) {
      console.error(error);
      if (mounted.current) setFailed(true);
    } finally {
      reading.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [orgId, searchId]);

  // The first page is read when the group first shows, for the analysis on screen; another analysis reads afresh.
  const shown = triage !== null && triage.searchId === searchId ? triage : null;
  const wanted = enabled && searchId !== null && triageCount > 0;
  useEffect(() => {
    if (wanted && shown === null && !failed) void loadPage();
  }, [failed, loadPage, shown, wanted]);

  const subjects = useMemo<ReadingSubject[]>(
    () => [
      ...read.map(
        (result): ReadingSubject => ({ kind: "result", candidateId: result.candidateId, result }),
      ),
      ...(shown?.rows ?? []).map(
        (row): ReadingSubject => ({
          kind: "triage",
          candidateId: row.candidateId,
          verdict: row.verdict,
          reason: row.reason,
        }),
      ),
    ],
    [read, shown],
  );

  // The profiles of the rows shown, read once each, in lots.
  const [people, setPeople] = useState<ReadonlyMap<string, ProfileCandidate | null>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const ids = useMemo(
    () => (enabled ? subjects.map((subject) => subject.candidateId) : []),
    [enabled, subjects],
  );
  useEffect(() => {
    const missing = ids.filter((id) => !asked.current.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    void (async () => {
      try {
        const found = await readProfilesById(await requireSupabase(), orgId, missing);
        if (!mounted.current) return;
        setPeople((current) => {
          const next = new Map(current);
          for (const [id, row] of found) next.set(id, row);
          return next;
        });
      } catch (error) {
        // Read again when the rows shown change: the ids are no longer marked as asked.
        console.error(error);
        for (const id of missing) asked.current.delete(id);
      }
    })();
  }, [ids, orgId]);
  const candidateOf = useCallback((candidateId: string) => people.get(candidateId), [people]);

  const drop = useCallback((candidateId: string) => {
    setTriage((current) => {
      if (!current) return current;
      const rows = current.rows.filter((row) => row.candidateId !== candidateId);
      if (rows.length === current.rows.length) return current;
      return { ...current, rows, total: Math.max(0, current.total - 1) };
    });
  }, []);

  return {
    subjects,
    loading: wanted && shown === null && !failed,
    failed,
    hasMore: shown !== null && !shown.ended && shown.rows.length < shown.total,
    busy,
    more: loadPage,
    retry: loadPage,
    drop,
    candidateOf,
  };
}
