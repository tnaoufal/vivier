/**
 * The CV read in place: a full-size drawer (the viewport on a phone, 80
 * percent of it on a desk) with the PDF in a frame from a signed link,
 * a toolbar (the file and what is known of it, the PDF / text switch,
 * open in a new tab, download, close) and the text the service
 * extracted, read on demand (documents.extracted_text): one tab away for
 * everyone, and the view a browser that does not display PDFs opens on.
 * Escape closes (the drawer traps focus; a click inside the frame hands
 * focus to the browser's own viewer, whose Escape the page does not
 * see: the close button is always one Tab away). The signed links are
 * short-lived: a viewer opened again signs them again.
 */
import { useEffect, useState } from "react";
import { Download, ExternalLink, FileSearch, FileText, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { requireSupabase } from "@/lib/auth/supabase-client";
import {
  canDisplayPdf,
  initialTab,
  pdfFrameSrc,
  textParagraphs,
  type ViewerTab,
} from "@/lib/candidates/cv-viewer";
import { formatBytes } from "@/lib/candidates/format";
import { readDocumentText } from "@/lib/candidates/queries";
import { signedCvUrl } from "@/lib/candidates/upload-browser";
import { useQuery } from "@/lib/data/use-query";
import type { DocumentRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";

/** How long the viewer's links live: a CV read end to end, with time to spare. */
const VIEW_URL_SECONDS = 900;

export function CvViewer({
  open,
  onOpenChange,
  document: doc,
  candidateName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The document shown; kept by the caller while the drawer closes so the content does not blank. */
  document: DocumentRow | null;
  candidateName: string;
}) {
  const { t, locale } = useI18n();
  const pdfSupported = canDisplayPdf(typeof navigator === "undefined" ? null : navigator);
  const [tab, setTab] = useState<ViewerTab>(() => initialTab(pdfSupported));
  const documentId = doc?.id ?? null;

  // Every document opens on the PDF again (or on the text, when the browser shows none).
  useEffect(() => {
    setTab(initialTab(pdfSupported));
  }, [documentId, pdfSupported]);

  const links = useQuery(
    `cv-view:${documentId ?? ""}:${open ? "open" : "closed"}`,
    async () => {
      if (!doc) return null;
      const supabase = await requireSupabase();
      const [view, download] = await Promise.all([
        signedCvUrl(supabase, doc.storage_path, VIEW_URL_SECONDS),
        signedCvUrl(supabase, doc.storage_path, VIEW_URL_SECONDS, doc.file_name),
      ]);
      return { id: doc.id, view, download };
    },
    open && doc !== null,
  );
  // useQuery keeps the previous answer across a key change: links signed for
  // another document are not this document's.
  const current = links.data && links.data.id === documentId ? links.data : null;

  const details = doc
    ? [
        formatBytes(doc.byte_size, locale),
        doc.page_count === null
          ? null
          : doc.page_count === 1
            ? t("candidates.documents.pages.one")
            : t("candidates.documents.pages.many", { count: doc.page_count }),
        formatDate(locale, doc.created_at),
      ]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · ")
    : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="full"
        className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0 lg:w-[80vw]"
      >
        <SheetHeader className="gap-0 border-b border-border py-3 pl-4 pr-14 sm:pl-6 sm:pr-16">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileText className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <SheetTitle className="truncate font-sans text-base font-semibold leading-6 tracking-normal">
                  {doc?.file_name ?? t("candidates.documents.title")}
                </SheetTitle>
                <SheetDescription className="truncate text-meta tabular-nums">
                  {details || candidateName}
                </SheetDescription>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {pdfSupported && doc ? (
                <Segmented
                  value={tab}
                  onChange={setTab}
                  aria-label={t("candidates.viewer.tabs")}
                  options={[
                    { value: "pdf", label: t("candidates.viewer.pdf"), icon: <FileText /> },
                    { value: "text", label: t("candidates.viewer.text"), icon: <FileSearch /> },
                  ]}
                />
              ) : null}
              <ToolbarLink
                href={current?.view ?? null}
                label={t("candidates.documents.openTab")}
                icon={<ExternalLink />}
              />
              <ToolbarLink
                href={current?.download ?? null}
                label={t("candidates.documents.download")}
                icon={<Download />}
              />
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden p-0 sm:m-0 sm:p-0">
          {!doc ? null : tab === "pdf" && pdfSupported ? (
            links.error ? (
              <EmptyState
                compact
                icon={<FileText />}
                title={t("candidates.documents.openFailed")}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    icon={<RefreshCw />}
                    onClick={() => void links.refresh()}
                  >
                    {t("common.retry")}
                  </Button>
                }
                className="m-6"
              />
            ) : !current ? (
              <div className="flex-1 p-6" aria-busy="true">
                <p className="sr-only">{t("common.loading")}</p>
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            ) : (
              <iframe
                key={current.view}
                src={pdfFrameSrc(current.view)}
                title={t("candidates.viewer.frameTitle", { name: candidateName })}
                className="h-full w-full flex-1 bg-muted"
              />
            )
          ) : (
            <TextPane document={doc} enabled={open} pdfSupported={pdfSupported} />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** An icon-only link of the toolbar (a disabled button until the link is signed), with its sentence in a tooltip and its name for assistive technologies. */
function ToolbarLink({
  href,
  label,
  icon,
}: {
  href: string | null;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button asChild variant="outline" size="icon" icon={icon}>
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            icon={icon}
            aria-label={label}
            disabled
          />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The extracted text, read when this pane shows, as paragraphs in a reading column. */
function TextPane({
  document: doc,
  enabled,
  pdfSupported,
}: {
  document: DocumentRow;
  enabled: boolean;
  pdfSupported: boolean;
}) {
  const t = useI18n().t;
  const text = useQuery(
    `cv-text:${doc.org_id}:${doc.id}`,
    async () => readDocumentText(await requireSupabase(), doc.org_id, doc.id),
    enabled,
  );
  const paragraphs = textParagraphs(text.data);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        {!pdfSupported ? (
          <p className="rounded-md bg-caution/12 px-4 py-3 text-sm text-caution-foreground">
            {t("candidates.viewer.noPdf")}
          </p>
        ) : null}
        <p className="text-meta text-muted-foreground">{t("candidates.viewer.textHelp")}</p>
        {text.loading && !text.data ? (
          <SkeletonRows rows={6} avatar={false} className="divide-y-0" />
        ) : text.error ? (
          <div className="space-y-3">
            <p className="text-sm text-negative">{t("common.error")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<RefreshCw />}
              onClick={() => void text.refresh()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : paragraphs.length ? (
          paragraphs.map((paragraph, index) => (
            <p key={index} className="whitespace-pre-wrap text-body text-ink break-words">
              {paragraph}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{t("candidates.viewer.noText")}</p>
        )}
      </div>
    </div>
  );
}
