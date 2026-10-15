/**
 * /app/candidates/:candidateId: one profile, laid out like a CV a
 * recruiter reads, the team's thread beside it. A sticky header (the
 * way back as its eyebrow, the name, one line that reminds the position
 * held today, the years and the place; one filled action, the CV read
 * in place; a menu for the rest: edit, the similar profiles, export,
 * archive, erase; the thread's button on a phone), then the head of the
 * CV as a card (the photo in greyscale, the name, the position, the
 * seniority first, the languages, the pills that set the profile
 * apart), the sections (summary, career, education, skills, contact and
 * links) and under them the documents, the team's tags and the consent
 * folded. From `lg` the thread is a sticky right column; below, a
 * drawer. Editing opens the form in a drawer with one "Enregistrer".
 * What the structuring read, with a hint where it was unsure and "not
 * stated" where it read nothing. Live through realtime on the documents
 * of this candidate; the thread follows its own messages.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Download,
  Ellipsis,
  FileText,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { ConsentCard, type ConsentPatch } from "@/components/candidates/consent-card";
import { CvViewer } from "@/components/candidates/cv-viewer";
import { DocumentsCard } from "@/components/candidates/documents-card";
import { EraseCandidateDialog } from "@/components/candidates/erase-dialog";
import { ProfileForm } from "@/components/candidates/profile-form";
import { ProfileHeader } from "@/components/candidates/profile-header";
import { ProfileSections } from "@/components/candidates/profile-sections";
import { SimilarDrawer } from "@/components/candidates/similar-drawer";
import { TagsCard } from "@/components/candidates/tags-card";
import { ThreadButton, ThreadPanel } from "@/components/thread/thread-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { eraseCandidate } from "@/lib/candidates/candidates.functions";
import { primaryDocument } from "@/lib/candidates/cv-viewer";
import { toDraft, toPatch, type CandidateDraft } from "@/lib/candidates/draft";
import { buildExport, downloadJson, exportFileName, exportJson } from "@/lib/candidates/export";
import { displayName, headerLine } from "@/lib/candidates/format";
import { exportPhoto, type ExportPhoto } from "@/lib/candidates/photos";
import {
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
import { useTeamMembers } from "@/lib/shortlists/use-members";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/candidates/$candidateId")({
  component: CandidatePage,
  // The similar-profiles drawer links to this same route with another id: a
  // fresh mount per candidate, so no draft, open dialog or loaded profile of
  // the previous one survives under the new URL.
  remountDeps: ({ params }) => params,
});

/** The main column and the thread's column of the charter, as the panel draws them, one column under lg. */
const GRID = "lg:grid lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start lg:gap-8";
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
  const { user } = useAuth();
  const members = useTeamMembers();
  const navigate = useNavigate();
  const canEdit = can("member");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CandidateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState>({ open: false, document: null });
  const target = useMemo(() => ({ candidateId }), [candidateId]);

  const candidate = useQuery(`candidate:${org.id}:${candidateId}`, async () =>
    readCandidate(await requireSupabase(), org.id, candidateId),
  );
  const documents = useQuery(`candidate-documents:${org.id}:${candidateId}`, async () =>
    listCandidateDocuments(await requireSupabase(), org.id, candidateId),
  );
  const row = candidate.data ?? null;
  const retention = useQuery(
    `retention:${candidateId}:${row?.last_contact_at ?? ""}:${row?.created_at ?? ""}`,
    async () => readRetentionDueAt(await requireSupabase(), candidateId),
    row !== null,
  );

  const refreshCandidate = candidate.refresh;
  const refreshDocuments = documents.refresh;
  useEffect(() => {
    const onDocuments = debounce(() => {
      void refreshDocuments();
      void refreshCandidate();
    }, 400);
    return subscribeToTable("documents", `candidate_id=eq.${candidateId}`, onDocuments);
  }, [candidateId, refreshCandidate, refreshDocuments]);

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
      if (await update(result.patch, t("common.saved"))) setEditing(false);
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
        <div className={GRID} aria-busy="true">
          <div className="min-w-0 space-y-6">
            <div className="sheet flex items-start gap-5 p-6">
              <Skeleton className="size-18 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-3 pt-1">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
            <div className="sheet overflow-hidden">
              <SkeletonRows rows={5} avatar={false} />
            </div>
          </div>
          <Skeleton className="hidden h-80 rounded-lg lg:block" />
        </div>
      </div>
    );
  }

  // The header stays in place when the profile cannot be shown: the way back is where it always is.
  if (!row) {
    return (
      <div>
        <PageHeader
          sticky
          eyebrow={eyebrow}
          title={candidate.error ? t("common.errorPage") : t("candidates.notFound.title")}
        />
        <EmptyState
          icon={candidate.error ? <TriangleAlert /> : <Users />}
          title={candidate.error ? t("common.error") : t("candidates.notFound.text")}
          action={
            candidate.error ? (
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw />}
                onClick={() => void refreshCandidate()}
              >
                {t("common.retry")}
              </Button>
            ) : (
              <Button asChild variant="outline" icon={<ArrowLeft />}>
                <Link to="/app/candidates">{t("candidates.back")}</Link>
              </Button>
            )
          }
        />
      </div>
    );
  }

  const name = displayName(row, t("candidates.noName"));
  const reminder = headerLine(locale, row);
  const documentList = documents.data ?? [];
  const primary = primaryDocument(documentList);

  // One filled action, the CV read in place; then the thread's button, then the menu for the
  // rest, in the order of a brief's page. Under `sm` the filled button is its 40px icon, its
  // name kept for assistive technologies.
  const actions = (
    <>
      {primary ? (
        <Button
          type="button"
          icon={<FileText />}
          onClick={() => openViewer(primary)}
          className={PHONE_ICON}
        >
          <span className="max-sm:sr-only">{t("candidates.documents.view")}</span>
        </Button>
      ) : null}
      <ThreadButton target={target} onClick={() => setThreadOpen(true)} />
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
          {canEdit ? (
            <DropdownMenuItem onSelect={startEditing}>
              <Pencil />
              {t("common.edit")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setSimilarOpen(true)}>
            <Users />
            {t("similar.button")}
          </DropdownMenuItem>
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

  return (
    <div>
      <PageHeader
        sticky
        eyebrow={eyebrow}
        title={name}
        meta={
          reminder ? (
            <span className="min-w-0 max-w-full truncate text-meta text-muted-foreground tabular-nums">
              {reminder}
            </span>
          ) : undefined
        }
        actions={actions}
      />

      <ThreadPanel
        target={target}
        canPost={canEdit}
        members={members}
        currentUserId={user?.id ?? null}
        open={threadOpen}
        onOpenChange={setThreadOpen}
      >
        <div className="space-y-6">
          <ProfileHeader candidate={row} showPhotos={showPhotos} />
          <ProfileSections
            candidate={row}
            canEdit={canEdit}
            onSkills={async (values) => {
              await update({ skills: values });
            }}
          />
          <div className="grid gap-6 md:grid-cols-2">
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
            <div className="min-w-0 space-y-6">
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
            </div>
          </div>
        </div>
      </ThreadPanel>

      <ProfileForm
        open={editing}
        onOpenChange={setEditing}
        draft={draft}
        onChange={setDraft}
        onSubmit={saveDraft}
        busy={busy}
      />
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
