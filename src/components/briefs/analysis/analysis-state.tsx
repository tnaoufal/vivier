/**
 * Where the analysis stands, in one block of the list pane, read off
 * the row the processor writes and nothing else, one status region in
 * every state so its first words are announced like the next. Done:
 * the matches as the figure ("12 correspondances"), then the profiles
 * analysed and how long the run took in one meta line, "Brief modifié
 * · relancez" when the text changed since. Running: the stage's
 * figure ("412 / 1 093 analysés"), the bar of the whole run, the
 * stage's word, "Interrompre" for a member. Queued: "En attente" over
 * an indeterminate bar. Stopped: "Interrompue · 412 / 1 093" and
 * "Reprendre" (the same row is queued again and resumes where it was).
 * Failed: "Échec" and the one line the row says, "Réessayer". Nothing
 * yet: "Aucune analyse" (the header's button is the one action). An
 * analysis no model read says "Texte seul, sans modèle" once, as a
 * pill. An empty pool says so with the import; an analysis that could
 * not be opened says so with the way to read it again. Figures first:
 * no sentence, no funnel, no tier counts.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { progressOf, unreadOf } from "@vivier/analysis";
import { Play, RefreshCw, Square, Upload } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { kindKey } from "@/lib/briefs/criteria";
import {
  failureLineOf,
  PROFILE_STAGES,
  stageKey,
  type FailureLine,
} from "@/lib/briefs/presentation";
import { formatCount } from "@/lib/candidates/format";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { durationParts, runDurationMs } from "@/lib/shortlists/groups";

import type { AnalysisController } from "./use-analysis";

/** The one line a failed run says. */
const FAILURE_KEYS: Record<FailureLine, TranslationKey> = {
  brief: "briefs.analysis.jobChanged",
  model: "briefs.analysis.failed.model",
  other: "briefs.analysis.failed.other",
};

