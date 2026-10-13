/**
 * The search of the talent pool for a brief: one button runs it (hybrid
 * retrieval in the database, explained scoring, the model's reading of
 * the top results when one is set up); the method, date and count of
 * the search shown sit above its results; previous searches of the
 * brief reopen from their stored results. Adding a result creates the
 * brief's shortlist on first use.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { runSearch } from "@/lib/briefs/briefs.functions";
import { rankResults } from "@/lib/briefs/matching";
import {
  addShortlistItem,
  ensureShortlist,
  listSearches,
  readResultCandidates,
  readSearch,
  readShortlistState,
} from "@/lib/briefs/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, BriefRow, MatchResult, SearchMethod } from "@/lib/db/types";
import { formatDateTime, useI18n } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

import { ResultCard } from "./result-card";

interface SearchView {
  id: string;
  method: SearchMethod;
  createdAt: string;
  results: MatchResult[];
  /** The criteria the verdicts refer to, as they were when the search ran. */
  criteria: BriefCriterion[];
}

function ResultSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="sheet flex gap-3 p-4">
          <div className="skeleton size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-1/3 rounded" />
            <div className="skeleton h-3 w-2/3 rounded" />
            <div className="skeleton h-6 w-full rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SearchPanel({
  brief,
  canEdit,
  criteriaDirty,
}: {
  brief: BriefRow;
  canEdit: boolean;
  /** True while the criteria editor holds unsaved rows: a search reads the saved brief. */
  criteriaDirty: boolean;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [current, setCurrent] = useState<SearchView | null>(null);
  const [running, setRunning] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);

  const searches = useQuery(`brief-searches:${brief.id}`, async () =>
    listSearches(await requireSupabase(), brief.org_id, brief.id),
  );
  const shortlist = useQuery(`brief-shortlist:${brief.id}`, async () =>
    readShortlistState(await requireSupabase(), brief.org_id, brief.id),
  );

  const ranked = useMemo(() => (current ? rankResults(current.results) : []), [current]);
  const ids = useMemo(() => ranked.map((result) => result.candidateId), [ranked]);
  const candidates = useQuery(
    `brief-result-candidates:${current?.id ?? ""}`,
    async () => readResultCandidates(await requireSupabase(), brief.org_id, ids),
    ids.length > 0,
  );
  const byId = useMemo(
    () => new Map((candidates.data ?? []).map((candidate) => [candidate.id, candidate] as const)),
    [candidates.data],
  );
  const shortlistId = shortlist.data?.shortlistId ?? null;
  const addedIds = useMemo(() => new Set(shortlist.data?.candidateIds ?? []), [shortlist.data]);

  const open = useCallback(
    async (searchId: string) => {
      setOpening(searchId);
      try {
        const row = await readSearch(await requireSupabase(), brief.org_id, searchId);
        if (row) {
          setCurrent({ id: row.id, method: row.method, createdAt: row.created_at, results: row.results, criteria: row.criteria });
        }
      } catch (error) {
        console.error(error);
        toast.error(t("briefs.search.loadFailed"));
      } finally {
        setOpening(null);
      }
    },
    [brief.org_id, t],
  );

  // The latest search opens by itself once the list is known.
  useEffect(() => {
    if (autoOpened || current || searches.loading) return;
    setAutoOpened(true);
    const latest = searches.data?.[0];
    if (latest) void open(latest.id);
  }, [autoOpened, current, open, searches.data, searches.loading]);

  const refreshSearches = searches.refresh;
  const refreshShortlist = shortlist.refresh;
  useEffect(
    () =>
      subscribeToTable(
        "searches",
        `brief_id=eq.${brief.id}`,
        debounce(() => {
          void refreshSearches();
        }, 400),
      ),
    [brief.id, refreshSearches],
  );
  useEffect(() => {
    if (!shortlistId) return undefined;
    return subscribeToTable(
      "shortlist_items",
      `shortlist_id=eq.${shortlistId}`,
      debounce(() => {
        void refreshShortlist();
      }, 400),
    );
  }, [refreshShortlist, shortlistId]);

  async function run() {
    if (!canEdit || running || criteriaDirty) return;
    setRunning(true);
    try {
      const answer = await runSearch({ data: { ...(await withToken()), orgId: brief.org_id, briefId: brief.id } });
      setCurrent({
        id: answer.searchId,
        method: answer.method,
        createdAt: answer.createdAt,
        results: answer.results,
        criteria: answer.criteria,
      });
      setAutoOpened(true);
      void refreshSearches();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setRunning(false);
    }
  }

  async function add(result: MatchResult) {
    if (!user) return;
    try {
      const supabase = await requireSupabase();
      const id =
        shortlistId ?? (await ensureShortlist(supabase, { orgId: brief.org_id, briefId: brief.id, userId: user.id }));
      const outcome = await addShortlistItem(supabase, {
        orgId: brief.org_id,
        shortlistId: id,
        candidateId: result.candidateId,
        match: result,
        userId: user.id,
      });
      await refreshShortlist();
      toast.success(outcome === "added" ? t("briefs.results.addedToast") : t("briefs.results.alreadyAdded"));
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    }
  }

  function countText(count: number): string {
    if (count === 0) return t("briefs.search.count.none");
    if (count === 1) return t("briefs.search.count.one");
    return t("briefs.search.count.many", { count });
  }

  const runButton = canEdit ? (
    <Button type="button" onClick={() => void run()} disabled={running || criteriaDirty} className="gap-1.5">
      <Search />
      {running ? t("briefs.search.running") : t("briefs.search.run")}
    </Button>
  ) : null;

  const candidatesPending = ids.length > 0 && candidates.loading && candidates.data === null;

  return (
    <section className="space-y-4">
      <div className="sheet space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="font-display text-lg text-ink">{t("briefs.part.search")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("briefs.search.help")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {runButton}
          {canEdit && criteriaDirty ? <span className="text-xs text-muted-foreground">{t("briefs.search.saveFirst")}</span> : null}
          {!canEdit ? <span className="text-xs text-muted-foreground">{t("briefs.search.viewer")}</span> : null}
        </div>
        {searches.data?.length ? (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <Label htmlFor="brief-previous-search">{t("briefs.search.previous")}</Label>
            <Select
              value={current?.id ?? ""}
              onValueChange={(value) => {
                if (value && value !== current?.id) void open(value);
              }}
              disabled={opening !== null || running}
            >
              <SelectTrigger id="brief-previous-search" className="sm:w-96">
                <SelectValue placeholder={t("briefs.search.pick")} />
              </SelectTrigger>
              <SelectContent>
                {searches.data.map((search) => (
                  <SelectItem key={search.id} value={search.id}>
                    {`${formatDateTime(locale, search.created_at)} · ${countText(search.result_count)} · ${t(`briefs.search.method.short.${search.method}`)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {current ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t(`briefs.search.method.${current.method}`)} · {t("briefs.search.ranAt", { date: formatDateTime(locale, current.createdAt) })} ·{" "}
            {countText(ranked.length)}
          </p>
          {ranked.length === 0 ? (
            <EmptyState icon={<SearchX />} title={t("briefs.search.none.title")} text={t("briefs.search.none.text")} />
          ) : candidatesPending ? (
            <ResultSkeleton />
          ) : (
            <ul className="space-y-3">
              {ranked.map((result) => (
                <ResultCard
                  key={result.candidateId}
                  result={result}
                  criteria={current.criteria}
                  candidate={byId.get(result.candidateId) ?? null}
                  shortlistId={shortlistId}
                  added={addedIds.has(result.candidateId)}
                  canEdit={canEdit}
                  onAdd={() => add(result)}
                />
              ))}
            </ul>
          )}
        </>
      ) : opening || (searches.loading && !searches.data) ? (
        <ResultSkeleton />
      ) : (
        <EmptyState icon={<Search />} title={t("briefs.search.empty.title")} text={t("briefs.search.empty.text")} action={runButton} />
      )}
    </section>
  );
}
