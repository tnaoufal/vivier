/**
 * /app/briefs/:briefId: the brief page in two parts. The brief itself
 * (title, description, status, criteria with the model's proposals when
 * one is set up) and the search of the talent pool with its explained
 * results. Live through realtime on this brief.
 */
import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { BriefForm } from "@/components/briefs/brief-form";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { CriteriaEditor } from "@/components/briefs/criteria-editor";
import type { ModelAvailability } from "@/components/briefs/criteria-proposals";
import { SearchPanel } from "@/components/briefs/search-panel";
import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { briefCapabilities } from "@/lib/briefs/briefs.functions";
import { deleteBrief, readBrief } from "@/lib/briefs/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/briefs/$briefId")({
  component: BriefPage,
});

function BriefPage() {
  const { briefId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");
  const canDelete = can("admin");

  const [criteriaDirty, setCriteriaDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const brief = useQuery(`brief:${org.id}:${briefId}`, async () => readBrief(await requireSupabase(), org.id, briefId));
  // Read once per organisation: whether a model can propose criteria and explain results.
  const capabilities = useQuery(`brief-capabilities:${org.id}`, async () =>
    briefCapabilities({ data: { ...(await withToken()), orgId: org.id } }),
  );
  const modelAvailable: ModelAvailability = capabilities.error ? false : (capabilities.data?.model ?? null);

  const refreshBrief = brief.refresh;
  useEffect(
    () =>
      subscribeToTable(
        "briefs",
        `id=eq.${briefId}`,
        debounce(() => {
          void refreshBrief();
        }, 400),
      ),
    [briefId, refreshBrief],
  );

  const row = brief.data ?? null;

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteBrief(await requireSupabase(), org.id, briefId);
      toast.success(t("briefs.deleted"));
      setDeleteOpen(false);
      void navigate({ to: "/app/briefs" });
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setDeleting(false);
    }
  }

  const backLink = (
    <Button asChild variant="outline">
      <Link to="/app/briefs">{t("briefs.back")}</Link>
    </Button>
  );

  if (brief.error) {
    return (
      <EmptyState
        title={t("briefs.loadError")}
        action={
          <Button type="button" variant="outline" onClick={() => void refreshBrief()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  }

  if (brief.loading && !brief.data) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-1/2 rounded" />
        <div className="sheet space-y-3 p-5">
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-24 w-full rounded" />
        </div>
      </div>
    );
  }

  if (!row) {
    return <EmptyState title={t("briefs.notFound.title")} text={t("briefs.notFound.text")} action={backLink} />;
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to="/app/briefs" className="hover:underline">
            {t("nav.briefs")}
          </Link>
        }
        title={row.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <BriefStatusPill status={row.status} />
            <span>{t("briefs.list.updated", { date: formatDate(locale, row.updated_at) })}</span>
          </span>
        }
        actions={
          canDelete ? (
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)} className="gap-1.5">
              <Trash2 />
              {t("briefs.delete")}
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <BriefForm brief={row} canEdit={canEdit} onSaved={refreshBrief} />
          <CriteriaEditor
            brief={row}
            canEdit={canEdit}
            modelAvailable={modelAvailable}
            onSaved={refreshBrief}
            onDirtyChange={setCriteriaDirty}
          />
        </div>
        <div className="lg:col-span-3">
          <SearchPanel brief={row} canEdit={canEdit} criteriaDirty={criteriaDirty} />
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("briefs.delete.title")}
        text={t("briefs.delete.text")}
        confirmLabel={t("common.delete")}
        destructive
        busy={deleting}
        onConfirm={remove}
      />
    </div>
  );
}
