/**
 * /app/briefs/:briefId: the brief page, one page and no left module. A
 * slim sticky header carries the title, the status, when it changed,
 * the one filled action ("Lancer l'analyse", then "Relancer"; held
 * while one runs) and a menu (edit the brief, close or reopen it,
 * delete it for administrators), with the way to the team's thread on
 * a phone. Under it, the brief folded to three lines, then two tabs
 * kept in the URL (`?tab=matches|shortlist`): "Correspondances" with
 * the count of the matches, and "Shortlist" with the count of the
 * candidates retained (the board loads itself); from `lg` the team's
 * thread on the brief is the right column, sticky, and a drawer on a
 * phone. A brief just created (`?run=1`) starts its analysis once on
 * mount when the person may run one and none exists, and the param
 * leaves the URL. A brief edited since the analysis on screen ran says
 * so in the band, the header's button runs it again. Live through
 * realtime on this brief.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Sparkles, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { MatchesTab } from "@/components/briefs/analysis/matches-tab";
import { useAnalysis } from "@/components/briefs/analysis/use-analysis";
import { BriefForm } from "@/components/briefs/brief-form";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { BriefText } from "@/components/briefs/brief-text";
import { ShortlistBoard } from "@/components/shortlist/board";
import { ThreadButton, ThreadPanel } from "@/components/thread/thread-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { briefCapabilities } from "@/lib/briefs/briefs.functions";
import { briefChangedSince } from "@/lib/briefs/presentation";
import { deleteBrief, readBrief, updateBrief } from "@/lib/briefs/queries";
import { formatCount } from "@/lib/candidates/format";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefRow, BriefStatus } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/platform/call";
import { useTeamMembers } from "@/lib/shortlists/use-members";
import { toast } from "@/lib/toast";

/** The two views of a brief: its matches, its shortlist. */
type BriefTab = "matches" | "shortlist";

function isBriefTab(value: unknown): value is BriefTab {
  return value === "matches" || value === "shortlist";
}

/** The search params: the tab shown, and `run=1` when the page was opened to analyse at once (a brief just created). */
interface BriefSearch {
  tab?: BriefTab;
  run?: 1;
}

