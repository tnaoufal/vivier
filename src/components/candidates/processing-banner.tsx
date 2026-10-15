/**
 * Above the list while the service reads or left something aside: the
 * wave's progress on one line (the figure, the bar, the rate; said
 * finished for a moment once nothing is pending, so the bar reaches its
 * end before the banner goes), then what the wave leaves aside: the CVs
 * refused at the organisation's monthly quota (not broken: waiting; one
 * figure, and for a member one button that re-queues as many as the
 * month has room for, oldest first) and the documents the service
 * could not read or did not take for a CV, behind one quiet toggle that
 * unfolds them with their status pill, the service's sentence for a
 * real failure, a link to the file and a retry (a person may disagree
 * with the service's reading), since a document that never produced a
 * profile has no page of its own.
 */
import { useEffect, useState } from "react";
import { ChevronDown, CircleAlert, ExternalLink, Hourglass, RefreshCw } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { ProcessingProgress } from "@/components/candidates/processing-progress";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { notifyProcessor } from "@/lib/candidates/candidates.functions";
import { documentStatusKey, documentTone, formatBytes, formatCount } from "@/lib/candidates/format";
import type { ProcessingWave } from "@/lib/candidates/progress";
import { listFailedDocuments, type ProcessingCounts } from "@/lib/candidates/queries";
import { isQuotaFailure, quotaRemaining } from "@/lib/candidates/quota";
import { requeueQuotaFailures } from "@/lib/candidates/requeue";
import { canRetry, useDocumentActions } from "@/lib/candidates/use-document-actions";
import { useQuery } from "@/lib/data/use-query";
import type { DocumentRow } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/platform/call";
import { readCvsProcessedThisMonth } from "@/lib/team/team";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Rows the unfolded list shows; past that, a count. */
const LIST_LIMIT = 50;
/** How long the line says the wave is finished before it goes. */
const FINISHED_MS = 6_000;

