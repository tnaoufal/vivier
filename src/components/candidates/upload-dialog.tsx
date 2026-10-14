/**
 * Importing CVs: a drop zone (or a file picker), the selection validated
 * once in the browser (PDF, 25 MB, 10 000 files; refusals grouped by
 * reason in one sentence), then the files sent lot after lot, three at
 * a time inside a lot: each one hashed, uploaded to the private bucket
 * and recorded as a queued document. After each lot the processor is
 * poked with the ids stored, so profiles appear while the import runs;
 * a missed poke is quiet (the service polls its queue). The dialog
 * shows the overall progress, four counters, the current lot alone (the
 * list never holds 10 000 rows) and, once over, the failed files with a
 * retry. Closing is refused while a lot runs; between lots the person
 * may stop, and resume later. With a `candidate`, every new document is
 * attached to that profile so the processor merges into it. On opening,
 * the dialog reads what the month's quota has left (the CVs processed
 * this month and those already in the queue, which the service reads
 * first) and says so; files past it are still sent (the processor sets
 * them aside, waiting) and a sentence says how many, as soon as the
 * selection and the quota are both known.
 */
import { useRef, useState } from "react";
import { ChevronDown, FileText, RefreshCw, Upload } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { notifyProcessor } from "@/lib/candidates/candidates.functions";
import { formatBytes, formatCount } from "@/lib/candidates/format";
import { countPendingDocuments } from "@/lib/candidates/queries";
import { beyondQuota, quotaRemaining } from "@/lib/candidates/quota";
import {
  groupRejected,
  planBatch,
  reduceUpload,
  resumeSkipped,
  retryFailed,
  skipUnfinished,
  summarizeUpload,
  validateFiles,
  type RejectedGroup,
  type UploadAction,
  type UploadItem,
  type UploadStatus,
} from "@/lib/candidates/upload";
import { supabaseUploadDeps } from "@/lib/candidates/upload-browser";
import { runUploads, type RunResult } from "@/lib/candidates/upload-runner";
import { useQuery } from "@/lib/data/use-query";
import { useI18n, type Locale } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/platform/call";
import { readCvsProcessedThisMonth } from "@/lib/team/team";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** pick: nothing chosen yet; running: a lot is on its way; stopped: items are left unsent; done: every file was sent or answered. */
type Phase = "pick" | "running" | "stopped" | "done";

/** What a run sends: the import's own lots (a fresh plan, or the skipped items on "Reprendre") or the failed items tried again. */
type RunMode = "import" | "retry";

/**
 * The lot on screen: which items, its 1-based index and the number of
 * lots. For the import they count over the whole import, so a resume
 * carries on at "Lot 8 sur 15"; a retry of the failures is its own short
 * series.
 */
interface CurrentLot {
  ids: ReadonlySet<string>;
  index: number;
  count: number;
  mode: RunMode;
}

const STATUS_TONE: Record<UploadStatus, PillTone> = {
  waiting: "neutral",
  hashing: "primary",
  uploading: "primary",
  uploaded: "positive",
  duplicate: "caution",
  failed: "negative",
  skipped: "neutral",
};

const makeId = (): string => crypto.randomUUID();

export interface UploadTargetCandidate {
  id: string;
  name: string;
}

