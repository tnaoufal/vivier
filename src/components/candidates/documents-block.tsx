/**
 * The CVs behind a profile, one row each: the file's name, "· 2 pages ·
 * 14 oct." (what is known of it; "Texte seul, sans modèle" when no model
 * read it), a status pill only when it is not simply processed (queued,
 * in progress, failed, unreadable, set aside or waiting for the quota:
 * the pill says it on its own), "Lire" that opens the viewer in place,
 * a retry for a failed, unreadable or set-aside one (a person may
 * disagree with the service's reading); the service's own sentence on
 * a line of its own when it failed. The block's action adds another CV
 * to this profile (members). The viewer is this block's: it reads the
 * document a person chose, where the header's "Voir le CV" reads the
 * newest one the service read.
 */
import { useState } from "react";
import { CircleAlert, FileText, RefreshCw, Upload } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { documentStatusKey, documentTone } from "@/lib/candidates/format";
import { isQuotaFailure } from "@/lib/candidates/quota";
import { canRetry, useDocumentActions } from "@/lib/candidates/use-document-actions";
import type { DocumentRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";

import { Block, type BlockHeading } from "./block";
import { CvViewer } from "./cv-viewer";
import { UploadDialog, type UploadTargetCandidate } from "./upload-dialog";

/** The viewer keeps its document while it slides out, so the frame does not blank mid-motion. */
interface ViewerState {
  open: boolean;
  document: DocumentRow | null;
}

/** A real failure: the service's sentence says why, on a line of its own. A quota wait or a set-aside file is said by its pill. */
function hasNote(document: DocumentRow): boolean {
  return (
    (document.status === "failed" || document.status === "needs_ocr") && !isQuotaFailure(document)
  );
}

export function DocumentsBlock({
  candidate,
  documents,
  canEdit,
  as,
  onChanged,
}: {
  candidate: UploadTargetCandidate;
  documents: DocumentRow[];
  canEdit: boolean;
  as: BlockHeading;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState>({ open: false, document: null });
  const actions = useDocumentActions(onChanged);

  /** The line under a failed document: the service's own sentence (the stored one stays for the audit). */
  const note = (document: DocumentRow): string =>
    document.error?.trim() || t("candidates.documents.noError");

  /** "· 2 pages · 14 oct.": what is known of the file, and that no model read it when so. */
  const details = (document: DocumentRow): string =>
    [
      document.page_count === null
        ? null
        : document.page_count === 1
          ? t("candidates.documents.pages.one")
          : t("candidates.documents.pages.many", { count: document.page_count }),
      formatDate(locale, document.created_at),
      document.structuring_method === "heuristic"
        ? t("candidates.documents.method.heuristic")
        : null,
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .map((part) => `· ${part}`)
      .join(" ");

  return (
    <Block
      as={as}
      title={t("candidates.documents.title")}
      count={documents.length > 1 ? documents.length : undefined}
      action={
        canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            icon={<Upload />}
            onClick={() => setUploadOpen(true)}
            aria-label={t("candidates.documents.add")}
            title={t("candidates.documents.add")}
            className="text-muted-foreground hover:text-ink"
          />
        ) : null
      }
    >
      {documents.length ? (
        <ul className="stagger divide-y divide-line">
          {documents.map((document: DocumentRow) => (
            <li
              key={document.id}
              className="rise-in flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-meta first:pt-0 last:pb-0"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 basis-24 truncate font-medium text-ink">
                {document.file_name}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {details(document)}
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
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => setViewer({ open: true, document })}
                  className="px-1"
                >
                  {t("candidates.documents.read")}
                </Button>
                {canEdit && canRetry(document.status) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    icon={<RefreshCw />}
                    onClick={() => void actions.retry(document)}
                    disabled={actions.busyId !== null}
                    aria-label={t("candidates.documents.retry")}
                    title={t("candidates.documents.retry")}
                    className="text-muted-foreground hover:text-ink"
                  />
                ) : null}
              </span>
              {hasNote(document) ? (
                <p className="flex basis-full items-start gap-1.5 text-meta text-ink">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{note(document)}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("candidates.documents.empty")}</p>
      )}
      <CvViewer
        open={viewer.open}
        onOpenChange={(open) => setViewer((state) => ({ ...state, open }))}
        document={viewer.document}
        candidateName={candidate.name}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        candidate={candidate}
        onUploaded={() => onChanged()}
      />
    </Block>
  );
}
