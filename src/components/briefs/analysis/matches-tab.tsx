/**
 * The "Correspondances" tab of a brief, top to bottom and nothing else:
 * the analysis band; the matches alone, as compact rows in tier then
 * rank order (or, for an analysis no model could read, the ranking on
 * the text, 20 rows at most); the near profiles under their own small
 * heading when the band's toggle shows them; and the drawer of the row
 * opened, which walks the list it was opened from and follows its
 * person when a batch reorders the list. A profile set aside by the
 * analysis is only counted in the funnel.
 */
import { useEffect, useId, useState } from "react";

import { requirementTally, reservationLine, synthesisLine } from "@/lib/briefs/presentation";
import type { MatchResult } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

import { AnalysisBand } from "./analysis-band";
import { MatchDrawer } from "./match-drawer";
import { MatchList, MatchListSkeleton } from "./match-list";
import type { AnalysisController } from "./use-analysis";

type ListName = "main" | "near";

export function MatchesTab({
  analysis,
  orgId,
  canEdit,
  modelAvailable,
  onCheckRole,
}: {
  analysis: AnalysisController;
  orgId: string;
  canEdit: boolean;
  modelAvailable: boolean | null;
  onCheckRole: () => void;
}) {
  const t = useT();
  const nearId = useId();
  const nearHeadingId = useId();
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [nearOpen, setNearOpen] = useState(false);
  // The drawer follows a person, not a place: a batch that reorders the list keeps it on them.
  const [drawer, setDrawer] = useState<{ list: ListName; candidateId: string } | null>(null);
  const { view, band } = analysis;
  const viewId = view?.id ?? null;

  // Another analysis on screen starts closed.
  useEffect(() => {
    setFunnelOpen(false);
    setNearOpen(false);
    setDrawer(null);
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
    return total > 0 ? t("briefs.match.tally", { met, total }) : null;
  };
  const opening = analysis.opening || (view === null && analysis.searchesLoading);
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
        funnelOpen={funnelOpen}
        onFunnelToggle={() => setFunnelOpen((value) => !value)}
        nearOpen={nearOpen && near.length > 0}
        nearId={nearId}
        onNearToggle={() => setNearOpen((value) => !value)}
        onCheckRole={onCheckRole}
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
          showScore={!textOnly}
          onOpen={(index) => openRow("main", index)}
          onAdd={analysis.add}
        />
      ) : null}

      {view && rowsShown && nearOpen && near.length ? (
        <section id={nearId} aria-labelledby={nearHeadingId} className="space-y-3">
          <h2 id={nearHeadingId} className="label-caps">
            {t("briefs.near.title")}
          </h2>
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
        shortlistId={analysis.shortlistId}
        canAdd={canAdd}
        onAdd={analysis.add}
      />
    </div>
  );
}
