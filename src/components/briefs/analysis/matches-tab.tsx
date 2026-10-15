/**
 * The "Correspondances" tab of a brief, top to bottom and nothing else:
 * the analysis band; the matches alone, as 64px rows in tier then rank
 * order (or, for an analysis no model could read, the head of the
 * ranking on the text, 20 rows at most); right under them the quiet
 * toggle of the near profiles and, when it is open, their rows, muted,
 * so the list opens where its control is; and the drawer of the row
 * opened, which walks the list it was opened from and follows its
 * person when a batch reorders the list. While the analysis is not
 * through, a match the second opinion has not seen is marked as such.
 * A profile set aside by the analysis is a figure of the band, never a
 * row here: the figure opens their own drawer, where each one is listed
 * with its reason, and one the triage set aside can be brought back to
 * be read in full.
 */
import { Fragment, useEffect, useId, useState } from "react";

import { requirementTally, reservationLine, synthesisLine } from "@/lib/briefs/presentation";
import { formatCount } from "@/lib/candidates/format";
import type { MatchResult } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { AnalysisBand } from "./analysis-band";
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
  // The drawer follows a person, not a place: a batch that reorders the list keeps it on them.
  const [drawer, setDrawer] = useState<{ list: ListName; candidateId: string } | null>(null);
  const { view, band } = analysis;
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
  // While a new search is prepared the previous analysis's rows step aside: the band says what runs.
  const rowsShown = view !== null && !analysis.starting;
  const canAdd = canEdit;

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
          provisional={band === "running" || band === "incomplete"}
          onOpen={(index) => openRow("main", index)}
          onAdd={analysis.add}
        />
      ) : null}

      {!opening && view && rowsShown && near.length ? (
        // The toggle sits under the matches, so the near profiles open right below it, never off screen.
        <div className="-mt-3 space-y-3">
          <div className="-ml-3">
            <QuietButton
              id={nearToggleId}
              label={
                near.length === 1
                  ? t("briefs.analysis.near.one")
                  : t("briefs.analysis.near.many", { count: formatCount(locale, near.length) })
              }
              expanded={nearOpen}
              controls={nearId}
              onClick={() => setNearOpen((value) => !value)}
            />
          </div>
          {nearOpen ? (
            // Named by its toggle, which already says what the list holds and how many.
            <section id={nearId} aria-labelledby={nearToggleId}>
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
            triageCount={view.method === "triage" ? (analysis.triage?.no ?? 0) : 0}
            read={analysis.setAside}
            criteria={view.criteria}
            canReadAnyway={canEdit && view.method === "triage" && modelAvailable !== false}
            onReadAnyway={analysis.readAnyway}
          />
        </Fragment>
      ) : null}
    </div>
  );
}