export function AnalysisState({
  analysis,
  canEdit,
  modelAvailable,
  briefStale,
}: {
  analysis: AnalysisController;
  canEdit: boolean;
  modelAvailable: boolean | null;
  /** True when the brief's text changed since the analysis on screen ran. */
  briefStale: boolean;
}) {
  const { t, locale } = useI18n();
  const { latest, view, band, funnel } = analysis;
  const count = (value: number) => formatCount(locale, value);

  const working = band === "queued" || band === "running";
  // The newest analysis is being looked up or opened: placeholders the size of the figure.
  const loading =
    !working &&
    (analysis.opening ||
      (view !== null && analysis.detailsLoading) ||
      (view === null && analysis.latestLoading));

  const shell = (children: ReactNode) => (
    <div role="status" className="space-y-2 px-4 py-3">
      {children}
    </div>
  );
  /** The one filled button of the block: Reprendre or Réessayer, when the person may. */
  const resume = (label: string, icon: ReactNode) =>
    analysis.canResume ? (
      <Button
        type="button"
        variant="primary"
        size="sm"
        icon={icon}
        onClick={() => void analysis.run()}
        className="shrink-0"
      >
        {label}
      </Button>
    ) : null;
  // The brief's text changed since this analysis ran (or started): the header's button reads it again.
  const stale = briefStale ? <p className="text-meta text-ink">{t("briefs.brief.stale")}</p> : null;

  if (loading) {
    return shell(
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-8 w-40 max-w-full" />
        <Skeleton className="h-3.5 w-48 max-w-full" />
      </div>,
    );
  }

  if (working) {
    const stage = band === "running" ? (latest?.stage ?? null) : null;
    const done = latest?.progress_done ?? 0;
    const total = latest?.progress_total ?? 0;
    // The whole run's progress from the span each stage owns; indeterminate until the processor names a stage.
    const percent = stage ? progressOf(stage, done, total) : null;
    const word = stage ? t(stageKey(stage)) : t("briefs.analysis.queued");
    const figure =
      stage && total > 0
        ? PROFILE_STAGES.includes(stage)
          ? t("briefs.state.progress", { done: count(done), total: count(total) })
          : `${count(done)} / ${count(total)}`
        : word;
    return shell(
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-ink tabular-nums">{figure}</p>
          {canEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Square />}
              onClick={() => void analysis.stop()}
              disabled={!analysis.canStop}
              aria-busy={analysis.stopping || undefined}
              className="shrink-0 text-muted-foreground hover:text-ink"
            >
              {t("briefs.analysis.stop")}
            </Button>
          ) : null}
        </div>
        <ProgressBar
          value={percent}
          max={100}
          active
          label={figure === word ? word : `${word} · ${figure}`}
        />
        {figure !== word ? <p className="text-meta text-muted-foreground">{word}</p> : null}
        {stale}
      </>,
    );
  }

  if (band === "empty" || !view) {
    // The newest analysis could not be read or opened: nothing is known of it, which is not "none".
    if (analysis.loadFailed) {
      return shell(
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold text-ink">
            {t("briefs.analysis.loadFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<RefreshCw />}
            onClick={analysis.retry}
            className="shrink-0"
          >
            {t("common.retry")}
          </Button>
        </div>,
      );
    }
    return shell(<p className="text-sm font-semibold text-ink">{t("briefs.analysis.empty")}</p>);
  }

  const wholePool = view.method === "triage";
  const analysed = wholePool ? funnel.analysed : view.results.length;
  const duration = runDurationMs(latest?.started_at, latest?.finished_at);
  const took = duration === null ? null : durationText(duration, t);

  if (band === "stopped") {
    const done = latest?.progress_done ?? 0;
    const total = latest?.progress_total ?? 0;
    const stage = latest?.stage ?? null;
    return shell(
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-ink tabular-nums">
            {t("briefs.state.stopped")}
            {total > 0 ? ` · ${count(done)} / ${count(total)}` : ""}
          </p>
          {resume(t("briefs.analysis.resume"), <Play />)}
        </div>
        {stage ? <p className="text-meta text-muted-foreground">{t(stageKey(stage))}</p> : null}
        {stale}
      </>,
    );
  }

  if (band === "failed") {
    const failure = failureLineOf(latest?.error);
    return shell(
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold text-ink">
            {t("briefs.state.failed")}
            <span className="font-normal text-muted-foreground"> · {t(FAILURE_KEYS[failure])}</span>
          </p>
          {resume(t("common.retry"), <RefreshCw />)}
        </div>
        {/* The failure line already says the brief changed: the notice would say it twice. */}
        {failure === "brief" ? null : stale}
      </>,
    );
  }

  if (band === "textOnly") {
    const shown = analysis.ranking.length;
    return shell(
      <>
        <p className="text-ink">
          <span className="stat-number">{count(shown)}</span>{" "}
          <span className="text-sm font-medium">
            {t(shown === 1 ? "briefs.state.ranked.one" : "briefs.state.ranked.many")}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground tabular-nums">
          {/* Past FULL_POOL_MAX the text path ranks only the profiles the retrieval returns: out of how many is said. */}
          <span>
            {view.poolSize !== null && view.results.length < view.poolSize
              ? t("briefs.state.rankedOf", {
                  read: count(view.results.length),
                  total: count(view.poolSize),
                })
              : analysedText(analysed, t, count)}
          </span>
          {/* Said once, as a pill: no model read these profiles. */}
          <Pill size="sm">
            {t(
              modelAvailable === false
                ? "briefs.analysis.textOnly.noModel"
                : "briefs.analysis.textOnly.noCriteria",
            )}
          </Pill>
        </div>
        {stale}
      </>,
    );
  }

  // A pool with no active profile when the search ran: nothing was analysed, so nothing "does not match".
  if (band === "done" && wholePool && funnel.analysed === 0) {
    return shell(
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-ink">{t("briefs.analysis.emptyPool")}</p>
        {canEdit ? (
          <Button asChild variant="outline" size="sm" icon={<Upload />} className="shrink-0">
            {/* Straight into the import dialog: the pool's page alone would cost a second click. */}
            <Link to="/app/candidates" search={{ import: true }}>
              {t("briefs.analysis.importCvs")}
            </Link>
          </Button>
        ) : null}
      </div>,
    );
  }

  const matches = analysis.matches.length;
  // A done run whose full readings failed for some profiles: they are unassessed until it is queued again.
  const unread = band === "done" ? unreadOf(latest?.error) : 0;
  const missing = band === "done" && matches === 0 ? analysis.mostMissing : null;
  const meta: string[] = [];
  if (band === "legacy") {
    // What was read in full, not what the retrieval returned.
    meta.push(
      view.poolSize === null
        ? funnel.assessed === 1
          ? t("briefs.analysis.legacy.unknownPool.one")
          : t("briefs.analysis.legacy.unknownPool", { read: count(funnel.assessed) })
        : funnel.assessed === 1
          ? t("briefs.analysis.legacy.one", { total: count(view.poolSize) })
          : t("briefs.analysis.legacy", {
              read: count(funnel.assessed),
              total: count(view.poolSize),
            }),
    );
  } else {
    meta.push(analysedText(analysed, t, count));
  }
  if (took) meta.push(took);

  return shell(
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-ink">
          <span className="stat-number">{count(matches)}</span>{" "}
          <span className="text-sm font-medium">
            {t(matches === 1 ? "briefs.state.matches.one" : "briefs.state.matches.many")}
          </span>
        </p>
        {unread > 0 ? resume(t("briefs.analysis.resume"), <Play />) : null}
      </div>
      <p className="text-meta text-muted-foreground tabular-nums">{meta.join(" · ")}</p>
      {unread > 0 ? (
        <p className="text-meta text-ink tabular-nums">
          {unread === 1
            ? t("briefs.analysis.unread.one")
            : t("briefs.analysis.unread.many", { count: count(unread) })}
        </p>
      ) : null}
      {stale}
      {/* Nothing matches once everything ran: what was most often missing, so the brief can be loosened. */}
      {missing ? (
        <p className="text-meta text-muted-foreground">
          {t("briefs.analysis.missing", {
            label:
              missing.kind === "role"
                ? `${t(kindKey(missing.kind))} · ${missing.label}`
                : missing.label,
          })}
        </p>
      ) : null}
    </>,
  );
}

/** "1 093 analysés", with its singular and its zero. */
function analysedText(
  analysed: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  count: (value: number) => string,
): string {
  if (analysed === 0) return t("briefs.analysis.analysed.none");
  if (analysed === 1) return t("briefs.analysis.analysed.one");
  return t("briefs.analysis.analysed.many", { count: count(analysed) });
}

/** "4 min", "42 s", "1 h 05": how long the run took. */
function durationText(
  ms: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const parts = durationParts(ms);
  if (parts.unit === "seconds") return t("briefs.state.duration.seconds", { count: parts.count });
  if (parts.unit === "minutes") return t("briefs.state.duration.minutes", { count: parts.count });
  return t("briefs.state.duration.hours", {
    hours: parts.count,
    minutes: String(parts.minutes).padStart(2, "0"),
  });
}
