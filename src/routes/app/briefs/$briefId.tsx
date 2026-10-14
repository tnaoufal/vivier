/**
 * /app/briefs/:briefId: the brief page. A slim sticky header carries the
 * title, the status, when it changed, the one filled action ("Lancer la
 * recherche", on both tabs, held while the criteria or the role profile
 * have unsaved edits, the tooltip saying why; once the team checked what
 * the model wrote, it is also what starts the analysis) and, for
 * administrators, a menu with the deletion. Under it, two tabs kept in
 * the URL (`?tab=matches|brief`; by default the matches once the brief
 * has an analysis, else the role): "Correspondances" with the matches
 * of the analysis on screen as its count, and "Le poste" (the brief, its
 * role profile and its criteria in one readable column). Both panels
 * stay mounted, so a criterion being typed survives a look at the
 * matches. Live through realtime on this brief.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Ellipsis, Sparkles, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { MatchesTab } from "@/components/briefs/analysis/matches-tab";
import { useAnalysis } from "@/components/briefs/analysis/use-analysis";
import { BriefForm } from "@/components/briefs/brief-form";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { CriteriaEditor } from "@/components/briefs/criteria-editor";
import { RoleProfileCard } from "@/components/briefs/role-profile-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { briefCapabilities } from "@/lib/briefs/briefs.functions";
import { deleteBrief, readBrief } from "@/lib/briefs/queries";
import { formatCount } from "@/lib/candidates/format";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

/** The two views of a brief. */
type BriefTab = "matches" | "brief";

function isBriefTab(value: unknown): value is BriefTab {
  return value === "matches" || value === "brief";
}

export const Route = createFileRoute("/app/briefs/$briefId")({
  // Optional, so every link to a brief stays valid without naming a tab.
  validateSearch: (search: Record<string, unknown>): { tab?: BriefTab } =>
    isBriefTab(search["tab"]) ? { tab: search["tab"] } : {},
  component: BriefPage,
});

/** The phone keeps the icon of a header button and hides its words (the button keeps its name). */
const PHONE_ICON = "max-sm:size-10 max-sm:px-0";

