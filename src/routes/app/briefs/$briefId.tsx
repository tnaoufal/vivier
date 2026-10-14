/**
 * /app/briefs/:briefId: the brief page under a slim sticky header (the
 * title, its status, when it changed, the way to delete it), in two
 * columns from `lg`. On the left, the brief itself (title, the need,
 * the status), the role profile a senior recruiter would write (derived
 * by the model, edited by the team) and the criteria (with the model's
 * proposals when one is set up). On the right, the analysis of the
 * talent pool: every profile read as a trajectory against the job, the
 * retained ones challenged and tiered, only the ones to present and to
 * dig into put forward. Live through realtime on this brief.
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
import { RoleProfileCard } from "@/components/briefs/role-profile-card";
import { SearchPanel } from "@/components/briefs/search-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

  const brief = useQuery(`brief:${org.id}:${briefId}`, async () =>
    readBrief(await requireSupabase(), org.id, briefId),
  );
  // Read once per organisation: whether a model can propose criteria and assess results.
  const capabilities = useQuery(`brief-capabilities:${org.id}`, async () =>
    briefCapabilities({ data: { ...(await withToken()), orgId: org.id } }),
  );
  // Unknown (null) while loading or when the read failed: "no model" is only said when the server said so.
  const modelAvailable: ModelAvailability = capabilities.error
    ? null
    : (capabilities.data?.model ?? null);

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
      <div className="space-y-8" aria-busy="true">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-1/2 max-w-sm" />
        </div>
        <div className="grid gap-6 lg:grid-cols-5 lg:gap-8">
          <div className="space-y-6 lg:col-span-2">
            <div className="sheet space-y-4 p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-10 w-full rounded-full" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
            <div className="sheet space-y-3 p-6">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
            </div>
          </div>
          <div className="sheet space-y-4 p-6 lg:col-span-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-10 w-40 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <EmptyState
        title={t("briefs.notFound.title")}
        text={t("briefs.notFound.text")}
        action={backLink}
      />
    );
  }

  return (
    <div>
      <PageHeader
        sticky
        eyebrow={
          <Link
            to="/app/briefs"
            className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("nav.briefs")}
          </Link>
        }
        title={row.title}
        meta={
          <>
            <BriefStatusPill status={row.status} size="sm" />
            <span className="text-meta text-muted-foreground">
              {t("briefs.list.updated", { date: formatDate(locale, row.updated_at) })}
            </span>
          </>
        }
        actions={
          canDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setDeleteOpen(true)}
                  aria-label={t("briefs.delete")}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("briefs.delete")}</TooltipContent>
            </Tooltip>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-5 lg:gap-8">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <BriefForm brief={row} canEdit={canEdit} onSaved={refreshBrief} />
          <RoleProfileCard
            brief={row}
            canEdit={canEdit}
            modelAvailable={modelAvailable}
            onSaved={refreshBrief}
          />
          <CriteriaEditor
            brief={row}
            canEdit={canEdit}
            modelAvailable={modelAvailable}
            onSaved={refreshBrief}
            onDirtyChange={setCriteriaDirty}
          />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <SearchPanel
            brief={row}
            canEdit={canEdit}
            criteriaDirty={criteriaDirty}
            modelAvailable={modelAvailable}
          />
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
