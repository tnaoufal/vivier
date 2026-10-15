/**
 * The band at the top of the "Correspondances" tab: one sheet that says
 * where the analysis stands, in the state it is in. Idle, the headline
 * counts the matches ("12 profils correspondent"); one line of figures
 * under it says how the pool narrowed (the profiles analysed, the ones
 * the triage kept, the ones read in depth while some are left to read,
 * the ones set aside: a quiet button that opens their list, each with
 * its reason) and when, the method behind an info icon; the earlier
 * analyses sit behind a quiet button. Once done, the profiles the pool
 * gained since are counted, with the way to analyse them.
 * Running, the live figure comes first with the way to stop (a heading
 * from the first moment, while the search is prepared), then the bar of
 * the current step with how far it is and the time left when known. An
 * interrupted analysis says how many profiles are left, with "Reprendre",
 * or that another session drives it; one stored before the whole pool
 * was read says how many it read in full, the reason behind an info
 * icon; one no model could read says how many profiles it ranked out of
 * the pool and how many are shown. With no match once everything ran,
 * the requirement most often missing and the way back to the role; an
 * empty pool says so, with the way to import CVs. A list of analyses
 * that could not be read says so, with the way to read it again.
 */
import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Briefcase,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { kindKey } from "@/lib/briefs/criteria";
import { BAND_STEPS, remainingMs, stepOf } from "@/lib/briefs/presentation";
import { formatCount } from "@/lib/candidates/format";
import { formatDateTime, useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { PreviousAnalysesMenu } from "./previous-analyses-menu";
import type { AnalysisController } from "./use-analysis";

export function AnalysisBand({
  analysis,
  canEdit,
  modelAvailable,
  onCheckRole,
  onShowSetAside,
}: {
  analysis: AnalysisController;
  canEdit: boolean;
  modelAvailable: boolean | null;
  /** Shows the "Le poste" tab: the way back to the job when nothing matches. */
  onCheckRole: () => void;
  /** Opens the list of the profiles set aside, the figure's count as its title. */
  onShowSetAside: () => void;
}) {
  const { t, locale } = useI18n();
  const headingId = useId();
  const { view, progress, band, funnel } = analysis;
  const count = (value: number) => formatCount(locale, value);

  function plural(
    value: number,
    keys: { none: TranslationKey; one: TranslationKey; many: TranslationKey },
  ): string {
    if (value === 0) return t(keys.none);
    if (value === 1) return t(keys.one);
    return t(keys.many, { count: count(value) });
  }

  const shell = (children: ReactNode, labelled = true) => (
    <section aria-labelledby={labelled ? headingId : undefined} className="sheet space-y-5 p-6">
      {children}
    </section>
  );

  // The list or the analysis is being read: placeholders the size of the headline.
  const loading =
    band !== "running" &&
    (analysis.opening ||
      (view !== null && analysis.detailsLoading) ||
      (view === null && analysis.searchesLoading));
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
    const step = progress?.step ?? "triage";
    // The size of the work is unknown while the search runs and during the promotion: the bar is indeterminate.
    const measured = progress && step !== "promote" && progress.total > 0 ? progress : null;
    const left = measured ? remainingMs({ ...measured, now: Date.now() }) : null;
    const eta =
      left === null || left === 0
        ? null
        : left < 60_000
          ? t("briefs.analysis.eta.soon")
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
    // The live figure first: while the search itself runs there is nothing to count yet, and the heading says what runs.
    const live = !progress
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
    return shell(
      <>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2
            id={headingId}
            className="font-display text-xl text-ink tabular-nums"
            aria-live="polite"
          >
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
      </>,
    );
  }

  if (band === "empty" || !view) {
    if (analysis.openFailed) {
      const failed = analysis.openFailed;
      return (
        <EmptyState
          compact
          icon={<TriangleAlert />}
          title={t("briefs.analysis.loadFailed")}
          action={
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw />}
              onClick={() => analysis.open(failed)}
            >
              {t("common.retry")}
            </Button>
          }
        />
      );
    }
    // The list could not be read: nothing is known of the analyses, which is not "none".
    if (analysis.searchesError) {
      return (
        <EmptyState
          compact
          icon={<TriangleAlert />}
          title={t("briefs.analysis.loadFailed")}
          action={
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw />}
              onClick={analysis.retrySearches}
            >
              {t("common.retry")}
            </Button>
          }
        />
      );
    }
    return <EmptyState compact icon={<Sparkles />} title={t("briefs.analysis.empty")} />;
  }

  const date = formatDateTime(locale, view.createdAt);
  const searches = analysis.searches ?? [];
  const previous = (
    <PreviousAnalysesMenu
      searches={searches}
      currentId={view.id}
      disabled={analysis.opening}
      onOpen={analysis.open}
    />
  );

  if (band === "textOnly") {
    const noModel = modelAvailable === false;
    // Past FULL_POOL_MAX the text path ranks only the profiles the retrieval
    // returns: the headline says out of how many, so the others are never hidden.
    const pool = view.poolSize;
    const partial = pool !== null && view.results.length < pool;
    // The list shows the head of the ranking: the line says so when it is not all of it.
    const shown = analysis.ranking.length;
    return shell(
      <>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-2xl text-ink tabular-nums sm:text-3xl">
            {partial && pool !== null
              ? t("briefs.analysis.ranked.partial", {
                  read: count(view.results.length),
                  total: count(pool),
                })
              : plural(view.results.length, {
                  none: "briefs.analysis.ranked.none",
                  one: "briefs.analysis.ranked.one",
                  many: "briefs.analysis.ranked.many",
                })}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>
              {t(
                noModel
                  ? "briefs.analysis.textOnly.noModel"
                  : "briefs.analysis.textOnly.noCriteria",
              )}
            </span>
            <InfoTip
              label={t(
                noModel
                  ? "briefs.analysis.textOnly.noModel"
                  : "briefs.analysis.textOnly.noCriteria",
              )}
            >
              {t(
                noModel
                  ? "briefs.analysis.textOnly.noModel.tip"
                  : "briefs.analysis.textOnly.noCriteria.tip",
              )}
            </InfoTip>
            {shown < view.results.length ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {t("briefs.analysis.ranked.top", { count: count(shown) })}
                </span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>{date}</span>
          </p>
        </div>
        {searches.length > 1 ? <div className="-mb-2 -ml-3 flex flex-wrap">{previous}</div> : null}
      </>,
    );
  }

  const wholePool = view.method === "triage";
  // A pool with no active profile when the search ran: nothing was analysed, so nothing "does not match".
  if (band === "done" && wholePool && funnel.analysed === 0) {
    return (
      <EmptyState
        compact
        icon={<Users />}
        title={t("briefs.analysis.emptyPool")}
        action={
          canEdit || searches.length > 1 ? (
            <>
              {canEdit ? (
                <Button asChild variant="outline" icon={<Upload />}>
                  <Link to="/app/candidates">{t("candidates.import")}</Link>
                </Button>
              ) : null}
              {previous}
            </>
          ) : undefined
        }
      />
    );
  }

  const matches = analysis.matches.length;
  const zero = band === "done" && matches === 0;
  const legacy = band === "legacy";
  const missing = analysis.mostMissing;
  // How the pool narrowed, each figure once: the profiles analysed, the
  // ones the triage kept (a whole-pool analysis), the ones read in depth
  // while some kept are still to read (then the figure differs).
  const figures: { key: string; text: string }[] = legacy
    ? []
    : [
        {
          key: "analysed",
          text: plural(funnel.analysed, {
            none: "briefs.analysis.analysed.none",
            one: "briefs.analysis.analysed.one",
            many: "briefs.analysis.analysed.many",
          }),
        },
        ...(wholePool
          ? [
              {
                key: "kept",
                text: plural(funnel.kept, {
                  none: "briefs.analysis.kept.none",
                  one: "briefs.analysis.kept.one",
                  many: "briefs.analysis.kept.many",
                }),
              },
            ]
          : []),
        ...(funnel.assessed < funnel.kept
          ? [
              {
                key: "assessed",
                text: plural(funnel.assessed, {
                  none: "briefs.analysis.assessed.none",
                  one: "briefs.analysis.assessed.one",
                  many: "briefs.analysis.assessed.many",
                }),
              },
            ]
          : []),
      ];

  // The profiles set aside are a figure, never rows of the list; the
  // figure opens them on demand, so what the model set aside is never out
  // of a person's reach. The hit area grows to 40px without moving the line.
  const setAside =
    funnel.setAside > 0 ? (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onShowSetAside}
        className="relative cursor-pointer rounded-sm underline decoration-dotted underline-offset-4 transition-colors duration-fast ease-out-soft before:absolute before:-inset-x-1 before:-inset-y-2.5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {funnel.setAside === 1
          ? t("briefs.analysis.setAside.one")
          : t("briefs.analysis.setAside.many", { count: count(funnel.setAside) })}
      </button>
    ) : null;
  const line: { key: string; node: ReactNode }[] = [
    ...figures.map((figure) => ({ key: figure.key, node: figure.text })),
    ...(setAside ? [{ key: "setAside", node: setAside }] : []),
    { key: "date", node: date },
  ];

  return shell(
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id={headingId}
            className={cn(
              "font-display text-ink tabular-nums",
              zero ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl",
            )}
          >
            {plural(matches, {
              // Nothing matches yet is not "nothing matches" while profiles are still to read (an earlier analysis stopped before its reads ended included).
              none:
                band === "incomplete" || (legacy && analysis.remaining > 0)
                  ? "briefs.analysis.matches.noneYet"
                  : "briefs.search.line.present.none",
              one: "briefs.analysis.matches.one",
              many: "briefs.analysis.matches.many",
            })}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
            {line.map((item, index) => (
              <span key={item.key} className="inline-flex items-center gap-x-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                {typeof item.node === "string" ? <span>{item.node}</span> : item.node}
              </span>
            ))}
            {wholePool && !legacy ? (
              <InfoTip label={t("briefs.analysis.method.topic")}>
                {t("briefs.analysis.method.tip")}
              </InfoTip>
            ) : null}
            {/* The matches are the model's reading: a person retains them. */}
            {funnel.assessed > 0 ? <Pill size="sm">{t("briefs.results.why")}</Pill> : null}
          </div>
        </div>
      </div>

      {band === "incomplete" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
            {analysis.elsewhere ? null : (
              <TriangleAlert
                aria-hidden="true"
                className="size-4 shrink-0 text-caution-foreground dark:text-caution"
              />
            )}
            <span className="min-w-0 tabular-nums">
              {plural(analysis.remaining, {
                none: "briefs.analysis.left.none",
                one: "briefs.analysis.left.one",
                many: "briefs.analysis.left.many",
              })}
            </span>
          </p>
          {/* Driven by another tab or a colleague: resuming here would send its profiles twice. */}
          {analysis.elsewhere ? (
            <p className="text-meta text-muted-foreground" role="status">
              {t("briefs.analysis.elsewhere")}
            </p>
          ) : analysis.canResume ? (
            <Button
              type="button"
              variant="outline"
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
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
            <UserPlus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 tabular-nums">
              {analysis.newProfiles === 1
                ? t("briefs.analysis.newProfiles.one")
                : t("briefs.analysis.newProfiles.many", { count: count(analysis.newProfiles) })}
            </span>
          </p>
          {analysis.canAnalyseNew ? (
            <Button
              type="button"
              variant="outline"
              icon={<Sparkles />}
              onClick={analysis.resume}
              className="self-start sm:self-auto"
            >
              {t("briefs.analysis.analyseNew")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {legacy ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-ink">
          <TriangleAlert
            aria-hidden="true"
            className="size-4 shrink-0 text-caution-foreground dark:text-caution"
          />
          {/* What was read in full, not what the retrieval returned. */}
          <span className="min-w-0">
            {view.poolSize === null
              ? t("briefs.analysis.legacy.unknownPool", { read: count(funnel.assessed) })
              : t("briefs.analysis.legacy", {
                  read: count(funnel.assessed),
                  total: count(view.poolSize),
                })}
          </span>
          <InfoTip label={t("briefs.analysis.legacy.topic")}>
            {t("briefs.analysis.legacy.tip")}
          </InfoTip>
        </p>
      ) : null}

      {/* Nothing matches once everything ran: what was most often missing, and the way back to the job. */}
      {zero ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {missing ? (
            <p className="min-w-0 text-sm text-ink">
              {t("briefs.analysis.missing", {
                label:
                  missing.kind === "role"
                    ? `${t(kindKey(missing.kind))} · ${missing.label}`
                    : missing.label,
              })}
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button
            type="button"
            variant="outline"
            icon={<Briefcase />}
            onClick={onCheckRole}
            className="shrink-0 self-start sm:self-auto"
          >
            {t("briefs.analysis.reviewRole")}
          </Button>
        </div>
      ) : null}

      {searches.length > 1 ? <div className="-mb-2 -ml-3 flex flex-wrap">{previous}</div> : null}
    </>,
  );
}
