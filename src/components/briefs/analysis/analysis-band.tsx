/**
 * The band at the top of the "Correspondances" tab: one sheet that says
 * where the analysis stands, in the state it is in. Idle, the headline
 * counts the matches ("12 profils correspondent"), the line under it how
 * many profiles were analysed and when, the pills on the right split
 * the matches by tier; a quiet row of text buttons shows how the
 * profiles were chosen (the funnel), the near profiles, and the earlier
 * analyses. Running, it shows the four steps, the bar of the current
 * one with how far it is and the time left when known, one live
 * sentence and the way to stop. Waiting for the team's check, one
 * sentence and the two ways forward. An interrupted analysis says how
 * many profiles are left, with "Reprendre"; one stored before the whole
 * pool was read says how many it read, the reason behind an info icon;
 * one no model could read says it ranked on the text. With no match
 * once everything ran, the funnel's figures and the requirement most
 * often missing stand in the band.
 */
import { useId, type ReactNode } from "react";
import { Briefcase, ChevronDown, Play, Sparkles, Square, TriangleAlert } from "lucide-react";

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

import { AnalysisFunnel } from "./analysis-funnel";
import { AnalysisStepper } from "./analysis-stepper";
import { PreviousAnalysesMenu } from "./previous-analyses-menu";
import type { AnalysisController } from "./use-analysis";

const TIERS: readonly AssessmentTier[] = ["A", "B", "C"];
const TIER_TONES: Record<AssessmentTier, PillTone> = {
  A: "positive",
  B: "caution",
  C: "neutral",
};

/** A quiet text button of the band's last row; `expanded` makes it a toggle. */
function QuietButton({
  label,
  expanded,
  controls,
  onClick,
}: {
  label: string;
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      className={cn("px-3", expanded ? "text-ink" : "text-muted-foreground hover:text-ink")}
    >
      {label}
      <ChevronDown
        aria-hidden="true"
        className={cn("transition-transform duration-base ease-out-soft", expanded && "rotate-180")}
      />
    </Button>
  );
}

export function AnalysisBand({
  analysis,
  canEdit,
  modelAvailable,
  funnelOpen,
  onFunnelToggle,
  nearOpen,
  nearId,
  onNearToggle,
  onCheckRole,
}: {
  analysis: AnalysisController;
  canEdit: boolean;
  modelAvailable: boolean | null;
  funnelOpen: boolean;
  onFunnelToggle: () => void;
  nearOpen: boolean;
  /** The id of the near list the toggle controls. */
  nearId: string;
  onNearToggle: () => void;
  /** Shows the "Le poste" tab, where the team checks what the model wrote. */
  onCheckRole: () => void;
}) {
  const { t, locale } = useI18n();
  const headingId = useId();
  const funnelId = useId();
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

  if (band === "needsCheck") {
    return shell(
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={headingId} className="min-w-0 text-body text-ink">
          {t("briefs.analysis.check")}
        </h2>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" icon={<Briefcase />} onClick={onCheckRole}>
            {t("briefs.analysis.check.open")}
          </Button>
          {canEdit ? (
            <Button type="button" icon={<Sparkles />} onClick={analysis.resume}>
              {t("briefs.analysis.start")}
            </Button>
          ) : null}
        </div>
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
    return shell(
      <>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-2xl text-ink sm:text-3xl">
            {plural(view.results.length, {
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
            <span aria-hidden="true">·</span>
            <span>{date}</span>
          </p>
        </div>
        {searches.length > 1 ? <div className="-mb-2 -ml-3 flex flex-wrap">{previous}</div> : null}
      </>,
    );
  }

  const matches = analysis.matches.length;
  const zero = band === "done" && matches === 0;
  const tiers = tierCounts(view.results);
  const near = analysis.near.length;
  const legacy = band === "legacy";
  const missing = analysis.mostMissing;
  const missingLine = missing ? (
    <p className="text-sm text-ink">
      {t("briefs.analysis.missing", {
        label:
          missing.kind === "role"
            ? `${t(kindKey(missing.kind))} · ${missing.label}`
            : missing.label,
      })}
    </p>
  ) : null;
  const sub = legacy
    ? date
    : `${plural(funnel.analysed, {
        none: "briefs.analysis.of.none",
        one: "briefs.analysis.of.one",
        many: "briefs.analysis.of.many",
      })} · ${date}`;

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
                  : "briefs.analysis.matches.none",
              one: "briefs.analysis.matches.one",
              many: "briefs.analysis.matches.many",
            })}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm text-muted-foreground tabular-nums">{sub}</p>
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
            <TriangleAlert
              aria-hidden="true"
              className="size-4 shrink-0 text-caution-foreground dark:text-caution"
            />
            <span className="min-w-0">
              {plural(analysis.remaining, {
                none: "briefs.analysis.left.none",
                one: "briefs.analysis.left.one",
                many: "briefs.analysis.left.many",
              })}
            </span>
          </p>
          {analysis.canResume ? (
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

      {zero ? <AnalysisFunnel funnel={funnel} footer={missingLine} /> : null}

      {(!zero && !legacy) || near > 0 || searches.length > 1 ? (
        <div className="-mb-2 -ml-3 flex flex-wrap items-center gap-x-1">
          {!zero && !legacy ? (
            <QuietButton
              label={t("briefs.analysis.how")}
              expanded={funnelOpen}
              controls={funnelId}
              onClick={onFunnelToggle}
            />
          ) : null}
          {near > 0 ? (
            <QuietButton
              label={
                near === 1
                  ? t("briefs.analysis.near.one")
                  : t("briefs.analysis.near.many", { count: count(near) })
              }
              expanded={nearOpen}
              controls={nearId}
              onClick={onNearToggle}
            />
          ) : null}
          {previous}
        </div>
      ) : null}

      {funnelOpen && !zero && !legacy ? (
        <AnalysisFunnel id={funnelId} funnel={funnel} className="border-t border-border pt-5" />
      ) : null}
    </>,
  );
}
