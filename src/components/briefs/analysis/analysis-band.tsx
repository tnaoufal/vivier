/**
 * The band at the top of the "Correspondances" tab: one sheet that says
 * where the analysis stands, in the state it is in. Idle, the headline
 * counts the matches ("12 profils correspondent"); one line of figures
 * under it says how the pool narrowed (the profiles analysed, the ones
 * the triage kept, the ones read in depth while some are left to read)
 * and when, the method behind an info icon; the pills on the right split
 * the matches by tier; the earlier analyses sit behind a quiet button.
 * Running, it shows the four steps, the bar of the current one with how
 * far it is and the time left when known, one live sentence and the way
 * to stop. Waiting for the team's check, one line and the way to the
 * role (the header's "Lancer la recherche" then starts the analysis). An
 * interrupted analysis says how many profiles are left, with "Reprendre",
 * or that another session drives it; one stored before the whole pool
 * was read says how many it read, the reason behind an info icon; one no
 * model could read says how many profiles it ranked out of the pool and
 * how many are shown. With no match once everything ran, the requirement
 * most often missing and the way back to the role; an empty pool says
 * so, with the way to import CVs.
 */
import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Briefcase, Play, Sparkles, Square, TriangleAlert, Upload, Users } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { kindKey } from "@/lib/briefs/criteria";
import { BAND_STEPS, remainingMs, stepOf, tierCounts } from "@/lib/briefs/presentation";
import { formatCount } from "@/lib/candidates/format";
import type { AssessmentTier } from "@/lib/db/types";
import { formatDateTime, useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { AnalysisStepper } from "./analysis-stepper";
import { PreviousAnalysesMenu } from "./previous-analyses-menu";
import type { AnalysisController } from "./use-analysis";

const TIERS: readonly AssessmentTier[] = ["A", "B", "C"];
const TIER_TONES: Record<AssessmentTier, PillTone> = {
  A: "positive",
  B: "caution",
  C: "neutral",
};

export function AnalysisBand({
  analysis,
  canEdit,
  modelAvailable,
  onCheckRole,
}: {
  analysis: AnalysisController;
  canEdit: boolean;
  modelAvailable: boolean | null;
  /** Shows the "Le poste" tab, where the team checks what the model wrote. */
  onCheckRole: () => void;
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
    const status = measured
      ? t("briefs.analysis.progress", {
          done: count(measured.done),
          total: count(measured.total),
        })
      : t(
          progress && step === "promote" ? "briefs.analysis.promoting" : "briefs.analysis.starting",
        );
    // While the search itself runs there is nothing to count yet.
    const live = !progress
      ? null
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
        <AnalysisStepper step={step} />
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-ink tabular-nums">{status}</p>
            {eta ? <p className="text-meta text-muted-foreground">{eta}</p> : null}
          </div>
          <ProgressBar
            value={measured ? measured.done : null}
            max={measured ? measured.total : 100}
            size="md"
            active
            label={`${stepName} · ${status}`}
          />
        </div>
        {live !== null ? (
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
              className="self-start sm:self-auto"
            >
              {t("briefs.analysis.stop")}
            </Button>
          </div>
        ) : null}
      </>,
      live !== null,
    );
  }

  if (band === "empty" || !view) {
    if (analysis.openFailed) {
      const failed = analysis.openFailed;
      return (
        <EmptyState
          compact
          title={t("briefs.analysis.loadFailed")}
          action={
            <Button type="button" variant="outline" onClick={() => analysis.open(failed)}>
              {t("common.retry")}
            </Button>
          }
        />
      );
    }
    return <EmptyState compact icon={<Sparkles />} title={t("briefs.analysis.empty")} />;
  }

  // One way forward: the role, checked on its tab. The header's "Lancer
  // la recherche" then starts this search, or a new one on what the team changed.
  if (band === "needsCheck") {
    return shell(
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={headingId} className="min-w-0 text-body text-ink">
          {t("briefs.analysis.check")}
        </h2>
        <Button
          type="button"
          variant="outline"
          icon={<Briefcase />}
          onClick={onCheckRole}
          className="shrink-0 self-start sm:self-auto"
        >
          {t("briefs.analysis.check.open")}
        </Button>
      </div>,
    );
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
  const tiers = tierCounts(view.results);
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
              // Nothing matches yet is not "nothing matches" while profiles are still to read.
              none:
                band === "incomplete"
                  ? "briefs.analysis.matches.noneYet"
                  : "briefs.search.line.present.none",
              one: "briefs.analysis.matches.one",
              many: "briefs.analysis.matches.many",
            })}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
            {[...figures, { key: "date", text: date }].map((figure, index) => (
              <span key={figure.key} className="inline-flex items-center gap-x-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{figure.text}</span>
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
        {matches > 0 && (tiers.A || tiers.B || tiers.C) ? (
          <ul
            aria-label={t("briefs.analysis.tiers")}
            className="flex shrink-0 flex-wrap items-center gap-1.5"
          >
            {TIERS.map((tier) =>
              tiers[tier] ? (
                <li key={tier}>
                  <Pill tone={TIER_TONES[tier]} dot>
                    <span aria-hidden="true">{`${tier} · ${count(tiers[tier])}`}</span>
                    <span className="sr-only">
                      {t("briefs.analysis.tierCount", {
                        label: t(`briefs.tier.${tier}`),
                        count: count(tiers[tier]),
                      })}
                    </span>
                  </Pill>
                </li>
              ) : null,
            )}
          </ul>
        ) : null}
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

      {legacy ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-ink">
          <TriangleAlert
            aria-hidden="true"
            className="size-4 shrink-0 text-caution-foreground dark:text-caution"
          />
          <span className="min-w-0">
            {view.poolSize === null
              ? t("briefs.analysis.legacy.unknownPool", { read: count(view.results.length) })
              : t("briefs.analysis.legacy", {
                  read: count(view.results.length),
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
