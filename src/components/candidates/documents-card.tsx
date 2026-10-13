/**
 * The CVs behind a profile: each with its name, size, status (and the
 * service's sentence when it failed or was set aside as not a CV), a
 * link to the file, a retry for a failed, unreadable or set-aside one
 * (a person may disagree with the service's reading), and a button to
 * add another CV to this same profile.
 */
import { useState } from "react";
import { ExternalLink, Paperclip, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { documentStatusKey, documentTone, formatBytes } from "@/lib/candidates/format";
import { canRetry, useDocumentActions } from "@/lib/candidates/use-document-actions";
import type { DocumentRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { UploadDialog, type UploadTargetCandidate } from "./upload-dialog";

/** The statuses whose sentence from the service is worth a line of its own. */
function hasNote(status: DocumentRow["status"]): boolean {
  return status === "failed" || status === "needs_ocr" || status === "rejected";
}

export function DocumentsCard({
  candidate,
  documents,
  canEdit,
  onChanged,
}: {
  candidate: UploadTargetCandidate;
  documents: DocumentRow[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [uploadOpen, setUploadOpen] = useState(false);
  const actions = useDocumentActions(onChanged);

  const addButton = canEdit ? (
    <Button type="button" size="sm" variant="outline" onClick={() => setUploadOpen(true)} className="gap-1.5">
      <Paperclip />
      {t("candidates.documents.add")}
    </Button>
  ) : null;

  /**
   * What the line under a document says: a set-aside file is the service's
   * reading, said in the person's language (the stored sentence stays for
   * the audit); a failure keeps the service's own sentence.
   */
  const note = (document: DocumentRow): string => {
    if (document.status === "rejected") return t("candidates.documents.rejectedNote");
    return document.error?.trim() || t("candidates.documents.noError");
  };

  return (
    <section className="sheet p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="label-caps">{t("candidates.documents.title")}</h2>
        {documents.length ? addButton : null}
      </div>
      {documents.length ? (
        <ul className="divide-y divide-border">
          {documents.map((document: DocumentRow) => (
            <li key={document.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{document.file_name}</span>
                <Pill tone={documentTone(document.status)}>{t(documentStatusKey(document.status))}</Pill>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatBytes(document.byte_size, locale)} · {formatDate(locale, document.created_at)}
                {document.structuring_method
                  ? ` · ${t(`candidates.documents.method.${document.structuring_method}`)}`
                  : ""}
              </p>
              {hasNote(document.status) ? (
                // Set aside is the service's reading, not a failure: it reads in the quiet tone.
                <p className={cn("text-xs", document.status === "rejected" ? "text-muted-foreground" : "text-negative")}>
                  {note(document)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void actions.view(document)}
                  disabled={actions.busyId !== null}
                  className="gap-1.5"
                >
                  <ExternalLink />
                  {t("candidates.documents.view")}
                </Button>
                {canEdit && canRetry(document.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void actions.retry(document)}
                    disabled={actions.busyId !== null}
                    className="gap-1.5"
                  >
                    <RefreshCw />
                    {t("candidates.documents.retry")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Paperclip />}
          title={t("candidates.documents.empty")}
          action={addButton}
          className="py-8"
        />
      )}
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        candidate={candidate}
        onUploaded={() => onChanged()}
      />
    </section>
  );
}
