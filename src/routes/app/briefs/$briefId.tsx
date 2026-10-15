/**
 * /app/briefs/:briefId on the plane: the header carries the way back,
 * the title, the status when it is not simply open and when the brief
 * changed, the one filled button ("Analyser", then "Relancer"; held
 * while a run goes; outline while the state block carries Reprendre or
 * Réessayer, or while the shortlist's "Partager la shortlist" is the
 * filled one), the thread's toggle and a menu (the full text, the form,
 * the shares, close or reopen, delete for an administrator). Three
 * panes: the list (the brief folded, where the analysis stands, the
 * four groups as a segmented control and the rows of the one chosen:
 * the matches, the near profiles, the shortlist with its filter, the
 * profiles set aside), the reading of the selected profile, and the
 * team's thread on the brief (on the selected shortlisted candidate
 * when the person switches to it). The URL keeps the group (`g`) and
 * the selected profile (`c`): a refresh or a shared link lands on the
 * same row; from `lg` the first row of a group is selected when the
 * URL names none, below `lg` a tap opens the reading in a full sheet.
 * A brief just created (`?run=1`) starts its analysis once on mount
 * when the person may run one and none exists, and the param leaves
 * the URL. Retaining or dismissing takes one click from any row or the
 * reading: a match enters the shortlist straight with its decision (the
 * database stamps who and when) and counts there at once. Live through
 * realtime on this brief, its searches, its shortlist, its items and
 * the team's comments; a refresh that fails keeps the page and says so.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  FileText,
  ListChecks,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PHONE_ICON, Pane, Workspace } from "@/components/app-shell/workspace";
import { AnalysisState } from "@/components/briefs/analysis/analysis-state";
import { GroupRows } from "@/components/briefs/analysis/group-rows";
import { ProfileReading } from "@/components/briefs/analysis/profile-reading";
import { useAnalysis } from "@/components/briefs/analysis/use-analysis";
import { useSetAside } from "@/components/briefs/analysis/use-set-aside";
import { BriefForm } from "@/components/briefs/brief-form";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { BriefText } from "@/components/briefs/brief-text";
import { ShareDialog } from "@/components/share/share-dialog";
import { SharesPanel } from "@/components/share/shares-panel";
import { useBoard } from "@/components/shortlist/use-board";
import { ThreadPane, ThreadToggle, useThreadPane } from "@/components/thread/thread-pane";
import { useDesktop } from "@/components/thread/use-desktop";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { briefCapabilities } from "@/lib/briefs/briefs.functions";
import { briefChangedSince } from "@/lib/briefs/presentation";
import { deleteBrief, readBrief, updateBrief } from "@/lib/briefs/queries";
import { displayName } from "@/lib/candidates/format";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefRow, BriefStatus, MatchResult, ShortlistItemStatus } from "@/lib/db/types";
import { formatDate, useI18n, type TranslationKey } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { withToken } from "@/lib/platform/call";
import { listShares } from "@/lib/shares/queries";
import {
  SHORTLIST_FILTERS,
  filterItems,
  type ShortlistFilter,
} from "@/lib/shortlists/decision-line";
import {
  BRIEF_GROUPS,
  groupCountsOf,
  groupOfSearch,
  selectionOf,
  subjectIds,
  type BriefGroup,
  type ReadingSubject,
} from "@/lib/shortlists/groups";
import type { BoardItem } from "@/lib/shortlists/queries";
import { useTeamMembers } from "@/lib/shortlists/use-members";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The search params: the group shown (`g`, the matches when absent),
 * the selected profile (`c`), and `run=1` when the page was opened to
 * analyse at once (a brief just created). `tab` is the old name of the
 * group, still accepted from the links written before (read, never
 * written back).
 */
interface BriefSearch {
  g?: BriefGroup;
  c?: string;
  run?: 1;
  tab?: "matches" | "shortlist";
}

export const Route = createFileRoute("/app/briefs/$briefId")({
  // Everything optional, so every link to a brief stays valid without naming a group.
  validateSearch: (search: Record<string, unknown>): BriefSearch => {
    const out: BriefSearch = {};
    const group = groupOfSearch(search);
    if (group !== "matches") out.g = group;
    const c = search["c"];
    if (typeof c === "string" && c.length > 0) out.c = c;
    const run = search["run"];
    if (run === 1 || run === "1" || run === true) out.run = 1;
    return out;
  },
  component: BriefPage,
});

