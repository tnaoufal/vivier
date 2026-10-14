/**
 * The progress of the wave the service is reading, at the top of the
 * processing banner: one sentence at display scale (done out of total,
 * the percent), the system's 6px bar whose width eases to the figure
 * and carries a sheen while the service works (none under reduced
 * motion), then the rate and the estimate, or that the rate is still
 * being measured.
 * Once the wave ends the block says so for a moment (`finishedTotal`,
 * which wins over a wave with nothing pending), then the banner lets it
 * go. Nothing here is estimated by hand: the figures are the database's
 * counts, the rate what left the queue lately.
 */
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { formatCount } from "@/lib/candidates/format";
import { formatThroughput, progressOf, type ProcessingWave } from "@/lib/candidates/progress";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ProcessingProgress({
  wave,
  finishedTotal,
  className,
}: {
  wave: ProcessingWave | null;
  /** The total of the wave that just ended, while the banner still says so; null otherwise. */
  finishedTotal: number | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const progress = wave ? progressOf(wave) : null;
  const active = progress !== null && progress.active;
  if (!active && finishedTotal === null) return null;

  const count = (value: number): string => formatCount(locale, value);
  const done = active ? progress.done : (finishedTotal ?? 0);
  const total = active ? progress.total : (finishedTotal ?? 0);
  const sentence = active
    ? t("candidates.processing.progress.active", {
        done: count(progress.done),
        total: count(progress.total),
        percent: progress.percent,
      })
    : t("candidates.processing.progress.done", { total: count(total) });
  const rate = !active
    ? null
    : progress.throughput === null || progress.etaMinutes === null
      ? t("candidates.processing.progress.measuring")
      : progress.etaMinutes === 1
        ? t("candidates.processing.progress.rate.one", {
            throughput: formatThroughput(locale, progress.throughput),
          })
        : t("candidates.processing.progress.rate.many", {
            throughput: formatThroughput(locale, progress.throughput),
            eta: count(progress.etaMinutes),
          });

  return (
    // While active the figures move every few seconds: not read aloud each time (the bar says
    // where it stands on demand); the end of the wave is, through the banner's live region.
    <div className={cn("space-y-2", className)} aria-live={active ? "off" : undefined}>
      <p className="font-display text-xl leading-7 text-ink tabular-nums">{sentence}</p>
      <ProgressBar
        size="md"
        value={done}
        max={Math.max(1, total)}
        active={active}
        tone={active ? "primary" : "positive"}
        label={t("candidates.processing.progress.label")}
      />
      {rate ? <p className="text-meta text-muted-foreground tabular-nums">{rate}</p> : null}
    </div>
  );
}
