/**
 * Importing CVs: a drop zone (or a file picker), the batch validated in
 * the browser (PDF, 25 MB, 200 files), then each file hashed, uploaded
 * to the private bucket and recorded as a queued document, three at a
 * time, with its state on its own line. Closing is refused while the
 * batch runs. Afterwards the processor is poked; whether it answered or
 * not the CVs are in the queue, which the service polls itself, so the
 * dialog says so quietly either way. With a `candidate`, every new
 * document is attached to that profile so the processor merges into it.
 */
import { useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { notifyProcessor } from "@/lib/candidates/candidates.functions";
import { formatBytes } from "@/lib/candidates/format";
import {
  planBatch,
  reduceUpload,
  summarizeUpload,
  uploadedIds,
  validateFiles,
  type RejectedFile,
  type UploadAction,
  type UploadItem,
  type UploadStatus,
} from "@/lib/candidates/upload";
import { supabaseUploadDeps } from "@/lib/candidates/upload-browser";
import { runUploads } from "@/lib/candidates/upload-runner";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/server/call";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Phase = "pick" | "running" | "done";

const STATUS_TONE: Record<UploadStatus, "neutral" | "primary" | "positive" | "caution" | "negative"> = {
  waiting: "neutral",
  hashing: "primary",
  uploading: "primary",
  uploaded: "positive",
  duplicate: "caution",
  failed: "negative",
};

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
  onUploaded?: (documentIds: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { user } = useAuth();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef<UploadItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = phase === "running";
  const summary = summarizeUpload(items);

  function reset() {
    latest.current = [];
    setItems([]);
    setRejected([]);
    setPhase("pick");
    setNote(null);
  }

  function handleOpenChange(next: boolean) {
    if (running) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function start(files: File[]) {
    if (running || !user) return;
    const checked = validateFiles(files);
    setRejected(checked.rejected);
    if (!checked.accepted.length) return;
    const plan = planBatch(checked.accepted, org.id, () => crypto.randomUUID());
    latest.current = plan;
    setItems(plan);
    setNote(null);
    setPhase("running");
    const dispatch = (action: UploadAction) => {
      latest.current = reduceUpload(latest.current, action);
      setItems(latest.current);
    };
    try {
      const supabase = await requireSupabase();
      const deps = supabaseUploadDeps(supabase, {
        orgId: org.id,
        userId: user.id,
        candidateId: candidate?.id ?? null,
      });
      await runUploads(plan, deps, dispatch);
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    }
    const ids = uploadedIds(latest.current);
    if (ids.length) {
      try {
        await notifyProcessor({ data: { ...(await withToken()), orgId: org.id, documentIds: ids } });
      } catch (error) {
        // The service polls the queue itself; a missed poke only delays the work.
        console.warn("[upload] poke failed", error);
      }
      setNote(candidate ? t("candidates.upload.queuedFor") : t("candidates.upload.queued"));
      onUploaded?.(ids);
    } else {
      setNote(t("candidates.upload.nothing"));
    }
    setPhase("done");
  }

  function rejectSentence(entry: RejectedFile): string {
    return t(`candidates.upload.reject.${entry.reason}`, { name: entry.file.name });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[90vh] overflow-y-auto",
          // The corner close button is the content's last child: muted while the batch runs.
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
          <DialogTitle>
            {candidate ? t("candidates.upload.titleFor", { name: candidate.name }) : t("candidates.upload.title")}
          </DialogTitle>
          <DialogDescription>{t("candidates.upload.text")}</DialogDescription>
        </DialogHeader>

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
              void start(Array.from(event.dataTransfer.files));
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <Upload className="size-6 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium text-ink">{t("candidates.upload.drop")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              {t("candidates.upload.browse")}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void start(files);
              }}
            />
          </div>
        ) : null}

        {rejected.length ? (
          <ul className="space-y-1 text-sm text-negative">
            {rejected.map((entry, index) => (
              <li key={`${entry.file.name}-${index}`}>{rejectSentence(entry)}</li>
            ))}
          </ul>
        ) : null}

        {items.length ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-ink">
                {t("candidates.upload.progress", { done: summary.done, total: summary.total })}
              </span>
              {running ? <span className="text-xs text-muted-foreground">{t("candidates.upload.busy")}</span> : null}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${summary.total ? Math.round((summary.done / summary.total) * 100) : 0}%` }}
              />
            </div>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ink">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(item.file.size, locale)}
                      {item.status === "failed" && item.error
                        ? ` · ${t(`candidates.upload.error.${item.error}`)}`
                        : ""}
                    </p>
                  </div>
                  <Pill tone={STATUS_TONE[item.status]}>{t(`candidates.upload.status.${item.status}`)}</Pill>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="space-y-1 text-sm">
            <p className="text-ink">
              {t("candidates.upload.summary", {
                uploaded: summary.uploaded,
                duplicate: summary.duplicate,
                failed: summary.failed,
              })}
            </p>
            {note ? <p className="text-muted-foreground">{note}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          {phase === "done" ? (
            <Button type="button" variant="outline" onClick={reset}>
              {t("candidates.upload.again")}
            </Button>
          ) : null}
          <Button type="button" onClick={() => handleOpenChange(false)} disabled={running}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
