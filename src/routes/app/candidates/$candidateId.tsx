/**
 * /app/candidates/:candidateId: one profile, laid out like a CV a
 * recruiter reads. The detail skeleton of the charter: a sticky page
 * header (the way back as its eyebrow, the name, the status pills, the
 * page's actions: read the CV in place, the similar profiles, edit, and
 * a menu for export, archive and erasure), then the head of the CV as a
 * card (the photo, the name editable in place, the position held today,
 * where and since when, the languages). Then the main column (summary,
 * career, education, skills, contact and links) and the aside (the
 * team's tags, the documents, consent and retention folded, the
 * comments). What the structuring read, with a confidence hint where it
 * was unsure and "not stated" where it read nothing; a form to correct
 * it in the same structure. Live through realtime on documents and
 * comments of this candidate.
 */
import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  Download,
  Ellipsis,
  FileText,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill } from "@/components/app-shell/pill";
import { CommentsCard } from "@/components/candidates/comments-card";
import { ConsentCard, type ConsentPatch } from "@/components/candidates/consent-card";
import { CvViewer } from "@/components/candidates/cv-viewer";
import { DocumentsCard } from "@/components/candidates/documents-card";
import { EraseCandidateDialog } from "@/components/candidates/erase-dialog";
import { ProfileForm } from "@/components/candidates/profile-form";
import { ProfileHeader } from "@/components/candidates/profile-header";
import { ProfileSections } from "@/components/candidates/profile-sections";
import { SimilarDrawer } from "@/components/candidates/similar-drawer";
import { TagsCard } from "@/components/candidates/tags-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { eraseCandidate } from "@/lib/candidates/candidates.functions";
import { primaryDocument } from "@/lib/candidates/cv-viewer";
import { toDraft, toPatch, type CandidateDraft } from "@/lib/candidates/draft";
import { buildExport, downloadJson, exportFileName, exportJson } from "@/lib/candidates/export";
import { displayName } from "@/lib/candidates/format";
import { exportPhoto, type ExportPhoto } from "@/lib/candidates/photos";
import {
  listCandidateComments,
  listCandidateDocuments,
  readCandidate,
  readRetentionDueAt,
} from "@/lib/candidates/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { DocumentRow } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/candidates/$candidateId")({
  component: CandidatePage,
  // The similar-profiles drawer links to this same route with another id: a
  // fresh mount per candidate, so no draft, open dialog or loaded profile of
  // the previous one survives under the new URL.
  remountDeps: ({ params }) => params,
});

/** The main column and the 22rem aside of the charter, one column under lg. */
const GRID = "grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]";
/** A labelled header button folded to its 40px icon under `sm`. */
const PHONE_ICON = "max-sm:size-10 max-sm:px-0";

/** The viewer keeps its document while it slides out, so the frame does not blank mid-motion. */
interface ViewerState {
  open: boolean;
  document: DocumentRow | null;
}