export const Route = createFileRoute("/app/briefs/$briefId")({
  // Both optional, so every link to a brief stays valid without naming a tab.
  validateSearch: (search: Record<string, unknown>): BriefSearch => {
    const out: BriefSearch = {};
    const tab = search["tab"];
    if (isBriefTab(tab)) out.tab = tab;
    const run = search["run"];
    if (run === 1 || run === "1" || run === true) out.run = 1;
    return out;
  },
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
          <div className="sheet space-y-3 p-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
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
  const { tab: tabParam, run } = Route.useSearch();
  const navigate = useNavigate();
  const { can } = useOrg();
  const { user } = useAuth();
  const members = useTeamMembers();
  const canEdit = can("member");
  const canDelete = can("admin");

  const [threadOpen, setThreadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  // The analysis the text was edited after, in this session: the band says the brief changed until the next run.
  const [editedAfter, setEditedAfter] = useState<string | null>(null);
  const target = useMemo(() => ({ briefId: brief.id }), [brief.id]);

  // Read once per organisation: whether a model reads the brief and the profiles.
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
  const showShortlist = useCallback(() => showTab("shortlist"), [showTab]);

  const analysis = useAnalysis({
    brief,
    canEdit,
    modelAvailable,
    runOnMount: run === 1,
    onStarted: showMatches,
  });

  // The run param is consumed once the newest analysis is known (the hook started one, or there was one already).
  useEffect(() => {
    if (run !== 1 || analysis.latestLoading) return;
    void navigate({
      to: "/app/briefs/$briefId",
      params: { briefId: brief.id },
      search: tabParam ? { tab: tabParam } : {},
      replace: true,
    });
  }, [analysis.latestLoading, brief.id, navigate, run, tabParam]);

  const tab: BriefTab = tabParam ?? "matches";
  const matchCount =
    analysis.view !== null
      ? analysis.band === "textOnly"
        ? null
        : analysis.matches.length
      : (analysis.latest?.match_count ?? null);
  // The brief's text changed since the analysis on screen ran: saved here, or read off the row (a colleague's edit too).
  const briefStale =
    analysis.view !== null && (editedAfter === analysis.view.id || briefChangedSince(brief));

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

  async function setStatus(status: BriefStatus) {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      await updateBrief(await requireSupabase(), brief.org_id, brief.id, { status });
      toast.success(t(status === "closed" ? "briefs.closed" : "briefs.reopened"));
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setStatusBusy(false);
    }
  }

  // The one filled button of the page, in every state: it reads the brief and runs the analysis, again once one exists.
  const runLabel = analysis.running
    ? t("briefs.search.running")
    : analysis.view || analysis.latest
      ? t("briefs.search.rerun")
      : t("briefs.search.run");
  const count = (value: number) => (
    <span className="font-normal text-muted-foreground tabular-nums">
      {/* Keeps the label and the count two words in the tab's name ("Correspondances, 12"). */}
      <span className="sr-only">, </span>
      {formatCount(locale, value)}
    </span>
  );

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
            {canEdit ? (
              <Button
                type="button"
                variant="primary"
                icon={<Sparkles />}
                onClick={() => void analysis.run()}
                disabled={!analysis.canRun}
                aria-busy={analysis.running || undefined}
                aria-label={runLabel}
                className={PHONE_ICON}
              >
                <span className="max-sm:sr-only">{runLabel}</span>
              </Button>
            ) : null}
            <ThreadButton target={target} onClick={() => setThreadOpen(true)} />
            {canEdit ? (
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
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil />
                    {t("briefs.brief.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={statusBusy}
                    onSelect={() => void setStatus(brief.status === "closed" ? "open" : "closed")}
                  >
                    {brief.status === "closed" ? <ArchiveRestore /> : <Archive />}
                    {t(brief.status === "closed" ? "briefs.reopen" : "briefs.close")}
                  </DropdownMenuItem>
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                        <Trash2 />
                        {t("briefs.delete")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
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
          <BriefText brief={brief} canEdit={canEdit} onEdit={() => setEditOpen(true)} />

          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (isBriefTab(value)) showTab(value);
            }}
          >
            <TabsList aria-label={t("briefs.tabs.label")}>
              <TabsTrigger value="matches">
                {t("briefs.tab.matches")}
                {matchCount !== null ? count(matchCount) : null}
              </TabsTrigger>
              <TabsTrigger value="shortlist">
                {t("briefs.tab.shortlist")}
                {analysis.retained > 0 ? count(analysis.retained) : null}
              </TabsTrigger>
            </TabsList>
            {/* The matches stay mounted behind the shortlist: an analysis under way keeps its rows. */}
            <TabsContent value="matches" forceMount className="mt-6 data-[state=inactive]:hidden">
              <MatchesTab
                analysis={analysis}
                orgId={brief.org_id}
                canEdit={canEdit}
                modelAvailable={modelAvailable}
                briefStale={briefStale}
                onShowShortlist={showShortlist}
              />
            </TabsContent>
            <TabsContent value="shortlist" className="mt-6">
              <ShortlistBoard briefId={brief.id} canEdit={canEdit} />
            </TabsContent>
          </Tabs>
        </div>
      </ThreadPanel>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent
          side="right"
          size="md"
          className="flex flex-col gap-6 overflow-hidden"
          aria-describedby={undefined}
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{t("briefs.brief.edit")}</SheetTitle>
          </SheetHeader>
          <BriefForm
            brief={brief}
            onSaved={async ({ textChanged }) => {
              setEditOpen(false);
              if (textChanged && analysis.view) setEditedAfter(analysis.view.id);
              await onSaved();
            }}
            onCancel={() => setEditOpen(false)}
          />
        </SheetContent>
      </Sheet>

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
