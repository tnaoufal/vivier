/**
 * /app/candidates/:candidateId: one profile. What the structuring read,
 * with a confidence hint where it was unsure and "not stated" where it
 * read nothing; a form to correct it; the CVs behind it; the team's
 * comments; consent and retention; archive, export and erasure. Live
 * through realtime on documents and comments of this candidate.
 */
import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ArrowLeft, Download, Pencil, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { CommentsCard } from "@/components/candidates/comments-card";
import { ConsentCard, type ConsentPatch } from "@/components/candidates/consent-card";
import { DocumentsCard } from "@/components/candidates/documents-card";
import { EraseCandidateDialog } from "@/components/candidates/erase-dialog";
import { ProfileForm } from "@/components/candidates/profile-form";
import { ProfileHeader } from "@/components/candidates/profile-header";
import { ProfileSections } from "@/components/candidates/profile-sections";
import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { eraseCandidate } from "@/lib/candidates/candidates.functions";
import { toDraft, toPatch, type CandidateDraft } from "@/lib/candidates/draft";
import { buildExport, downloadJson, exportFileName, exportJson } from "@/lib/candidates/export";
import { displayName } from "@/lib/candidates/format";
import {
  listCandidateComments,
  listCandidateDocuments,
  readCandidate,
  readRetentionDueAt,
} from "@/lib/candidates/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/candidates/$candidateId")({
  component: CandidatePage,
});

function CandidatePage() {
  const { candidateId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CandidateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);

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
    const stopDocuments = subscribeToTable("documents", `candidate_id=eq.${candidateId}`, onDocuments);
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
      const { error } = await supabase.from("candidates").update(patch).eq("id", candidateId).eq("org_id", org.id);
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

  function exportProfile() {
    if (!row) return;
    downloadJson(exportFileName(row), exportJson(buildExport(row, documents.data ?? [])));
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

  const backLink = (
    <Link to="/app/candidates" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-ink">
      <ArrowLeft className="size-4" />
      {t("candidates.back")}
    </Link>
  );

  if (candidate.loading && !row) {
    return (
      <div>
        {backLink}
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (!row) {
    return (
      <div>
        {backLink}
        <EmptyState
          title={candidate.error ? t("common.error") : t("candidates.notFound.title")}
          text={candidate.error ? undefined : t("candidates.notFound.text")}
          action={
            <Button asChild variant="outline">
              <Link to="/app/candidates">{t("candidates.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const name = displayName(row, t("candidates.noName"));
  const documentList = documents.data ?? [];

  return (
    <div>
      {backLink}
      <ProfileHeader
        candidate={row}
        canEdit={canEdit}
        onRename={async (fullName) => {
          await update({ full_name: fullName }, t("common.saved"));
        }}
      />

      {canEdit ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {!editing ? (
            <Button type="button" onClick={startEditing} className="gap-1.5">
              <Pencil />
              {t("common.edit")}
            </Button>
          ) : null}
          {row.status === "active" ? (
            <Button type="button" variant="outline" onClick={() => setArchiveOpen(true)} disabled={busy} className="gap-1.5">
              <Archive />
              {t("candidates.archive")}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => void archive("active")} disabled={busy} className="gap-1.5">
              <ArchiveRestore />
              {t("candidates.unarchive")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={exportProfile} className="gap-1.5">
            <Download />
            {t("candidates.export")}
          </Button>
          {can("admin") ? (
            <Button type="button" variant="ghost" onClick={() => setEraseOpen(true)} disabled={busy} className="gap-1.5 text-negative hover:text-negative">
              <Trash2 />
              {t("candidates.erase")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={exportProfile} className="gap-1.5">
            <Download />
            {t("candidates.export")}
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
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
        <aside className="space-y-4">
          <DocumentsCard
            candidate={{ id: row.id, name }}
            documents={documentList}
            canEdit={canEdit}
            onChanged={() => {
              void refreshDocuments();
              void refreshCandidate();
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