function CandidatePage() {
  const { candidateId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can, showPhotos } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CandidateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState>({ open: false, document: null });

  const candidate = useQuery(`candidate:${org.id}:${candidateId}`, async () =>
    readCandidate(await requireSupabase(), org.id, candidateId),
  );
  const documents = useQuery(`candidate-documents:${org.id}:${candidateId}`, async () =>
    listCandidateDocuments(await requireSupabase(), org.id, candidateId),
  );
  const comments = useQuery(`candidate-comments:${org.id}:${candidateId}`, async () =>
    listCandidateComments(await requireSupabase(), org.id, candidateId),
  );
  const row = candidate.data ?? null;
  const retention = useQuery(
    `retention:${candidateId}:${row?.last_contact_at ?? ""}:${row?.created_at ?? ""}`,
    async () => readRetentionDueAt(await requireSupabase(), candidateId),
    row !== null,
  );

  const refreshCandidate = candidate.refresh;
  const refreshDocuments = documents.refresh;
  const refreshComments = comments.refresh;
  useEffect(() => {
    const onDocuments = debounce(() => {
      void refreshDocuments();
      void refreshCandidate();
    }, 400);
    const onComments = debounce(() => {
      void refreshComments();
    }, 250);
    const stopDocuments = subscribeToTable(
      "documents",
      `candidate_id=eq.${candidateId}`,
      onDocuments,
    );
    const stopComments = subscribeToTable("comments", `candidate_id=eq.${candidateId}`, onComments);
    return () => {
      stopDocuments();
      stopComments();
    };
  }, [candidateId, refreshCandidate, refreshComments, refreshDocuments]);

  /** One update under RLS on the columns the grant allows; true when it went through. */
  async function update(patch: Record<string, unknown>, done?: string): Promise<boolean> {
    try {
      const supabase = await requireSupabase();
      const { error } = await supabase
        .from("candidates")
        .update(patch)
        .eq("id", candidateId)
        .eq("org_id", org.id);
      if (error) {
        console.error(error);
        toast.error(t("common.error"));
        return false;
      }
      await refreshCandidate();
      if (done) toast.success(done);
      return true;
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
      return false;
    }
  }

  function startEditing() {
    if (!row) return;
    setDraft(toDraft(row));
    setEditing(true);
  }

  async function saveDraft() {
    if (!draft || busy) return;
    const result = toPatch(draft);
    if ("invalid" in result) {
      toast.error(t("candidates.years.invalid"));
      return;
    }
    setBusy(true);
    try {
      if (await update(result.patch, t("common.saved"))) {
        setEditing(false);
        setDraft(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveConsent(patch: ConsentPatch) {
    await update(patch, t("common.saved"));
  }

  async function archive(next: "active" | "archived") {
    if (busy) return;
    setBusy(true);
    try {
      if (await update({ status: next }, t("common.saved"))) setArchiveOpen(false);
    } finally {
      setBusy(false);
    }
  }

  /** The profile and its documents as one file; the photo as a link valid one hour, when there is one. */
  async function exportProfile() {
    if (!row || busy) return;
    setBusy(true);
    try {
      let photo: ExportPhoto | null = null;
      let photoFailed = false;
      if (row.photo_path) {
        try {
          photo = await exportPhoto(await requireSupabase(), row.photo_path);
        } catch (error) {
          console.error(error);
          photoFailed = true;
        }
      }
      downloadJson(
        exportFileName(row),
        exportJson(buildExport(row, documents.data ?? [], new Date(), photo)),
      );
      if (photoFailed) toast.error(t("candidates.export.photoFailed"));
      else toast.success(t("candidates.export.done"));
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (busy) return;
    setBusy(true);
    try {
      await eraseCandidate({ data: { ...(await withToken()), orgId: org.id, candidateId } });
      toast.success(t("candidates.erase.done"));
      setEraseOpen(false);
      void navigate({ to: "/app/candidates" });
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setBusy(false);
    }
  }

  function openViewer(document: DocumentRow) {
    setViewer({ open: true, document });
  }

  // The way back is the header's eyebrow, as on a brief: one detail skeleton across the product.
  const eyebrow = (
    <Link
      to="/app/candidates"
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("nav.candidates")}
    </Link>
  );

  if (candidate.loading && !row) {
    return (
      <div>
        <PageHeader
          sticky
          eyebrow={eyebrow}
          title={
            <span
              className="skeleton inline-block h-5 w-56 max-w-full rounded-sm align-middle"
              aria-hidden="true"
            />
          }
        />
        <p className="sr-only">{t("common.loading")}</p>
        <div className="sheet mb-8 flex items-start gap-5 p-6 sm:p-8" aria-busy="true">
          <Skeleton className="size-18 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-3 pt-1">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
        <div className={GRID} aria-busy="true">
          <div className="sheet overflow-hidden">
            <SkeletonRows rows={5} avatar={false} />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-36 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <EmptyState
        title={candidate.error ? t("common.error") : t("candidates.notFound.title")}
        text={candidate.error ? undefined : t("candidates.notFound.text")}
        action={
          <Button asChild variant="outline">
            <Link to="/app/candidates">{t("candidates.back")}</Link>
          </Button>
        }
      />
    );
  }

  const name = displayName(row, t("candidates.noName"));
  const documentList = documents.data ?? [];
  const primary = primaryDocument(documentList);

  // Every role may read the CV and look around; the similar profiles are a reading aid, not a write.
  // In the slim header a phone has no room for four labelled buttons next to the name: under `sm`
  // each one is its 40px icon, its name kept for assistive technologies.
  const actions = (
    <>
      {primary ? (
        <Button
          type="button"
          variant="outline"
          icon={<FileText />}
          onClick={() => openViewer(primary)}
          className={PHONE_ICON}
        >
          <span className="max-sm:sr-only">{t("candidates.documents.view")}</span>
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        icon={<Users />}
        onClick={() => setSimilarOpen(true)}
        className={PHONE_ICON}
      >
        <span className="max-sm:sr-only">{t("similar.button")}</span>
      </Button>
      {canEdit && !editing ? (
        <Button type="button" icon={<Pencil />} onClick={startEditing} className={PHONE_ICON}>
          <span className="max-sm:sr-only">{t("common.edit")}</span>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            icon={<Ellipsis />}
            aria-label={t("candidates.moreActions")}
            disabled={busy}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void exportProfile()}>
            <Download />
            {t("candidates.export")}
          </DropdownMenuItem>
          {canEdit ? (
            row.status === "active" ? (
              <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                <Archive />
                {t("candidates.archive")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void archive("active")}>
                <ArchiveRestore />
                {t("candidates.unarchive")}
              </DropdownMenuItem>
            )
          ) : null}
          {can("admin") ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setEraseOpen(true)}>
                <Trash2 />
                {t("candidates.erase")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const consentTone =
    row.consent_status === "given"
      ? "positive"
      : row.consent_status === "withdrawn"
        ? "negative"
        : "neutral";

  return (
    <div>
      <PageHeader
        sticky
        eyebrow={eyebrow}
        title={name}
        meta={
          <>
            <Pill size="sm" tone={row.status === "active" ? "positive" : "neutral"} dot>
              {t(`candidates.status.${row.status}`)}
            </Pill>
            <Pill size="sm" tone={consentTone} dot>
              {t(`candidates.consent.${row.consent_status}`)}
            </Pill>
            <Pill size="sm" dot>
              {t(`candidates.source.${row.source}`)}
            </Pill>
          </>
        }
        actions={actions}
      />
      <ProfileHeader
        candidate={row}
        canEdit={canEdit}
        showPhotos={showPhotos}
        onRename={async (fullName) => {
          await update({ full_name: fullName }, t("common.saved"));
        }}
      />

      <div className={GRID}>
        <div className="min-w-0">
          {editing && draft ? (
            <ProfileForm
              draft={draft}
              onChange={setDraft}
              onSubmit={saveDraft}
              onCancel={() => {
                setEditing(false);
                setDraft(null);
              }}
              busy={busy}
            />
          ) : (
            <ProfileSections
              candidate={row}
              canEdit={canEdit}
              onChips={async (column, values) => {
                await update({ [column]: values });
              }}
            />
          )}
        </div>
        <aside className="min-w-0 space-y-6">
          <DocumentsCard
            candidate={{ id: row.id, name }}
            documents={documentList}
            canEdit={canEdit}
            onRead={openViewer}
            onChanged={() => {
              void refreshDocuments();
              void refreshCandidate();
            }}
          />
          <TagsCard
            tags={row.tags ?? []}
            canEdit={canEdit}
            onChange={async (values) => {
              await update({ tags: values });
            }}
          />
          <ConsentCard
            candidate={row}
            retentionDueAt={retention.data ?? null}
            retentionMonths={org.retention_months}
            canEdit={canEdit}
            onSave={saveConsent}
          />
          <CommentsCard
            orgId={org.id}
            candidateId={row.id}
            comments={comments.data ?? []}
            canComment={canEdit}
            onChanged={() => {
              void refreshComments();
            }}
          />
        </aside>
      </div>

      <CvViewer
        open={viewer.open}
        onOpenChange={(open) => setViewer((state) => ({ ...state, open }))}
        document={viewer.document}
        candidateName={name}
      />
      <SimilarDrawer
        open={similarOpen}
        onOpenChange={setSimilarOpen}
        orgId={org.id}
        candidateId={row.id}
        name={name}
        showPhotos={showPhotos}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          if (!busy) setArchiveOpen(open);
        }}
        title={t("candidates.archiveTitle")}
        text={t("candidates.archiveText")}
        confirmLabel={t("candidates.archive")}
        busy={busy}
        onConfirm={() => archive("archived")}
      />
      <EraseCandidateDialog
        open={eraseOpen}
        onOpenChange={setEraseOpen}
        name={name}
        documentCount={documentList.length}
        busy={busy}
        onConfirm={erase}
      />
    </div>
  );
}
