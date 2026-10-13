/**
 * Above the list: how many CVs the service is still reading and how
 * many it could not read. The failed ones unfold on demand with the
 * sentence the service left, a link to the file and a retry, since a
 * CV that never produced a profile has no page of its own.
 */
import { useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { documentStatusKey, documentTone, formatBytes } from "@/lib/candidates/format";
import { listFailedDocuments, type ProcessingCounts } from "@/lib/candidates/queries";
import { canRetry, useDocumentActions } from "@/lib/candidates/use-document-actions";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";

export function ProcessingBanner({
  orgId,
  counts,
  canEdit,
  onChanged,
}: {
  orgId: string;
  counts: ProcessingCounts;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const failed = useQuery(
    `failed-documents:${orgId}:${counts.failed}`,
    async () => listFailedDocuments(await requireSupabase(), orgId),
    open && counts.failed > 0,
  );
  const actions = useDocumentActions(onChanged);

  if (counts.pending === 0 && counts.failed === 0) return null;

  const pendingText =
    counts.pending === 1
      ? t("candidates.processing.pending.one")
      : t("candidates.processing.pending.many", { count: counts.pending });
  const failedText =
    counts.failed === 1
      ? t("candidates.processing.failed.one")
      : t("candidates.processing.failed.many", { count: counts.failed });

  return (
    <section className="sheet mb-4 px-4 py-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {counts.pending > 0 ? (
          <span className="inline-flex items-center gap-2 text-ink">
            <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
            {pendingText}
          </span>
        ) : null}
        {counts.failed > 0 ? (
          <span className="inline-flex items-center gap-2 text-ink">
            <TriangleAlert className="size-4 text-negative" aria-hidden="true" />
            {failedText}
          </span>
        ) : null}
        {counts.failed > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} className="ml-auto">
            {open ? t("candidates.processing.hide") : t("candidates.processing.show")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("candidates.processing.help")}</p>
      {open && counts.failed > 0 ? (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {failed.loading && !failed.data ? (
            <li className="py-2 text-muted-foreground">{t("common.loading")}</li>
          ) : null}
          {(failed.data ?? []).map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-ink">{document.file_name}</span>
                  <Pill tone={documentTone(document.status)}>{t(documentStatusKey(document.status))}</Pill>
                  <span className="text-xs text-muted-foreground">{formatBytes(document.byte_size, locale)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {document.error?.trim() || t("candidates.documents.noError")}
                </p>
              </div>
              <div className="flex gap-1">
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