export function ProcessingBanner({
  orgId,
  counts,
  wave,
  canEdit,
  onChanged,
}: {
  orgId: string;
  counts: ProcessingCounts;
  /** The wave in progress (readProcessingProgress); null until read, or when the first read failed. */
  wave: ProcessingWave | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const [open, setOpen] = useState(false);
  const [requeuing, setRequeuing] = useState(false);
  const pending = wave?.pending ?? 0;
  // The wave that just ended, said for a moment: the bar reaches the end before it goes. Derived
  // in render from the previous wave (the moment the pending reaches zero), so the banner never
  // shows a frame without it; a later read with nothing pending leaves it alone.
  const [previousWave, setPreviousWave] = useState<ProcessingWave | null>(wave);
  const [finished, setFinished] = useState<{ total: number } | null>(null);
  if (wave !== previousWave) {
    setPreviousWave(wave);
    if (previousWave && previousWave.pending > 0 && wave && wave.pending === 0) {
      // The read that saw the end counted what the wave read from its start (it kept that start);
      // without such a count, the previous read's total. A wave that read nothing (every CV refused
      // at the cap) says nothing here: the figures below do.
      const total = wave.startedAt !== null ? wave.total : previousWave.total;
      if (total > 0) setFinished({ total });
    }
  }
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => setFinished(null), FINISHED_MS);
    return () => clearTimeout(timer);
  }, [finished]);
  // The documents the service could not read, and those it set aside: the unfolded list.
  const setAside = counts.failed + counts.rejected;
  const quota = org.cv_quota_month;
  // Read again whenever the counts move: each CV processed changes what the month has left.
  const used = useQuery(
    `quota-used:${orgId}:${counts.quota}:${pending}`,
    async () => readCvsProcessedThisMonth(await requireSupabase(), orgId),
    counts.quota > 0,
  );
  // The room left this month once the queue has taken its share: the service reads the queue
  // first, so a CV re-queued behind it only gets what the queue leaves.
  const room = used.data === null ? null : quotaRemaining(quota, used.data, pending);
  // What one click may send back: that room, never more than what waits.
  const requeueable = room === null ? 0 : Math.min(room, counts.quota);
  const others = useQuery(
    `set-aside-documents:${orgId}:${counts.failed}:${counts.rejected}`,
    async () => listFailedDocuments(await requireSupabase(), orgId, LIST_LIMIT, "other"),
    open && setAside > 0,
  );
  const actions = useDocumentActions(onChanged);

  const progressShown = pending > 0 || finished !== null;
  if (!progressShown && setAside === 0 && counts.quota === 0) return null;

  const count = (value: number): string => formatCount(locale, value);
  const failedText =
    counts.failed === 1
      ? t("candidates.processing.failed.one")
      : t("candidates.processing.failed.many", { count: count(counts.failed) });
  const rejectedText =
    counts.rejected === 1
      ? t("candidates.processing.rejected.one")
      : t("candidates.processing.rejected.many", { count: count(counts.rejected) });
  const quotaText =
    counts.quota === 1
      ? t("candidates.processing.quota.one")
      : t("candidates.processing.quota.many", { count: count(counts.quota) });
  // "2 échecs · 1 écarté": the toggle's text is the figures it hides.
  const setAsideText = [
    counts.failed > 0 ? failedText : null,
    counts.rejected > 0 ? rejectedText : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  // What the banner says aloud: the end of a wave and the set-aside figures, never the pending
  // count (it moves with every CV read) nor the unfolded list. One span per figure, so only the
  // one that changed is read again, and one that goes (the end of the wave) is not.
  const announcement: { key: string; text: string }[] = [
    finished
      ? {
          key: "done",
          text:
            finished.total === 1
              ? t("candidates.processing.progress.done.one")
              : t("candidates.processing.progress.done", { total: count(finished.total) }),
        }
      : null,
    counts.failed > 0 ? { key: "failed", text: failedText } : null,
    counts.rejected > 0 ? { key: "rejected", text: rejectedText } : null,
    counts.quota > 0 ? { key: "quota", text: quotaText } : null,
  ].filter((part): part is { key: string; text: string } => part !== null);

  /** A set-aside file is said by its pill alone; a real failure keeps the service's own sentence (why it failed). */
  const sentence = (document: DocumentRow): string | null => {
    if (document.status === "rejected" || isQuotaFailure(document)) return null;
    return document.error?.trim() || t("candidates.documents.noError");
  };

  /** Tells the processor about re-queued documents; false when it did not answer (the queue is polled anyway). */
  async function poke(documentIds: string[]): Promise<boolean> {
    try {
      const answer = await notifyProcessor({
        data: { ...(await withToken()), orgId, documentIds },
      });
      return answer.reached;
    } catch (error) {
      console.warn("[processing] poke failed", error);
      return false;
    }
  }

  async function requeue() {
    if (requeuing || requeueable <= 0) return;
    setRequeuing(true);
    try {
      const result = await requeueQuotaFailures(await requireSupabase(), orgId, requeueable, poke);
      if (result.requeued === 0) {
        toast(t("candidates.processing.quota.requeuedNone"));
      } else {
        const left = Math.max(0, counts.quota - result.requeued);
        const done =
          result.requeued === 1
            ? t("candidates.processing.quota.requeued.one")
            : t("candidates.processing.quota.requeued.many", { count: count(result.requeued) });
        const wait =
          left === 0
            ? ""
            : left === 1
              ? t("candidates.processing.quota.left.one")
              : t("candidates.processing.quota.left.many", { count: count(left) });
        toast.success(wait ? `${done} ${wait}` : done);
        if (!result.reached) toast.error(t("candidates.upload.queuedUnreached"));
      }
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setRequeuing(false);
      // Whatever happened, the counts moved (or did not): read them again.
      onChanged();
    }
  }

  /** The rows past the limit, as a count, so the list never looks complete when it is not. */
  const hidden = others.data ? setAside - others.data.length : 0;

  return (
    <section className="sheet fade-in mb-6 p-4 text-sm sm:px-6">
      <p className="sr-only" role="status">
        {announcement.map((part) => (
          <span key={part.key}>{part.text} </span>
        ))}
      </p>
      <ProcessingProgress wave={wave} finishedTotal={finished?.total ?? null} />
      {counts.quota > 0 || setAside > 0 ? (
        <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", progressShown && "mt-3")}>
          {counts.quota > 0 ? (
            <span className="inline-flex min-w-0 items-center gap-2 text-ink">
              <Hourglass className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate tabular-nums">{quotaText}</span>
            </span>
          ) : null}
          {canEdit && requeueable > 0 ? (
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw />}
              onClick={() => void requeue()}
              disabled={requeuing || actions.busyId !== null}
            >
              {t("candidates.processing.quota.requeue", { count: count(requeueable) })}
            </Button>
          ) : null}
          {setAside > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="press inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full text-ink tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-out-soft",
                  open && "rotate-180",
                )}
                aria-hidden="true"
              />
              {setAsideText}
            </button>
          ) : null}
        </div>
      ) : null}
      {open && setAside > 0 ? (
        <div className="fade-in mt-3 border-t border-border pt-1">
          {others.loading && !others.data ? (
            <>
              <p className="sr-only">{t("common.loading")}</p>
              <SkeletonRows rows={2} avatar={false} className="-mx-4 sm:-mx-6" />
            </>
          ) : null}
          {others.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-ink">
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{t("candidates.listError")}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                icon={<RefreshCw />}
                onClick={() => void others.refresh()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-border">
            {(others.data ?? []).map((document: DocumentRow) => (
              <li key={document.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-medium text-ink">
                      {document.file_name}
                    </span>
                    <Pill size="sm" tone={documentTone(document.status)}>
                      {t(documentStatusKey(document.status))}
                    </Pill>
                    <span className="text-meta text-muted-foreground tabular-nums">
                      {formatBytes(document.byte_size, locale)}
                    </span>
                  </div>
                  {sentence(document) ? (
                    <p className="text-meta text-muted-foreground">{sentence(document)}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<ExternalLink />}
                    onClick={() => void actions.view(document)}
                    disabled={actions.busyId !== null}
                  >
                    {t("common.open")}
                  </Button>
                  {canEdit && canRetry(document.status) ? (
                    <Button
                      type="button"
                      variant="outline"
                      icon={<RefreshCw />}
                      onClick={() => void actions.retry(document)}
                      disabled={actions.busyId !== null || requeuing}
                    >
                      {t("candidates.documents.retry")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
            {hidden > 0 ? (
              <li className="py-3 text-meta text-muted-foreground tabular-nums">
                {hidden === 1
                  ? t("candidates.processing.more.one")
                  : t("candidates.processing.more", { count: count(hidden) })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