export function UploadDialog({
  open,
  onOpenChange,
  candidate = null,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The profile the CVs belong to; null for a fresh import. */
  candidate?: UploadTargetCandidate | null;
  /** Called after each lot with the ids of the documents it stored. */
  onUploaded?: (documentIds: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { user } = useAuth();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [refused, setRefused] = useState<RejectedGroup[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [lot, setLot] = useState<CurrentLot | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failedOpen, setFailedOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Bumped by "Nouvel import": the files just sent are in the queue now, so the next selection
  // is measured against what they leave.
  const [quotaGeneration, setQuotaGeneration] = useState(0);
  // Read each time the dialog opens: the month's use moves with every CV processed, and the
  // queue (read by the service before anything sent now) with every import.
  const quotaUse = useQuery(
    `quota-use:${org.id}:${open ? "open" : "closed"}:${quotaGeneration}`,
    async () => {
      const supabase = await requireSupabase();
      const [processed, pending] = await Promise.all([
        readCvsProcessedThisMonth(supabase, org.id),
        countPendingDocuments(supabase, org.id),
      ]);
      return { processed, pending };
    },
    open,
  );
  const quota = org.cv_quota_month;
  // The hook keeps the last answer while it reads again: on a second opening, nothing is said
  // from the previous one until the fresh figures are in.
  const quotaRead = !quotaUse.loading && quotaUse.data !== null ? quotaUse.data : null;
  const room = quotaRead === null ? null : quotaRemaining(quota, quotaRead.processed, quotaRead.pending);
  // The dispatch reads the newest items synchronously; the state only feeds the render.
  const latest = useRef<UploadItem[]>([]);
  // Read by the runner between lots; the state only changes the button's label.
  const stopRef = useRef(false);
  // Lots of the import already run, so a resume keeps counting from where it stopped (a retry counts apart).
  const lotsRun = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const running = phase === "running";
  const over = phase === "done" || phase === "stopped";
  const summary = summarizeUpload(items);
  const refusedCount = countRefused(refused);
  const currentLot: CurrentLot | null = lot;
  const lotItems: UploadItem[] = currentLot ? items.filter((item: UploadItem) => currentLot.ids.has(item.id)) : [];
  const failedItems: UploadItem[] = over ? items.filter((item: UploadItem) => item.status === "failed") : [];

  function reset() {
    latest.current = [];
    stopRef.current = false;
    lotsRun.current = 0;
    setItems([]);
    setRefused([]);
    setPhase("pick");
    setLot(null);
    setStopRequested(false);
    setNote(null);
    setFailedOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (running) return;
    if (!next) reset();
    onOpenChange(next);
  }

  const dispatch = (action: UploadAction) => {
    latest.current = reduceUpload(latest.current, action);
    setItems(latest.current);
  };

  /** Tells the processor about a lot's documents; false when it did not answer (the queue is polled anyway). */
  async function poke(documentIds: string[]): Promise<boolean> {
    try {
      const answer = await notifyProcessor({ data: { ...(await withToken()), orgId: org.id, documentIds } });
      return answer.reached;
    } catch (error) {
      console.warn("[upload] poke failed", error);
      return false;
    }
  }

  /** Sends `toRun` (a fresh plan, the skipped items, or the retried ones) lot after lot. */
  async function run(toRun: UploadItem[], mode: RunMode) {
    if (!user) return;
    stopRef.current = false;
    setStopRequested(false);
    setFailedOpen(false);
    setNote(null);
    setPhase("running");
    const offset = mode === "import" ? lotsRun.current : 0;
    let reached = true;
    let result: RunResult = { lotCount: 0, lotsDone: 0, stopped: false };
    try {
      const supabase = await requireSupabase();
      const deps = supabaseUploadDeps(supabase, {
        orgId: org.id,
        userId: user.id,
        candidateId: candidate?.id ?? null,
      });
      result = await runUploads(toRun, deps, dispatch, {
        onLotStart: (started, index, count) => {
          setLot({ ids: new Set(started.map((item) => item.id)), index: index + offset, count: count + offset, mode });
        },
        onLotDone: async (_finished, stored) => {
          if (mode === "import") lotsRun.current += 1;
          if (!stored.length) return;
          if (!(await poke(stored))) reached = false;
          onUploaded?.(stored);
        },
        shouldContinue: () => !stopRef.current,
      });
    } catch (error) {
      // The client itself broke (no session, no storage): what never finished waits for "Reprendre".
      console.error(error);
      toast.error(t("common.error"));
      latest.current = skipUnfinished(latest.current);
      setItems(latest.current);
    }
    const left = summarizeUpload(latest.current);
    setNote(
      left.uploaded === 0
        ? t("candidates.upload.nothing")
        : !reached
          ? t("candidates.upload.queuedUnreached")
          : candidate
            ? t("candidates.upload.queuedFor")
            : t("candidates.upload.queued"),
    );
    // Read from the items, not from this run alone: a retry of the failures sends none of the
    // skipped items, and a run that broke off leaves some; they still wait for "Reprendre".
    setPhase(result.stopped || left.skipped > 0 ? "stopped" : "done");
  }

  async function start(files: File[]) {
    if (running || !user) return;
    const checked = validateFiles(files);
    setRefused(groupRejected(checked.rejected));
    if (!checked.accepted.length) return;
    // No block: the import runs and the processor sets the files past the quota aside, honestly, as waiting.
    const plan = planBatch(checked.accepted, org.id, makeId);
    latest.current = plan;
    lotsRun.current = 0;
    setItems(plan);
    setLot(null);
    await run(plan, "import");
  }

  async function resume() {
    if (running) return;
    const { items: next, resumed } = resumeSkipped(latest.current);
    if (!resumed.length) return;
    latest.current = next;
    setItems(next);
    await run(resumed, "import");
  }

  async function retry() {
    if (running) return;
    const { items: next, retried } = retryFailed(latest.current, org.id, makeId);
    if (!retried.length) return;
    latest.current = next;
    setItems(next);
    await run(retried, "retry");
  }

  function requestStop() {
    stopRef.current = true;
    setStopRequested(true);
  }

  /** "12 fichiers refusés : 10 ne sont pas des PDF, 2 dépassent 25 Mo." in one sentence, whatever the number. */
  function refusedSentence(groups: RejectedGroup[]): string | null {
    if (!groups.length) return null;
    const reasons = groups
      .map((group) =>
        group.count === 1
          ? t(`candidates.upload.refused.${group.reason}.one`)
          : t(`candidates.upload.refused.${group.reason}.many`, { count: formatCount(locale, group.count) }),
      )
      .join(", ");
    const count = countRefused(groups);
    return count === 1
      ? t("candidates.upload.refused.one", { reasons })
      : t("candidates.upload.refused.many", { count: formatCount(locale, count), reasons });
  }

  const refusedText = refusedSentence(refused);
  // Under the description: what the month has left, or that it could not be read; nothing while it loads.
  const quotaLine = quotaUse.loading
    ? null
    : quotaUse.error
      ? t("candidates.upload.quota.unknown", { quota: formatCount(locale, quota) })
      : room === null || quotaRead === null
        ? null
        : quotaRead.pending > 0
          ? t("candidates.upload.quota.lineQueued", {
              remaining: formatCount(locale, room),
              quota: formatCount(locale, quota),
              pending: formatCount(locale, quotaRead.pending),
            })
          : t("candidates.upload.quota.line", { remaining: formatCount(locale, room), quota: formatCount(locale, quota) });
  // How many of the chosen files are past the month's quota (an upper bound: the items are the accepted
  // files, a retry replaces its failures one for one): derived here so it appears as soon as both the
  // selection and the quota are known, whichever came first.
  const beyond = room === null || !items.length ? 0 : beyondQuota(items.length, room);
  const beyondText =
    beyond === 0
      ? null
      : beyond === 1
        ? t("candidates.upload.quota.beyond.one")
        : t("candidates.upload.quota.beyond.many", { count: formatCount(locale, beyond) });
  const title = candidate ? t("candidates.upload.titleFor", { name: candidate.name }) : t("candidates.upload.title");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="xl"
        className={cn(
          "flex flex-col",
          // The corner close button is the content's last child: muted while a lot runs.
          running && "[&>button:last-child]:pointer-events-none [&>button:last-child]:opacity-40",
        )}
        onEscapeKeyDown={(event) => {
          if (running) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (running) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription className="text-sm">{t("candidates.upload.text")}</DialogDescription>
          {quotaLine ? (
            <p
              className={cn(
                "text-meta tabular-nums",
                room === 0 ? "text-caution-foreground dark:text-caution" : "text-muted-foreground",
              )}
            >
              {quotaLine}
            </p>
          ) : null}
        </DialogHeader>

        {/* Scrolls only when a short screen cannot hold the whole dialog; the lists scroll on their own. */}
        <DialogBody className="space-y-6">
          {phase === "pick" ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped: FileList = event.dataTransfer.files;
                void start(Array.from(dropped));
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors duration-fast ease-out-soft",
                dragging ? "border-primary bg-primary/5" : "border-input",
              )}
            >
              <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Upload className="size-6" aria-hidden="true" />
              </div>
              <p className="text-body font-medium text-ink">{t("candidates.upload.drop")}</p>
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                {t("candidates.upload.browse")}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const picked: FileList | null = event.target.files;
                  const files: File[] = picked ? Array.from(picked) : [];
                  event.target.value = "";
                  void start(files);
                }}
              />
            </div>
          ) : null}

          {refusedText && !items.length ? <p className="text-sm text-negative">{refusedText}</p> : null}

          {items.length ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-display text-xl text-ink tabular-nums">
                  {t("candidates.upload.progress", {
                    done: formatCount(locale, summary.done),
                    total: formatCount(locale, summary.total),
                  })}
                </span>
                {currentLot ? (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {t(currentLot.mode === "retry" ? "candidates.upload.lotRetry" : "candidates.upload.lot", {
                      index: currentLot.index,
                      count: currentLot.count,
                    })}
                  </span>
                ) : null}
              </div>
              <ProgressBar
                size="md"
                value={summary.done}
                max={Math.max(1, summary.total)}
                active={running}
                tone={over && summary.failed === 0 ? "positive" : "primary"}
                label={t("candidates.upload.progress.label")}
              />

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Counter label={t("candidates.upload.stat.uploaded")} value={summary.uploaded} locale={locale} />
                <Counter label={t("candidates.upload.stat.duplicate")} value={summary.duplicate} locale={locale} />
                <Counter
                  label={t("candidates.upload.stat.failed")}
                  value={summary.failed}
                  locale={locale}
                  tone={summary.failed > 0 ? "negative" : "ink"}
                />
                <Counter label={t("candidates.upload.stat.rejected")} value={refusedCount} locale={locale} />
              </dl>

              {beyondText ? (
                <p className="text-meta text-caution-foreground dark:text-caution">{beyondText}</p>
              ) : null}
              {refusedText ? <p className="text-meta text-muted-foreground">{refusedText}</p> : null}
              {running ? <p className="text-meta text-muted-foreground">{t("candidates.upload.keepOpen")}</p> : null}

              {lotItems.length ? (
                <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {lotItems.map((item: UploadItem) => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{item.file.name}</p>
                        <p className="truncate text-meta text-muted-foreground">
                          {formatBytes(item.file.size, locale)}
                          {item.status === "failed" && item.error ? ` · ${t(`candidates.upload.error.${item.error}`)}` : ""}
                        </p>
                      </div>
                      <Pill size="sm" dot tone={STATUS_TONE[item.status]} className="shrink-0">
                        {t(`candidates.upload.status.${item.status}`)}
                      </Pill>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {over ? (
            <div className="space-y-3 text-sm">
              <p className="text-ink">
                {t("candidates.upload.summary", {
                  uploaded: formatCount(locale, summary.uploaded),
                  duplicate: formatCount(locale, summary.duplicate),
                  failed: formatCount(locale, summary.failed),
                })}
              </p>
              {phase === "stopped" ? (
                <p className="text-ink">
                  {summary.skipped === 1
                    ? t("candidates.upload.stopped.one")
                    : t("candidates.upload.stopped.many", { count: formatCount(locale, summary.skipped) })}
                </p>
              ) : null}
              {note ? <p className="text-muted-foreground">{note}</p> : null}

              {failedItems.length ? (
                <div className="rounded-lg border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setFailedOpen((value) => !value)}
                      aria-expanded={failedOpen}
                      className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-out-soft",
                          failedOpen && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate">
                        {failedOpen
                          ? t("candidates.upload.failed.hide")
                          : t("candidates.upload.failed.show", { count: formatCount(locale, failedItems.length) })}
                      </span>
                    </button>
                    <Button type="button" variant="outline" size="sm" icon={<RefreshCw />} onClick={() => void retry()}>
                      {t("candidates.upload.retryFailed")}
                    </Button>
                  </div>
                  {failedOpen ? (
                    <ul className="max-h-[30vh] divide-y divide-border overflow-y-auto border-t border-border">
                      {failedItems.map((item: UploadItem) => (
                        <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-ink">{item.file.name}</p>
                            <p className="truncate text-meta text-negative">
                              {item.error ? t(`candidates.upload.error.${item.error}`) : t("candidates.upload.status.failed")}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {running ? (
            <Button type="button" variant="outline" onClick={requestStop} disabled={stopRequested}>
              {stopRequested ? t("candidates.upload.stopping") : t("candidates.upload.stopAfterLot")}
            </Button>
          ) : null}
          {over ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setQuotaGeneration((value) => value + 1);
              }}
            >
              {t("candidates.upload.again")}
            </Button>
          ) : null}
          {phase === "stopped" ? (
            <Button type="button" onClick={() => void resume()}>
              {t("candidates.upload.resume")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={phase === "done" ? "default" : "outline"}
            onClick={() => handleOpenChange(false)}
            disabled={running}
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function countRefused(groups: readonly RejectedGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

/** One of the four counters: a label and a tabular number; the negative tone only when something failed. */
function Counter({
  label,
  value,
  locale,
  tone = "ink",
}: {
  label: string;
  value: number;
  locale: Locale;
  tone?: "ink" | "negative";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-4 py-3">
      <dt className="label-caps">{label}</dt>
      <dd className={cn("mt-0.5 font-display text-xl tabular-nums", tone === "negative" ? "text-negative" : "text-ink")}>
        {formatCount(locale, value)}
      </dd>
    </div>
  );
}