const GROUP_KEYS: Record<BriefGroup, TranslationKey> = {
  matches: "briefs.group.matches",
  near: "briefs.group.near",
  shortlist: "briefs.group.shortlist",
  aside: "briefs.group.aside",
};

const FILTER_KEYS: Record<ShortlistFilter, TranslationKey> = {
  all: "common.all",
  to_review: "shortlists.status.to_review",
  retained: "shortlists.status.retained",
  dismissed: "shortlists.status.dismissed",
};

/** The empty line of the shortlist group, by filter. */
const SHORTLIST_EMPTY_KEYS: Record<ShortlistFilter, TranslationKey> = {
  all: "shortlists.board.empty.title",
  to_review: "shortlists.section.empty.to_review",
  retained: "shortlists.section.empty.retained",
  dismissed: "shortlists.section.empty.dismissed",
};

function emptyKeyOf(filter: ShortlistFilter): TranslationKey {
  return SHORTLIST_EMPTY_KEYS[filter];
}

const SKELETON = "[&>li]:min-h-14 [&>li]:px-3 [&>li]:py-2";

/** The search of a link to this page: the group when it is not the matches, the profile when one is named. */
function searchOf(group: BriefGroup, c?: string | undefined): BriefSearch {
  const out: BriefSearch = {};
  if (group !== "matches") out.g = group;
  if (c !== undefined) out.c = c;
  return out;
}

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
  // A refresh that fails with the brief on screen says so and the page stays: an analysis under way keeps running.
  const refreshFailed = brief.error !== null && brief.data !== null;
  useEffect(() => {
    if (refreshFailed) toast.error(t("common.error"));
  }, [refreshFailed, t]);

  // The way back is the header's eyebrow in every state: the header keeps its place while the brief loads, fails or is missing.
  const eyebrow = (
    <Link
      to="/app/briefs"
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("nav.briefs")}
    </Link>
  );

  if (brief.error && !brief.data) {
    return (
      <Workspace eyebrow={eyebrow} title={t("briefs.title")}>
        <Pane label={t("briefs.title")} width="fill">
          <EmptyState
            quiet
            icon={<TriangleAlert />}
            title={t("briefs.loadError")}
            action={
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw />}
                onClick={() => void refreshBrief()}
              >
                {t("common.retry")}
              </Button>
            }
          />
        </Pane>
      </Workspace>
    );
  }

  if (brief.loading && !brief.data) {
    return (
      <Workspace
        eyebrow={eyebrow}
        title={
          <span
            className="skeleton inline-block h-5 w-56 max-w-full rounded-sm align-middle"
            aria-hidden="true"
          />
        }
      >
        <Pane label={t("briefs.title")} width="list">
          <p className="sr-only">{t("common.loading")}</p>
          <SkeletonRows rows={6} avatarSize="md" className={SKELETON} />
        </Pane>
        <Pane label={t("briefs.reading.label")} width="fill" className="max-lg:hidden">
          <span />
        </Pane>
      </Workspace>
    );
  }

  const row = brief.data ?? null;
  if (!row) {
    return (
      <Workspace eyebrow={eyebrow} title={t("briefs.title")}>
        <Pane label={t("briefs.title")} width="fill">
          <EmptyState
            quiet
            icon={<TriangleAlert />}
            title={t("briefs.notFound.title")}
            action={
              <Button asChild variant="outline">
                <Link to="/app/briefs">{t("briefs.back")}</Link>
              </Button>
            }
          />
        </Pane>
      </Workspace>
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
  const { g, c, run } = Route.useSearch();
  const group: BriefGroup = g ?? "matches";
  const navigate = useNavigate();
  const desktop = useDesktop();
  const { can } = useOrg();
  const { user } = useAuth();
  const members = useTeamMembers();
  const canEdit = can("member");
  const canDelete = can("admin");
  const thread = useThreadPane();

  const [editOpen, setEditOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [sharesOpen, setSharesOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [filter, setFilter] = useState<ShortlistFilter>("all");
  // The analysis the text was edited after, in this session: the state block says the brief changed until the next run.
  const [editedAfter, setEditedAfter] = useState<string | null>(null);
  // The thread shown beside a shortlisted candidate: the person's by default, the brief's on demand.
  const [threadChoice, setThreadChoice] = useState<"brief" | "item">("item");
  // The profiles a row put on the shortlist since the last read, with the decision they entered with.
  const [pending, setPending] = useState<ReadonlyMap<string, ShortlistItemStatus>>(() => new Map());
  const [busyResultId, setBusyResultId] = useState<string | null>(null);

  // Read once per organisation: whether a model reads the brief and the profiles.
  const capabilities = useQuery(`brief-capabilities:${brief.org_id}`, async () =>
    briefCapabilities({ data: { ...(await withToken()), orgId: brief.org_id } }),
  );
  // Unknown (null) while loading or when the read failed: "no model" is only said when the server said so.
  const modelAvailable: boolean | null = capabilities.error
    ? null
    : (capabilities.data?.model ?? null);

  const showGroup = useCallback(
    (next: BriefGroup) => {
      void navigate({
        to: "/app/briefs/$briefId",
        params: { briefId: brief.id },
        search: searchOf(next),
        replace: true,
      });
    },
    [brief.id, navigate],
  );
  const showMatches = useCallback(() => showGroup("matches"), [showGroup]);

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
      search: searchOf(group, c),
      replace: true,
    });
  }, [analysis.latestLoading, brief.id, c, group, navigate, run]);

  const board = useBoard({
    orgId: brief.org_id,
    shortlistId: analysis.shortlistId,
    enabled: group === "shortlist",
  });

  const { view, band, screened } = analysis;
  const wholePool = view?.method === "triage";
  const textOnly = band === "textOnly";
  const canReadAnyway = canEdit && wholePool && modelAvailable !== false;
  const setAside = useSetAside({
    orgId: brief.org_id,
    searchId: view?.id ?? null,
    triageCount: wholePool ? (analysis.triage?.no ?? 0) + (analysis.triage?.unknown ?? 0) : 0,
    read: analysis.setAside,
    enabled: group === "aside",
  });

  // The shares made from the shortlist, counted for the menu; the panel in its sheet reads them in full.
  const shortlistId = analysis.shortlistId;
  const shares = useQuery(
    `brief-shares:${brief.org_id}:${shortlistId ?? ""}`,
    async () => (shortlistId ? listShares(await requireSupabase(), brief.org_id, shortlistId) : []),
    shortlistId !== null,
  );
  const refreshShares = shares.refresh;
  useEffect(() => {
    if (!shortlistId) return undefined;
    // shares is not in the realtime publication; the activities every change writes are.
    let latest: Record<string, unknown> | null = null;
    const soon = debounce(() => {
      const kind = latest?.["kind"];
      if (typeof kind === "string" && kind.startsWith("share.")) void refreshShares();
    }, 300);
    return subscribeToTable("activities", `org_id=eq.${brief.org_id}`, (change) => {
      latest = change.new;
      soon();
    });
  }, [brief.org_id, refreshShares, shortlistId]);
  const sharesCount = shares.data?.length ?? 0;

  // The brief's text changed since the analysis on screen ran: saved here, or read off the row (a colleague's edit too).
  const briefStale = view !== null && (editedAfter === view.id || briefChangedSince(brief));

  // ---------------------------------------------------------------------
  // the rows of the group on screen
  // ---------------------------------------------------------------------

  const main = textOnly ? analysis.ranking : analysis.matches;
  const matchSubjects = useMemo<ReadingSubject[]>(
    () => main.map((result) => ({ kind: "result", candidateId: result.candidateId, result })),
    [main],
  );
  const near = textOnly ? [] : analysis.near;
  const screenedRows = textOnly ? [] : screened.rows;
  const nearSubjects = useMemo<ReadingSubject[]>(
    () => [
      ...near.map(
        (result): ReadingSubject => ({ kind: "result", candidateId: result.candidateId, result }),
      ),
      ...screenedRows.map(
        (entry): ReadingSubject => ({
          kind: "screened",
          candidateId: entry.candidateId,
          score: entry.score,
          reason: entry.reason,
        }),
      ),
    ],
    [near, screenedRows],
  );
  const shortlistSubjects = useMemo<ReadingSubject[]>(
    () =>
      filterItems(board.items, filter).map((item) => ({
        kind: "item",
        candidateId: item.candidate_id,
        item,
      })),
    [board.items, filter],
  );
  const subjects: readonly ReadingSubject[] =
    group === "matches"
      ? matchSubjects
      : group === "near"
        ? nearSubjects
        : group === "shortlist"
          ? shortlistSubjects
          : setAside.subjects;
  const boardPeople = useMemo(
    () => new Map(board.items.map((item) => [item.candidate_id, item.candidates] as const)),
    [board.items],
  );
  const candidateOf =
    group === "aside"
      ? setAside.candidateOf
      : group === "shortlist"
        ? (candidateId: string) => boardPeople.get(candidateId) ?? null
        : analysis.candidateOf;

  const ids = useMemo(() => subjectIds(subjects), [subjects]);
  const selection = selectionOf(ids, c);
  // From `lg` a group always shows a profile; below, nothing until a tap.
  const selectedId = desktop ? selection.id : c !== undefined && ids.includes(c) ? c : null;
  const selected = selectedId
    ? (subjects.find((subject) => subject.candidateId === selectedId) ?? null)
    : null;

  const select = useCallback(
    (candidateId: string | null) => {
      void navigate({
        to: "/app/briefs/$briefId",
        params: { briefId: brief.id },
        search: searchOf(group, candidateId ?? undefined),
        // A tap on a phone opens the sheet: the back gesture closes it. A desk keeps one entry.
        replace: desktop || candidateId === null,
      });
    },
    [brief.id, desktop, group, navigate],
  );

  // The URL names no row of the group (or one gone): it is rewritten to the first, from `lg`.
  useEffect(() => {
    if (!desktop || !selection.stale || selection.id === null) return;
    void navigate({
      to: "/app/briefs/$briefId",
      params: { briefId: brief.id },
      search: searchOf(group, selection.id),
      replace: true,
    });
  }, [brief.id, desktop, group, navigate, selection.id, selection.stale]);

  // Another profile: the thread goes back to the person's.
  const selectedItem: BoardItem | null = selected?.kind === "item" ? selected.item : null;
  const selectedItemId = selectedItem?.id ?? null;
  useEffect(() => {
    setThreadChoice("item");
  }, [selectedItemId]);
  const threadTarget = useMemo(
    () =>
      selectedItemId && threadChoice === "item"
        ? { shortlistItemId: selectedItemId }
        : { briefId: brief.id },
    [brief.id, selectedItemId, threadChoice],
  );
  const selectedCandidate = selected ? candidateOf(selected.candidateId) : undefined;
  const selectedName = selectedCandidate
    ? displayName(selectedCandidate, t("briefs.results.noName"))
    : selectedCandidate === null
      ? t("briefs.results.gone")
      : "";

  // ---------------------------------------------------------------------
  // the decisions, in one click
  // ---------------------------------------------------------------------

  // A profile the read confirms on the shortlist leaves the pending ones.
  const { addedIds } = analysis;
  useEffect(() => {
    setPending((current) => {
      if (![...current.keys()].some((id) => addedIds.has(id))) return current;
      return new Map([...current].filter(([id]) => !addedIds.has(id)));
    });
  }, [addedIds]);

  const decideResult = useCallback(
    async (result: MatchResult, status: ShortlistItemStatus): Promise<boolean> => {
      setBusyResultId(result.candidateId);
      setPending((current) => new Map(current).set(result.candidateId, status));
      const stored = await analysis.add(result, status);
      if (!stored)
        setPending((current) => {
          const next = new Map(current);
          next.delete(result.candidateId);
          return next;
        });
      setBusyResultId(null);
      return stored;
    },
    [analysis],
  );

  const readAnyway = useCallback(
    async (candidateId: string): Promise<boolean> => {
      setBusyResultId(candidateId);
      const done = await analysis.readAnyway(candidateId);
      if (done) setAside.drop(candidateId);
      setBusyResultId(null);
      return done;
    },
    [analysis, setAside],
  );

  const openThread = useCallback(
    (item: BoardItem) => {
      if (item.candidate_id !== selectedId) select(item.candidate_id);
      setThreadChoice("item");
      thread.setOpen(true);
    },
    [select, selectedId, thread],
  );

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

  // ---------------------------------------------------------------------
  // the header
  // ---------------------------------------------------------------------

  const counts = groupCountsOf({
    matches: main.length,
    near: near.length,
    screened: textOnly ? 0 : screened.total,
    shortlisted: addedIds,
    pending: pending.keys(),
    setAside: analysis.funnel.setAside,
  });
  // No analysis ran yet (and the look-up did not fail): the matches' empty state carries the filled "Analyser", the header's steps back.
  const noAnalysis =
    analysis.latest === null &&
    !analysis.latestLoading &&
    !analysis.loadFailed &&
    !analysis.starting;
  const emptyCarriesRun = canEdit && group === "matches" && noAnalysis;
  // The shortlist's own filled button once someone is retained: the header's run button steps back to outline.
  const shareable = canEdit && shortlistId !== null && analysis.retained > 0;
  const runLabel = analysis.running
    ? t("briefs.search.running")
    : view || analysis.latest
      ? t("briefs.search.rerun")
      : t("briefs.search.run");
  const runVariant: "primary" | "outline" =
    (group === "shortlist" && shareable) || analysis.canResume || emptyCarriesRun
      ? "outline"
      : "primary";
  /** The one way to run the analysis: in the header it shrinks to its icon on a phone. */
  const runButton = (variant: "primary" | "outline", inHeader: boolean) => (
    <Button
      type="button"
      variant={variant}
      icon={<Sparkles />}
      onClick={() => void analysis.run()}
      disabled={!analysis.canRun}
      aria-busy={analysis.running || undefined}
      aria-label={inHeader ? runLabel : undefined}
      className={inHeader ? PHONE_ICON : undefined}
    >
      <span className={inHeader ? "max-sm:sr-only" : undefined}>{runLabel}</span>
    </Button>
  );

  const groupLabel = t(GROUP_KEYS[group]);
  const provisional =
    band === "queued" || band === "running" || band === "stopped" || band === "failed";
  const opening = analysis.opening || (view === null && analysis.latestLoading);
  // While a new search is stored the previous analysis's rows step aside: the state block says what runs.
  const rowsShown = view !== null && !analysis.starting;

  /** The group's rows, or what stands in their place: a skeleton, an empty state, an error. */
  function rows(): ReactNode {
    const list = (
      <GroupRows
        group={group}
        subjects={subjects}
        candidateOf={candidateOf}
        selectedId={selectedId}
        onSelect={select}
        label={groupLabel}
        canEdit={canEdit}
        provisional={provisional}
        addedIds={addedIds}
        pendingIds={new Set(pending.keys())}
        onAdd={(result) => decideResult(result, "to_review")}
        canReadAnyway={canReadAnyway}
        onReadAnyway={readAnyway}
        onDecide={(item, status) => board.decide(item.id, status)}
        busyItemId={board.busyId}
        threadCounts={board.threadCounts}
        onOpenThread={openThread}
        criteria={view?.criteria ?? []}
      />
    );
    const retry = (onClick: () => void) => (
      <Button type="button" variant="outline" icon={<RefreshCw />} onClick={onClick}>
        {t("common.retry")}
      </Button>
    );
    if (group === "shortlist") {
      if (board.failed)
        return (
          <EmptyState
            quiet
            icon={<TriangleAlert />}
            title={t("shortlists.boardError")}
            action={retry(board.retry)}
          />
        );
      if (board.loading) return <SkeletonRows rows={4} avatarSize="md" className={SKELETON} />;
      if (subjects.length === 0)
        return <EmptyState quiet icon={<ListChecks />} title={t(emptyKeyOf(filter))} />;
      return list;
    }
    if (group === "aside") {
      if (setAside.loading) return <SkeletonRows rows={6} avatarSize="md" className={SKELETON} />;
      if (subjects.length === 0)
        return setAside.failed ? (
          <EmptyState
            quiet
            icon={<TriangleAlert />}
            title={t("briefs.listError")}
            action={retry(() => void setAside.retry())}
          />
        ) : (
          <EmptyState quiet icon={<Users />} title={t("briefs.setAside.empty")} />
        );
      return list;
    }
    // The near profiles the screening scored arrive with their first page: placeholders until it lands.
    if (opening || (group === "near" && screened.loading && subjects.length === 0))
      return <SkeletonRows rows={6} avatarSize="md" className={SKELETON} />;
    if (!rowsShown || subjects.length === 0)
      return (
        <EmptyState
          quiet
          icon={<Users />}
          title={t(group === "near" ? "briefs.group.empty.near" : "briefs.group.empty.matches")}
          action={emptyCarriesRun ? runButton("primary", false) : undefined}
        />
      );
    return list;
  }

  /** Under the rows: the next page of a list read page by page, or the way to read a failed page again. */
  function footer(): ReactNode {
    const paged =
      group === "aside"
        ? {
            failed: setAside.failed && subjects.length > 0,
            hasMore: setAside.hasMore,
            busy: setAside.busy,
            more: () => void setAside.more(),
            retry: () => void setAside.retry(),
          }
        : group === "near"
          ? {
              failed: screened.failed,
              hasMore: screened.hasMore,
              busy: screened.loading,
              more: () => void screened.more(),
              retry: () => void screened.retry(),
            }
          : null;
    if (!paged || (!paged.failed && !paged.hasMore)) return undefined;
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        {paged.failed ? (
          <p className="min-w-0 text-sm text-ink">{t("briefs.listError")}</p>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={paged.failed ? <RefreshCw /> : undefined}
          onClick={paged.failed ? paged.retry : paged.more}
          disabled={paged.busy}
          aria-busy={paged.busy || undefined}
          className="text-muted-foreground hover:text-ink"
        >
          {t(paged.failed ? "common.retry" : "briefs.list.next")}
        </Button>
      </div>
    );
  }

  const reading = (onBack?: () => void) => (
    <ProfileReading
      subject={selected}
      candidate={selectedCandidate}
      criteria={view?.criteria ?? []}
      orgId={brief.org_id}
      canEdit={canEdit}
      provisional={provisional}
      canReadAnyway={canReadAnyway}
      busy={
        selected
          ? selected.kind === "item"
            ? board.busyId === selected.item.id
            : busyResultId === selected.candidateId
          : false
      }
      onDecide={(status) => {
        if (!selected) return Promise.resolve(false);
        if (selected.kind === "item") return board.decide(selected.item.id, status);
        if (selected.kind === "result") return decideResult(selected.result, status);
        return Promise.resolve(false);
      }}
      onReadAnyway={readAnyway}
      onBack={onBack}
    />
  );

  return (
    <Workspace
      eyebrow={eyebrow}
      title={brief.title}
      meta={
        <>
          {/* Open is the rule: only another state is worth a pill. */}
          {brief.status !== "open" ? <BriefStatusPill status={brief.status} size="sm" /> : null}
          <span>{t("briefs.list.updated", { date: formatDate(locale, brief.updated_at) })}</span>
        </>
      }
      actions={
        <>
          {group === "shortlist" && shareable ? (
            <Button
              type="button"
              icon={<Share2 />}
              onClick={() => setShareOpen(true)}
              aria-label={t("shortlists.share")}
              className={PHONE_ICON}
            >
              <span className="max-sm:sr-only">{t("shortlists.share")}</span>
            </Button>
          ) : null}
          {canEdit ? runButton(runVariant, true) : null}
          <ThreadToggle open={thread.open} onToggle={thread.toggle} target={threadTarget} />
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
              <DropdownMenuItem onSelect={() => setTextOpen(true)}>
                <FileText />
                {t("briefs.brief.show")}
              </DropdownMenuItem>
              {canEdit ? (
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil />
                  {t("common.edit")}
                </DropdownMenuItem>
              ) : null}
              {shortlistId && sharesCount > 0 ? (
                <DropdownMenuItem onSelect={() => setSharesOpen(true)}>
                  <Share2 />
                  {t("briefs.menu.shares", { count: sharesCount })}
                </DropdownMenuItem>
              ) : null}
              {canEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={statusBusy}
                    onSelect={() => void setStatus(brief.status === "closed" ? "open" : "closed")}
                  >
                    {brief.status === "closed" ? <ArchiveRestore /> : <Archive />}
                    {t(brief.status === "closed" ? "briefs.reopen" : "briefs.close")}
                  </DropdownMenuItem>
                </>
              ) : null}
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
        </>
      }
    >
      <Pane
        label={groupLabel}
        width="list"
        header={
          <>
            <BriefText
              brief={brief}
              canEdit={canEdit}
              onShow={() => setTextOpen(true)}
              onEdit={() => setEditOpen(true)}
              className="border-b border-line"
            />
            <AnalysisState
              analysis={analysis}
              canEdit={canEdit}
              modelAvailable={modelAvailable}
              briefStale={briefStale}
            />
            <div className="px-4 pb-3">
              <Segmented
                size="sm"
                value={group}
                onChange={showGroup}
                aria-label={t("briefs.groups.label")}
                className="max-w-full"
                options={BRIEF_GROUPS.map((value) => ({
                  value,
                  label: t(GROUP_KEYS[value]),
                  count: counts[value],
                }))}
              />
            </div>
            {group === "shortlist" ? (
              <div
                role="group"
                aria-label={t("shortlists.filter.label")}
                className="flex flex-wrap gap-1.5 px-4 pb-3"
              >
                {SHORTLIST_FILTERS.map((value) => {
                  const active = value === filter;
                  const count =
                    value === "all"
                      ? board.items.length
                      : board.items.filter((item) => item.status === value).length;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(value)}
                      className={cn(
                        "press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-ink bg-ink text-background"
                          : "border-input text-muted-foreground hover:text-ink",
                      )}
                    >
                      {t(FILTER_KEYS[value])}
                      <span className="font-normal tabular-nums">
                        {/* Keeps the label and the count two words in the accessible name ("Retenus, 2"). */}
                        <span className="sr-only">, </span>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        }
        footer={footer()}
      >
        {rows()}
      </Pane>

      <Pane
        label={t("briefs.reading.label")}
        width="fill"
        className="max-lg:hidden"
        bodyClassName="flex flex-col"
      >
        {reading()}
      </Pane>

      <ThreadPane
        target={threadTarget}
        title={selectedItemId && threadChoice === "item" ? selectedName : undefined}
        canPost={canEdit}
        members={members}
        currentUserId={user?.id ?? null}
        open={thread.open}
        onOpenChange={thread.setOpen}
      >
        {selectedItemId ? (
          <Segmented
            size="sm"
            value={threadChoice}
            onChange={setThreadChoice}
            aria-label={t("briefs.thread.label")}
            className="max-w-full"
            options={[
              { value: "brief", label: t("briefs.thread.brief") },
              { value: "item", label: selectedName.split(" ")[0] || selectedName },
            ]}
          />
        ) : undefined}
      </ThreadPane>

      {/* Below `lg` the reading opens over the list; the back arrow and the sheet's close lead back. */}
      <Sheet
        open={!desktop && selected !== null}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
      >
        <SheetContent
          side="right"
          size="full"
          className="flex flex-col gap-0 overflow-hidden p-0 sm:p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{selectedName || t("briefs.reading.label")}</SheetTitle>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {reading(() => select(null))}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={textOpen} onOpenChange={setTextOpen}>
        <SheetContent
          side="right"
          size="md"
          className="flex flex-col gap-6 overflow-hidden"
          aria-describedby={undefined}
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>{brief.title}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <p
              className={cn(
                "whitespace-pre-line text-body break-words",
                brief.description.trim() ? "text-ink" : "text-muted-foreground",
              )}
            >
              {brief.description.trim() || t("briefs.list.noDescription")}
            </p>
          </SheetBody>
        </SheetContent>
      </Sheet>

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
              if (textChanged && view) setEditedAfter(view.id);
              await onSaved();
            }}
            onCancel={() => setEditOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {shortlistId ? (
        <Sheet open={sharesOpen} onOpenChange={setSharesOpen}>
          <SheetContent
            side="right"
            size="md"
            className="flex flex-col gap-6 overflow-hidden"
            aria-describedby={undefined}
          >
            {/* The panel draws its own title; the dialog's stays for assistive technologies. */}
            <SheetTitle className="sr-only">{t("shares.panel.title")}</SheetTitle>
            <SheetBody className="pt-1">
              <SharesPanel shortlistId={shortlistId} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}

      {shortlistId ? (
        <ShareDialog
          shortlistId={shortlistId}
          briefTitle={brief.title}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}

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
    </Workspace>
  );
}
