/**
 * The CVs behind a profile: each with its name, what is known of it
 * (size, date, pages, how it was structured), a status pill only when
 * it is not simply processed (queued, in progress, failed, unreadable,
 * set aside or waiting for the quota: the pill says it on its own), the
 * service's sentence when it failed (an icon and the words, never a
 * hue), a "Lire" button that opens the viewer in place, a retry for a
 * failed, unreadable or set-aside one (a person may disagree with the
 * service's reading), and a button to add another CV to this profile.
 */
import { useState } from "react";
import { CircleAlert, FileSearch, FileText, RefreshCw, Upload } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { documentStatusKey, documentTone, formatBytes } from "@/lib/candidates/format";
import { isQuotaFailure } from "@/lib/candidates/quota";
import { canRetry, useDocumentActions } from "@/lib/candidates/use-document-actions";
import type { DocumentRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";

import { UploadDialog, type UploadTargetCandidate } from "./upload-dialog";

/** A real failure: the service's sentence says why, on a line of its own. A quota wait or a set-aside file is said by its pill. */
function hasNote(document: DocumentRow): boolean {
  return (
    (document.status === "failed" || document.status === "needs_ocr") && !isQuotaFailure(document)
  );
}

export function DocumentsCard({
  candidate,
  documents,
  canEdit,
  onRead,
  onChanged,
}: {
  candidate: UploadTargetCandidate;
  documents: DocumentRow[];
  canEdit: boolean;
  /** Opens the viewer on this document. */
  onRead: (document: DocumentRow) => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [uploadOpen, setUploadOpen] = useState(false);
  const actions = useDocumentActions(onChanged);

  const addButton = canEdit ? (
    <Button type="button" variant="outline" icon={<Upload />} onClick={() => setUploadOpen(true)}>
      {t("candidates.documents.add")}
    </Button>
  ) : null;

  /** The line under a failed document: the service's own sentence (the stored one stays for the audit). */
  const note = (document: DocumentRow): string =>
    document.error?.trim() || t("candidates.documents.noError");

  const details = (document: DocumentRow): string =>
    [
      formatBytes(document.byte_size, locale),
      document.page_count === null
        ? null
        : document.page_count === 1
          ? t("candidates.documents.pages.one")
          : t("candidates.documents.pages.many", { count: document.page_count }),
      formatDate(locale, document.created_at),
      document.structuring_method
        ? t(`candidates.documents.method.${document.structuring_method}`)
        : null,
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" · ");

  return (
    <section className="sheet p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">
          {t("candidates.documents.title")}
          {documents.length > 1 ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {documents.length}
            </span>
          ) : null}
        </h2>
        {documents.length ? addButton : null}
      </div>
      {documents.length ? (
        <ul className="stagger divide-y divide-border">
          {documents.map((document: DocumentRow) => (
            <li
              key={document.id}
              className="rise-in flex items-start gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {document.file_name}
                  </span>
                  {/* A quota refusal is a wait, not a failure: it reads as one. A processed document is the normal case and wears no pill. */}
                  {isQuotaFailure(document) ? (
                    <Pill size="sm" tone="caution" dot>
                      {t("candidates.documents.status.quota")}
                    </Pill>
                  ) : document.status !== "processed" ? (
                    <Pill size="sm" tone={documentTone(document.status)} dot>
                      {t(documentStatusKey(document.status))}
                    </Pill>
                  ) : null}
                </div>
                <p className="mt-0.5 text-meta text-muted-foreground tabular-nums">
                  {details(document)}
                </p>
                {hasNote(document) ? (
                  <p className="mt-1 flex items-start gap-1.5 text-meta text-ink">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{note(document)}</span>
                  </p>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    icon={<FileSearch />}
                    onClick={() => onRead(document)}
                  >
                    {t("candidates.documents.read")}
                  </Button>
                  {canEdit && canRetry(document.status) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      icon={<RefreshCw />}
                      onClick={() => void actions.retry(document)}
                      disabled={actions.busyId !== null}
                    >
                      {t("candidates.documents.retry")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          inset
          icon={<FileText />}
          title={t("candidates.documents.empty")}
          action={addButton}
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
