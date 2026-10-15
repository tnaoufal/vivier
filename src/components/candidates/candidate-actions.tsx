/**
 * What a person does with a profile, in the order of every page: the
 * one filled button, the CV read in place (the viewer on the newest
 * document the service read), then whatever the caller puts between
 * (the `ThreadToggle` on the candidate's page), then the `Ellipsis`
 * menu: Modifier (the ProfileForm in a drawer), Profils proches (the
 * SimilarDrawer), Exporter, Archiver / Réactiver, Effacer (admins,
 * confirmed by typing the name). The writes are for members. The
 * dialogs live here, so the pool's sheet header and the page's
 * Workspace header carry the same control with the same state; the
 * caller reads the profile again through `onChanged` and leaves the
 * page or the selection through `onErased`. Under `sm` the filled
 * button is its 40px icon, its name kept for assistive technologies.
 */
import { useState, type ReactNode } from "react";
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
import { PHONE_ICON } from "@/components/app-shell/workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { eraseCandidate } from "@/lib/candidates/candidates.functions";
import { primaryDocument } from "@/lib/candidates/cv-viewer";
import { toDraft, toPatch, type CandidateDraft } from "@/lib/candidates/draft";
import { buildExport, downloadJson, exportFileName, exportJson } from "@/lib/candidates/export";
import { exportPhoto, type ExportPhoto } from "@/lib/candidates/photos";
import { useCandidateUpdate } from "@/lib/candidates/use-candidate";
import type { CandidateRow, DocumentRow } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

import { CvViewer } from "./cv-viewer";
import { EraseCandidateDialog } from "./erase-dialog";
import { ProfileForm } from "./profile-form";
import { SimilarDrawer } from "./similar-drawer";

/** The viewer keeps its document while it slides out, so the frame does not blank mid-motion. */
interface ViewerState {
  open: boolean;
  document: DocumentRow | null;
}

export function CandidateActions({
  candidate,
  documents,
  name,
  onChanged,
  onErased,
  children,
}: {
  candidate: CandidateRow;
  documents: DocumentRow[];
  /** The name as shown (the placeholder for a nameless profile). */
  name: string;
  /** Reads the profile again after a write. */
  onChanged: () => void | Promise<void>;
  /** Where to go once the profile is erased. */
  onErased: () => void;
  /** Between the filled button and the menu: the `ThreadToggle` on the candidate's page. */
  children?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can, showPhotos } = useOrg();
  const canEdit = can("member");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CandidateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState>({ open: false, document: null });
  const update = useCandidateUpdate(org.id, candidate.id, onChanged);
  const primary = primaryDocument(documents);

  function startEditing() {
    setDraft(toDraft(candidate));
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
    if (busy) return;
    setBusy(true);
    try {
      let photo: ExportPhoto | null = null;
      let photoFailed = false;
      if (candidate.photo_path) {
        try {
          photo = await exportPhoto(await requireSupabase(), candidate.photo_path);
        } catch (error) {
          console.error(error);
          photoFailed = true;
        }
      }
      downloadJson(
        exportFileName(candidate),
        exportJson(buildExport(candidate, documents, new Date(), photo)),
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
      await eraseCandidate({
        data: { ...(await withToken()), orgId: org.id, candidateId: candidate.id },
      });
      toast.success(t("candidates.erase.done"));
      setEraseOpen(false);
      onErased();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {primary ? (
        <Button
          type="button"
          icon={<FileText />}
          onClick={() => setViewer({ open: true, document: primary })}
          aria-label={t("candidates.documents.view")}
          className={PHONE_ICON}
        >
          <span className="max-sm:sr-only">{t("candidates.documents.view")}</span>
        </Button>
      ) : null}
      {children}
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
            {t("similar.title")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportProfile()}>
            <Download />
            {t("candidates.export")}
          </DropdownMenuItem>
          {canEdit ? (
            candidate.status === "active" ? (
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
        candidateId={candidate.id}
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
        documentCount={documents.length}
        busy={busy}
        onConfirm={erase}
      />
    </>
  );
}
