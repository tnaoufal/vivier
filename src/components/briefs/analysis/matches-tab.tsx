/**
 * The "Correspondances" tab of a brief, top to bottom and nothing else:
 * the analysis band; the matches alone, as 64px rows in tier then rank
 * order (or, for an analysis no model could read, the head of the
 * ranking on the text, 20 rows at most); right under them the quiet
 * toggle of the near profiles and, when it is open, their rows, muted:
 * the ones the full reading found borderline first, then the ones the
 * screening scored but the promotion did not take (the score and the
 * reason as their line, fifty at a time, "Lire quand même" beside each
 * so a person may still have one read in full), so the list opens
 * where its control is; and the drawer of the row opened, which walks
 * the list it was opened from and follows its person when a reading
 * reorders the list. While the analysis is not through, a match the
 * second opinion has not seen is marked as such. A profile set aside by
 * the analysis is a figure of the band, never a row here: the figure
 * opens their own drawer, where each one is listed with its reason, and
 * one the triage set aside can be brought back to be read in full.
 */
import { Fragment, useEffect, useId, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  requirementTally,
  reservationLine,
  screenLine,
  synthesisLine,
} from "@/lib/briefs/presentation";
import { formatCount } from "@/lib/candidates/format";
import type { MatchResult } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { AnalysisBand } from "./analysis-band";
import { AsideRows, MoreButton, type ShownRow } from "./aside-rows";
import { MatchDrawer } from "./match-drawer";
import { MatchList, MatchListSkeleton } from "./match-list";
import { QuietButton } from "./quiet-button";
import { SetAsideDrawer } from "./set-aside-drawer";
import type { AnalysisController } from "./use-analysis";

type ListName = "main" | "near";

