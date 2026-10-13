/**
 * Above the list: how many CVs the service is still reading, how many
 * it could not read, and how many it set aside because it did not take
 * them for a CV. The last two unfold on demand with the sentence the
 * service left, a link to the file and a retry (a person may disagree
 * with the service's reading), since a document that never produced a
 * profile has no page of its own.
 */
import { useState } from "react";
import { ExternalLink, FileX, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { documentStatusKey, documentTone, formatBytes } from "@/lib/candidates/format";
import { listFailedDocuments, type ProcessingCounts } from "@/lib/candidates/queries";
import { canRetry, useDocumentActions } from "@/lib/candidates/use-document-actions";
import { useQuery } from "@/lib/data/use-query";
import type { DocumentRow } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

/** The counts the banner reads; `rejected` is optional until every caller passes it. */
export type BannerCounts = Pick<ProcessingCounts, "pending" | "failed"> & { rejected?: number | undefined };

export function ProcessingBanner({
  orgId,
  counts,
  canEdit,
  onChanged,
}: {
  orgId: string;
  counts: BannerCounts;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const rejected = counts.rejected ?? 0;
  // What the unfolded list shows: the documents the service could not read, and those it set aside.
  const setAside = counts.failed + rejected;
  const documents = useQuery(
    `set-aside-documents:${orgId}:${counts.failed}:${rejected}`,
    async () => listFailedDocuments(await requireSupabase(), orgId),
    open && setAside > 0,
  );
  const actions = useDocumentActions(onChanged);

  if (counts.pending === 0 && setAside === 0) return null;

  const pendingText =
    counts.pending === 1
      ? t("candidates.processing.pending.one")
      : t("candidates.processing.pending.many", { count: counts.pending });
  const failedText =
    counts.failed === 1
      ? t("candidates.processing.failed.one")
      : t("candidates.processing.failed.many", { count: counts.failed });
  const rejectedText =
    rejected === 1
      ? t("candidates.processing.rejected.one")
      : t("candidates.processing.rejected.many", { count: rejected });

  /** A set-aside file is the service's reading, said in the person's language; a failure keeps the service's own sentence. */
  const sentence = (document: DocumentRow): string => {
    if (document.status === "rejected") return t("candidates.documents.rejectedNote");
    return document.error?.trim() || t("candidates.documents.noError");
  };

  return (
    <section className="sheet mb-4 px-5 py-4 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {counts.pending > 0 ? (
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
            <span className="truncate tabular-nums">{pendingText}</span>
          </span>
        ) : null}
        {counts.failed > 0 ? (
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <TriangleAlert className="size-4 shrink-0 text-negative" aria-hidden="true" />
            <span className="truncate tabular-nums">{failedText}</span>
          </span>
        ) : null}
        {rejected > 0 ? (
          <span className="inline-flex min-w-0 items-center gap-2 text-ink">
            <FileX className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate tabular-nums">{rejectedText}</span>
          </span>
        ) : null}
        {setAside > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} className="ml-auto">
            {open ? t("candidates.processing.hide") : t("candidates.processing.show")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{t("candidates.processing.help")}</p>
      {open && setAside > 0 ? (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {documents.loading && !documents.data ? (
            <li className="py-3 text-muted-foreground">{t("common.loading")}</li>
          ) : null}
          {(documents.data ?? []).map((document: DocumentRow) => (
            <li key={document.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium text-ink">{document.file_name}</span>
                  <Pill tone={documentTone(document.status)}>{t(documentStatusKey(document.status))}</Pill>
                  <span className="text-xs text-muted-foreground">{formatBytes(document.byte_size, locale)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{sentence(document)}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
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
      ) : null}
    </section>
  );
}
