/**
 * The band at the top of the "Correspondances" tab: one sheet that says
 * where the analysis stands, in the state it is in, and nothing else.
 * Idle, the headline counts the matches ("12 profils correspondent",
 * "Aucun profil ne correspond") and one quiet line of figures under it
 * says how the pool narrowed (the profiles analysed, the ones the triage
 * kept, the ones read in full while some are left, the ones set aside:
 * a quiet button that opens their list, each with its reason) and when.
 * Running, the live figure comes first with the way to stop (a heading
 * from the first moment, while the search is prepared; a status region
 * that exists whatever the state carries it for assistive technologies,
 * so its first words are announced like the next), then the step with
 * how far it is, the time left when known, and the bar. An
 * interrupted analysis says how many profiles are left, with
 * "Reprendre", or that another session drives it; one done counts the
 * profiles the pool gained since, with the way to read them; one stored
 * before the whole pool was read says so in one line; one no model
 * could read says how many profiles it ranked on the text, in one line.
 * A brief edited since the analysis ran says so in one line, while one
 * runs too (the header's button runs it again). With no match once
 * everything ran, the requirement most often missing. An empty pool says
 * so, with the way to import CVs; an analysis that could not be opened
 * says so, with the way to read it again.
 */
import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CircleAlert,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  TriangleAlert,
  Upload,
  Users,
} from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { kindKey } from "@/lib/briefs/criteria";
import {
  BAND_STEPS,
  figuresLine,
  remainingMs,
  stepOf,
  type FigureKey,
} from "@/lib/briefs/presentation";
import { formatCount } from "@/lib/candidates/format";
import { formatDateTime, useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { AnalysisController } from "./use-analysis";

interface PluralKeys {
  /** The sentence for zero; without one, zero reads through `many`. */
  none?: TranslationKey;
  one: TranslationKey;
  many: TranslationKey;
}

/** The words of each figure of the line. */
const FIGURE_KEYS: Record<FigureKey, PluralKeys> = {
  analysed: {
    none: "briefs.analysis.analysed.none",
    one: "briefs.analysis.analysed.one",
    many: "briefs.analysis.analysed.many",
  },
  kept: {
    none: "briefs.analysis.kept.none",
    one: "briefs.analysis.kept.one",
    many: "briefs.analysis.kept.many",
  },
  assessed: {
    none: "briefs.analysis.assessed.none",
    one: "briefs.analysis.assessed.one",
    many: "briefs.analysis.assessed.many",
  },
  setAside: { one: "briefs.analysis.setAside.one", many: "briefs.analysis.setAside.many" },
};

export function AnalysisBand({
  analysis,
  canEdit,
  modelAvailable,
  briefStale,
  onShowSetAside,
}: {
  analysis: AnalysisController;
  canEdit: boolean;
  modelAvailable: boolean | null;
  /** True when the brief's text changed since the analysis on screen ran. */
  briefStale: boolean;
  /** Opens the list of the profiles set aside, the figure's count as its title. */
  onShowSetAside: () => void;
}) {
  const { t, locale } = useI18n();
  const headingId = useId();
  const { view, progress, band, funnel } = analysis;
  const count = (value: number) => formatCount(locale, value);

  function plural(value: number, keys: PluralKeys): string {
    if (value === 0 && keys.none) return t(keys.none);
    if (value === 1) return t(keys.one);
    return t(keys.many, { count: count(value) });
  }

  // The live figure while the analysis runs: nothing to count yet while
  // the search itself is prepared (the sentence says what runs), the
  // profiles kept during the triage, then the matches; empty otherwise.
  const step = progress?.step ?? "triage";
  const live =
    band !== "running"
      ? ""
      : !progress
        ? t("briefs.analysis.starting")
        : step === "triage" || step === "promote"
          ? plural(step === "triage" ? progress.kept : funnel.kept, {
              none: "briefs.analysis.live.kept.none",
              one: "briefs.analysis.live.kept.one",
              many: "briefs.analysis.live.kept.many",
            })
          : plural(analysis.matches.length, {
              none: "briefs.analysis.live.matches.none",
              one: "briefs.analysis.live.matches.one",
              many: "briefs.analysis.live.matches.many",
            });
  // The brief's text changed since this analysis ran (or started): the header's button reads it again.
  const stale = briefStale ? (
    <p role="status" className="flex items-center gap-2 text-sm text-ink">
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0">{t("briefs.brief.stale")}</span>
    </p>
  ) : null;

  // The status region exists from the band's first render, whatever the
  // state shows: the first words of the live sentence are announced too,
  // which a region created with its sentence never is.
  const withStatus = (content: ReactNode) => (
    <>
      <p role="status" className="sr-only">
        {live}
      </p>
      {content}
    </>
  );
  const shell = (children: ReactNode, labelled = true) =>
    withStatus(
      <section aria-labelledby={labelled ? headingId : undefined} className="sheet space-y-5 p-6">
        {children}
      </section>,
    );

  // The newest analysis is being looked up or opened: placeholders the size of the headline.
  const loading =
    band !== "running" &&
    (analysis.opening ||
      (view !== null && analysis.detailsLoading) ||
      (view === null && analysis.latestLoading));
  if (loading) {
    return shell(
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>,
      false,
    );
  }

  if (band === "running") {
    // The size of the work is unknown while the search runs and during the promotion: the bar is indeterminate.
    const measured = progress && step !== "promote" && progress.total > 0 ? progress : null;
    const left = measured ? remainingMs({ ...measured, now: Date.now() }) : null;
    const eta =
      left === null || left === 0
        ? null
        : left < 60_000
          ? t("briefs.analysis.eta.soon")
          : Math.ceil(left / 60_000) === 1
            ? t("briefs.analysis.eta.minutes.one")
            : t("briefs.analysis.eta.minutes", { count: Math.ceil(left / 60_000) });
    const stepName = t(`briefs.analysis.step.${BAND_STEPS[stepOf(step)] ?? "triage"}`);
    // Under the heading: the step and how far it is; nothing while the search itself is prepared (the heading says it).
    const status = !progress
      ? null
      : measured
        ? t("briefs.analysis.progress", {
            step: stepName,
            done: count(measured.done),
            total: count(measured.total),
          })
        : step === "promote"
          ? t("briefs.analysis.promoting")
          : stepName;
    return shell(
      <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id={headingId} className="font-display text-xl text-ink tabular-nums">
            {live}
          </h2>
          <Button
            type="button"
            variant="outline"
            icon={<Square />}
            onClick={analysis.stop}
            disabled={analysis.stopping}
            aria-busy={analysis.stopping || undefined}
            className="self-start sm:self-auto"
          >
            {t("briefs.analysis.stop")}
          </Button>
        </div>
        <div className="space-y-2">
          {status !== null || eta ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-ink tabular-nums">{status}</p>
              {eta ? <p className="text-meta text-muted-foreground">{eta}</p> : null}
            </div>
          ) : null}
          <ProgressBar
            value={measured ? measured.done : null}
            max={measured ? measured.total : 100}
            size="md"
            active
            label={status ?? live}
          />
        </div>
        {stale}
      </>,
    );
  }

  if (band === "empty" || !view) {
    // The newest analysis could not be read or opened: nothing is known of it, which is not "none".
    if (analysis.loadFailed) {
      return withStatus(
        <EmptyState
          compact
          icon={<TriangleAlert />}
          title={t("briefs.analysis.loadFailed")}
          action={
            <Button type="button" variant="outline" icon={<RefreshCw />} onClick={analysis.retry}>
              {t("common.retry")}
            </Button>
          }
        />,
      );
    }
    return withStatus(
      <EmptyState compact icon={<Sparkles />} title={t("briefs.analysis.empty")} />,
    );
  }

  const date = formatDateTime(locale, view.createdAt);

  if (band === "textOnly") {
    const noModel = modelAvailable === false;
    // Past FULL_POOL_MAX the text path ranks only the profiles the retrieval
    // returns: the headline says out of how many, so the others are never hidden.
    const pool = view.poolSize;
    const partial = pool !== null && view.results.length < pool;
    // The list shows the head of the ranking: the line says so when it is not all of it.
    const shown = analysis.ranking.length;
    const line = [
      t(noModel ? "briefs.analysis.textOnly.noModel" : "briefs.analysis.textOnly.noCriteria"),
      ...(shown < view.results.length
        ? [t("briefs.analysis.ranked.top", { count: count(shown) })]
        : []),
      date,
    ];
    return shell(
      <>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-2xl text-ink tabular-nums sm:text-3xl">
            {partial && pool !== null
              ? view.results.length === 1
                ? t("briefs.analysis.ranked.partial.one", { total: count(pool) })
                : t("briefs.analysis.ranked.partial", {
                    read: count(view.results.length),
                    total: count(pool),
                  })
              : plural(view.results.length, {
                  none: "briefs.analysis.ranked.none",
                  one: "briefs.analysis.ranked.one",
                  many: "briefs.analysis.ranked.many",
                })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">{line.join(" · ")}</p>
        </div>
        {stale}
      </>,
    );
  }

  const wholePool = view.method === "triage";
  // A pool with no active profile when the search ran: nothing was analysed, so nothing "does not match".
  if (band === "done" && wholePool && funnel.analysed === 0) {
    return withStatus(
      <EmptyState
        compact
        icon={<Users />}
        title={t("briefs.analysis.emptyPool")}
        action={
          canEdit ? (
            <Button asChild variant="outline" icon={<Upload />}>
              {/* Straight into the import dialog: the pool's page alone would cost a second click. */}
              <Link to="/app/candidates" search={{ import: true }}>
                {t("briefs.analysis.importCvs")}
              </Link>
            </Button>
          ) : undefined
        }
      />,
    );
  }

  const matches = analysis.matches.length;
  const zero = band === "done" && matches === 0;
  const legacy = band === "legacy";
  const missing = analysis.mostMissing;
  const headline = plural(matches, {
    // Nothing matches yet is not "nothing matches" while profiles are still to read (an earlier analysis stopped before its reads ended included).
    none:
      band === "incomplete" || (legacy && analysis.remaining > 0)
        ? "briefs.analysis.matches.noneYet"
        : "briefs.analysis.matches.none",
    one: "briefs.analysis.matches.one",
    many: "briefs.analysis.matches.many",
  });

  // The profiles set aside are a figure, never rows of the list; the
  // figure opens them on demand, so what the model set aside is never out
  // of a person's reach. The hit area grows to 40px without moving the line.
  const figures: { key: string; node: ReactNode }[] = legacy
    ? [
        {
          key: "legacy",
          // What was read in full, not what the retrieval returned.
          node:
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
        },
      ]
    : figuresLine(funnel, wholePool).map((figure) => ({
        key: figure.key,
        node:
          figure.key === "setAside" ? (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={onShowSetAside}
              className="relative cursor-pointer rounded-sm underline decoration-dotted underline-offset-4 transition-colors duration-fast ease-out-soft before:absolute before:-inset-x-1 before:-inset-y-2.5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {plural(figure.count, FIGURE_KEYS[figure.key])}
            </button>
          ) : (
            plural(figure.count, FIGURE_KEYS[figure.key])
          ),
      }));
  const line = [...figures, { key: "date", node: date }];

  return shell(
    <>
      <div className="min-w-0">
        <h2
          id={headingId}
          className={cn(
            "font-display text-ink tabular-nums",
            zero ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl",
          )}
        >
          {headline}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
          {line.map((item, index) => (
            <span key={item.key} className="inline-flex items-center gap-x-2">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              {typeof item.node === "string" ? <span>{item.node}</span> : item.node}
            </span>
          ))}
          {/* The matches are the model's reading: a person retains them. */}
          {funnel.assessed > 0 ? <Pill size="sm">{t("briefs.results.why")}</Pill> : null}
        </div>
      </div>

      {stale}

      {band === "incomplete" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-ink tabular-nums">
            {plural(analysis.remaining, {
              none: "briefs.analysis.left.none",
              one: "briefs.analysis.left.one",
              many: "briefs.analysis.left.many",
            })}
          </p>
          {/* Driven by another tab or a colleague: resuming here would send its profiles twice. */}
          {analysis.elsewhere ? (
            <p className="text-meta text-muted-foreground" role="status">
              {t("briefs.analysis.elsewhere")}
            </p>
          ) : analysis.canResume ? (
            <Button
              type="button"
              variant="primary"
              icon={<Play />}
              onClick={analysis.resume}
              className="self-start sm:self-auto"
            >
              {t("briefs.analysis.resume")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* The pool gained profiles since this analysis ended: none of them was read. */}
      {band === "done" && analysis.newProfiles > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-ink tabular-nums">
            {analysis.newProfiles === 1
              ? t("briefs.analysis.newProfiles.one")
              : t("briefs.analysis.newProfiles.many", { count: count(analysis.newProfiles) })}
          </p>
          {analysis.canAnalyseNew ? (
            <Button
              type="button"
              variant="primary"
              icon={<Sparkles />}
              onClick={analysis.resume}
              className="self-start sm:self-auto"
            >
              {t("briefs.analysis.analyseNew")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Nothing matches once everything ran: what was most often missing, so the brief can be loosened. */}
      {zero && missing ? (
        <p className="min-w-0 text-sm text-muted-foreground">
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