export function MatchesTab({
  analysis,
  orgId,
  canEdit,
  modelAvailable,
  briefStale,
  onShowShortlist,
}: {
  analysis: AnalysisController;
  orgId: string;
  canEdit: boolean;
  modelAvailable: boolean | null;
  /** True when the brief's text changed since the analysis on screen ran. */
  briefStale: boolean;
  /** Shows the brief's shortlist tab (from a drawer whose profile is already on it). */
  onShowShortlist: () => void;
}) {
  const { t, locale } = useI18n();
  const nearId = useId();
  const nearToggleId = useId();
  const [nearOpen, setNearOpen] = useState(false);
  const [setAsideOpen, setSetAsideOpen] = useState(false);
  // The drawer follows a person, not a place: a reading that reorders the list keeps it on them.
  const [drawer, setDrawer] = useState<{ list: ListName; candidateId: string } | null>(null);
  const { view, band, screened } = analysis;
  const viewId = view?.id ?? null;

  // Another analysis on screen starts closed.
  useEffect(() => {
    setNearOpen(false);
    setDrawer(null);
    setSetAsideOpen(false);
  }, [viewId]);

  const textOnly = band === "textOnly";
  const main = textOnly ? analysis.ranking : analysis.matches;
  const near = textOnly ? [] : analysis.near;
  const listOf = (name: ListName): readonly MatchResult[] => (name === "near" ? near : main);
  const drawerList = drawer ? listOf(drawer.list) : [];
  const drawerIndex = drawer
    ? drawerList.findIndex((result) => result.candidateId === drawer.candidateId)
    : -1;

  const tally = (result: MatchResult): string | null => {
    const { met, total } = requirementTally(result);
    if (total === 0) return null;
    return total === 1
      ? t("briefs.match.tally.one", { met })
      : t("briefs.match.tally", { met, total });
  };
  const opening = analysis.opening || (view === null && analysis.latestLoading);
  // While a new search is stored the previous analysis's rows step aside: the band says what runs.
  const rowsShown = view !== null && !analysis.starting;
  const canAdd = canEdit;
  // The job is not through: a match the second opinion has not seen may still leave the list.
  const provisional =
    band === "queued" || band === "running" || band === "stopped" || band === "failed";
  const wholePool = view?.method === "triage";
  const canReadAnyway = canEdit && wholePool && modelAvailable !== false;

  // The near profiles the screening scored but nobody read: the score and the reason as their line.
  const screenedRows: ShownRow[] = textOnly
    ? []
    : screened.rows.map((row) => ({
        candidateId: row.candidateId,
        line: screenLine({ score: row.score, reason: row.reason }) ?? t("briefs.triage.close"),
        onReadAnyway: canReadAnyway
          ? () => analysis.readAnyway(row.candidateId).then(() => {})
          : undefined,
      }));
  const nearCount = near.length + (textOnly ? 0 : screened.total);

  function openRow(list: ListName, index: number) {
    const result = listOf(list)[index];
    if (result) setDrawer({ list, candidateId: result.candidateId });
  }

  return (
    <div className="space-y-6">
      <AnalysisBand
        analysis={analysis}
        canEdit={canEdit}
        modelAvailable={modelAvailable}
        briefStale={briefStale}
        onShowSetAside={() => setSetAsideOpen(true)}
      />

      {opening ? (
        <MatchListSkeleton />
      ) : view && rowsShown && main.length ? (
        <MatchList
          listKey={`${view.id}:main`}
          results={main}
          lineOf={textOnly ? tally : synthesisLine}
          candidateOf={analysis.candidateOf}
          addedIds={analysis.addedIds}
          canAdd={canAdd}
          provisional={provisional}
          onOpen={(index) => openRow("main", index)}
          onAdd={analysis.add}
        />
      ) : null}

      {!opening && view && rowsShown && nearCount > 0 ? (
        // The toggle sits under the matches, so the near profiles open right below it, never off screen.
        <div className={main.length ? "-mt-3 space-y-3" : "space-y-3"}>
          <div className="-ml-3">
            <QuietButton
              id={nearToggleId}
              label={
                nearCount === 1
                  ? t("briefs.analysis.near.one")
                  : t("briefs.analysis.near.many", { count: formatCount(locale, nearCount) })
              }
              expanded={nearOpen}
              controls={nearId}
              onClick={() => setNearOpen((value) => !value)}
            />
          </div>
          {nearOpen ? (
            // Named by its toggle, which already says what the list holds and how many.
            <section id={nearId} aria-labelledby={nearToggleId} className="space-y-3">
              {near.length ? (
                <MatchList
                  listKey={`${view.id}:near`}
                  results={near}
                  lineOf={reservationLine}
                  candidateOf={analysis.candidateOf}
                  addedIds={analysis.addedIds}
                  canAdd={canAdd}
                  muted
                  onOpen={(index) => openRow("near", index)}
                  onAdd={analysis.add}
                />
              ) : null}
              {screenedRows.length ? (
                <div className="sheet px-2 py-1">
                  <AsideRows rows={screenedRows} candidateOf={analysis.candidateOf} muted />
                </div>
              ) : null}
              {screened.failed ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0">{t("briefs.listError")}</span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<RefreshCw />}
                    onClick={() => void screened.retry()}
                    disabled={screened.loading}
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              ) : screened.hasMore ? (
                <MoreButton busy={screened.loading} onClick={() => void screened.more()} />
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <MatchDrawer
        list={drawerList}
        index={drawerIndex >= 0 ? drawerIndex : null}
        onIndexChange={(index) => {
          const result = drawerList[index];
          if (drawer && result) setDrawer({ list: drawer.list, candidateId: result.candidateId });
        }}
        onClose={() => setDrawer(null)}
        criteria={view?.criteria ?? []}
        candidateOf={analysis.candidateOf}
        orgId={orgId}
        added={(candidateId) => analysis.addedIds.has(candidateId)}
        canAdd={canAdd}
        onAdd={analysis.add}
        onShowShortlist={() => {
          setDrawer(null);
          onShowShortlist();
        }}
      />

      {view ? (
        // Keyed by the analysis: another one starts a fresh drawer, its pages read from the first.
        <Fragment key={view.id}>
          <SetAsideDrawer
            open={setAsideOpen}
            onOpenChange={setSetAsideOpen}
            orgId={orgId}
            searchId={view.id}
            total={analysis.funnel.setAside}
            triageCount={
              wholePool ? (analysis.triage?.no ?? 0) + (analysis.triage?.unknown ?? 0) : 0
            }
            read={analysis.setAside}
            criteria={view.criteria}
            canReadAnyway={canReadAnyway}
            onReadAnyway={analysis.readAnyway}
          />
        </Fragment>
      ) : null}
    </div>
  );
}