function BriefPage() {
  const { briefId } = Route.useParams();
  const { t } = useI18n();
  const { org } = useCurrentOrg();

  const brief = useQuery(`brief:${org.id}:${briefId}`, async () =>
    readBrief(await requireSupabase(), org.id, briefId),
  );
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

  // The way back is the header's eyebrow in every state: the header keeps its place while the brief loads, fails or is missing.
  const eyebrow = (
    <Link
      to="/app/briefs"
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("nav.briefs")}
    </Link>
  );

  if (brief.error) {
    return (
      <div>
        <PageHeader sticky eyebrow={eyebrow} title={t("briefs.title")} />
        <EmptyState
          title={t("briefs.loadError")}
          action={
            <Button type="button" variant="outline" onClick={() => void refreshBrief()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  if (brief.loading && !brief.data) {
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
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-10 w-72 max-w-full rounded-full" />
          <div className="sheet space-y-3 p-6">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-48 max-w-full" />
          </div>
        </div>
      </div>
    );
  }

  const row = brief.data ?? null;
  if (!row) {
    return (
      <div>
        <PageHeader sticky eyebrow={eyebrow} title={t("briefs.title")} />
        <EmptyState
          title={t("briefs.notFound.title")}
          action={
            <Button asChild variant="outline">
              <Link to="/app/briefs">{t("briefs.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <BriefView brief={row} eyebrow={eyebrow} onSaved={refreshBrief} />;
}

function BriefView({
  brief,
  eyebrow,
  onSaved,
}: {
  brief: BriefRow;
  eyebrow: ReactNode;
  onSaved: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { tab: tabParam } = Route.useSearch();
  const navigate = useNavigate();
  const { can } = useOrg();
  const canEdit = can("member");
  const canDelete = can("admin");

  const [criteriaDirty, setCriteriaDirty] = useState(false);
  const [roleDirty, setRoleDirty] = useState(false);
  // A search reads the saved brief: unsaved edits in either editor hold it.
  const unsaved = criteriaDirty || roleDirty;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Read once per organisation: whether a model can propose criteria and read the profiles.
  const capabilities = useQuery(`brief-capabilities:${brief.org_id}`, async () =>
    briefCapabilities({ data: { ...(await withToken()), orgId: brief.org_id } }),
  );
  // Unknown (null) while loading or when the read failed: "no model" is only said when the server said so.
  const modelAvailable: boolean | null = capabilities.error
    ? null
    : (capabilities.data?.model ?? null);

  const showTab = useCallback(
    (tab: BriefTab) => {
      void navigate({
        to: "/app/briefs/$briefId",
        params: { briefId: brief.id },
        search: { tab },
        replace: true,
      });
    },
    [brief.id, navigate],
  );
  const showMatches = useCallback(() => showTab("matches"), [showTab]);

  const analysis = useAnalysis({
    brief,
    canEdit,
    criteriaDirty: unsaved,
    modelAvailable,
    onStarted: showMatches,
  });

  // Without a tab in the URL: the matches once the brief has an analysis (or while that is read), else the role.
  const hasAnalysis = analysis.view !== null || (analysis.searches?.length ?? 0) > 0;
  const tab: BriefTab = tabParam ?? (hasAnalysis || analysis.searchesLoading ? "matches" : "brief");
  const matchCount =
    analysis.view !== null
      ? analysis.band === "textOnly"
        ? null
        : analysis.matches.length
      : (analysis.searches?.[0]?.match_count ?? null);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteBrief(await requireSupabase(), brief.org_id, brief.id);
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

  // The one filled button of the page, in every state: after the team's
  // check of the model's draft it starts the analysis (anew when they changed the job).
  const runLabel = analysis.starting ? t("briefs.search.running") : t("briefs.search.run");
  const runButton = canEdit ? (
    <Button
      type="button"
      variant="primary"
      icon={<Sparkles />}
      onClick={() => void analysis.run()}
      disabled={!analysis.canRun}
      aria-label={runLabel}
      className={PHONE_ICON}
    >
      <span className="max-sm:sr-only">{runLabel}</span>
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        sticky
        eyebrow={eyebrow}
        title={brief.title}
        meta={
          <>
            <BriefStatusPill status={brief.status} size="sm" />
            <span className="text-meta text-muted-foreground">
              {t("briefs.list.updated", { date: formatDate(locale, brief.updated_at) })}
            </span>
          </>
        }
        actions={
          <>
            {runButton && unsaved ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* A disabled button takes no pointer: its wrapper carries the tooltip and the focus. */}
                  <span
                    tabIndex={0}
                    className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {runButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("briefs.search.saveFirst")}</TooltipContent>
              </Tooltip>
            ) : (
              runButton
            )}
            {canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    icon={<Ellipsis />}
                    aria-label={t("common.actions")}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                    <Trash2 />
                    {t("briefs.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isBriefTab(value)) showTab(value);
        }}
      >
        <TabsList aria-label={t("briefs.tabs.label")}>
          <TabsTrigger value="matches">
            {t("briefs.tab.matches")}
            {matchCount !== null ? (
              <span className="font-normal text-muted-foreground tabular-nums">
                {/* Keeps the label and the count two words in the tab's name ("Correspondances, 12"). */}
                <span className="sr-only">, </span>
                {formatCount(locale, matchCount)}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="brief">{t("briefs.tab.brief")}</TabsTrigger>
        </TabsList>
        <TabsContent value="matches" forceMount className="mt-6 data-[state=inactive]:hidden">
          <MatchesTab
            analysis={analysis}
            orgId={brief.org_id}
            canEdit={canEdit}
            modelAvailable={modelAvailable}
            onCheckRole={() => showTab("brief")}
          />
        </TabsContent>
        <TabsContent value="brief" forceMount className="mt-6 data-[state=inactive]:hidden">
          <div className="max-w-3xl space-y-6">
            <BriefForm brief={brief} canEdit={canEdit} onSaved={onSaved} />
            <RoleProfileCard
              brief={brief}
              canEdit={canEdit}
              modelAvailable={modelAvailable}
              onSaved={onSaved}
              onDirtyChange={setRoleDirty}
            />
            <CriteriaEditor
              brief={brief}
              canEdit={canEdit}
              modelAvailable={modelAvailable}
              onSaved={onSaved}
              onDirtyChange={setCriteriaDirty}
            />
          </div>
        </TabsContent>
      </Tabs>

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
