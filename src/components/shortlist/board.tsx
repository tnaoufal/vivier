/**
 * The shortlist of a brief, under the brief page's Shortlist tab. It
 * loads itself: the brief's shortlist (created on first use by a
 * member), its items with their candidate and the thread's count per
 * item, live on the shortlist's items and the organisation's comments.
 * Three columns from lg (to examine, retained, dismissed), each with
 * its count in its title; one column at a time on a phone, chosen with
 * a segmented control. Above the columns, one filled "Partager" once
 * someone is retained: the tab's frequent action, so the brief page's
 * header turns its run button outline on this tab.
 * A card opens the drawer (the reading, or the item's thread); the
 * shares made from this shortlist sit under the board.
 */
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ListChecks, RefreshCw, Share2, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { ShareDialog } from "@/components/share/share-dialog";
import { SharesPanel } from "@/components/share/shares-panel";
import { useDesktop } from "@/components/thread/use-desktop";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, ShortlistItemStatus } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import {
  ensureShortlist,
  readBoard,
  readBoardBrief,
  readShortlistId,
  type Board,
  type BoardItem,
} from "@/lib/shortlists/queries";
import { ITEM_STATUSES, groupByStatus } from "@/lib/shortlists/tally";
import { useTeamMembers } from "@/lib/shortlists/use-members";

import { ItemCard } from "./item-card";
import { ItemDrawer, type DrawerTab } from "./item-drawer";

const EMPTY_BOARD: Board = { items: [], threadCounts: new Map() };
const NO_CRITERIA: readonly BriefCriterion[] = [];

export function ShortlistBoard({ briefId, canEdit }: { briefId: string; canEdit: boolean }) {
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { user } = useAuth();
  const members = useTeamMembers();
  const desktop = useDesktop();
  const userId = user?.id ?? null;

  const [opened, setOpened] = useState<{ id: string; tab: DrawerTab } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [column, setColumn] = useState<ShortlistItemStatus>("to_review");

  // A member gets the shortlist created on first sight; a viewer reads what exists.
  const creates = canEdit && userId !== null;
  const shortlist = useQuery(
    `shortlist-of:${org.id}:${briefId}:${creates ? "member" : "viewer"}`,
    async () => {
      const supabase = await requireSupabase();
      const found = await readShortlistId(supabase, org.id, briefId);
      if (found || !userId || !creates) return found;
      return ensureShortlist(supabase, { orgId: org.id, briefId, userId });
    },
  );
  const shortlistId = shortlist.data ?? null;

  const brief = useQuery(`board-brief:${org.id}:${briefId}`, async () =>
    readBoardBrief(await requireSupabase(), org.id, briefId),
  );

  const board = useQuery(
    `board:${org.id}:${shortlistId ?? ""}`,
    async () =>
      shortlistId ? readBoard(await requireSupabase(), org.id, shortlistId) : EMPTY_BOARD,
    shortlistId !== null,
  );

  const refreshBoard = board.refresh;
  const onChanged = useCallback(() => {
    void refreshBoard();
  }, [refreshBoard]);

  useEffect(() => {
    if (!shortlistId) return undefined;
    const soon = debounce(onChanged, 300);
    const stops = [
      subscribeToTable("shortlist_items", `shortlist_id=eq.${shortlistId}`, soon),
      subscribeToTable("comments", `org_id=eq.${org.id}`, soon),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [onChanged, org.id, shortlistId]);

  // A reader who found no shortlist learns of the one a member creates (the first candidate added).
  const refreshShortlist = shortlist.refresh;
  useEffect(() => {
    if (shortlistId) return undefined;
    return subscribeToTable(
      "shortlists",
      `brief_id=eq.${briefId}`,
      debounce(() => void refreshShortlist(), 300),
    );
  }, [briefId, refreshShortlist, shortlistId]);

  const items = useMemo(() => board.data?.items ?? [], [board.data]);
  const groups = useMemo(() => groupByStatus(items), [items]);
  const threadCounts = board.data?.threadCounts;
  const criteria = brief.data?.criteria ?? NO_CRITERIA;
  const openItem = opened ? (items.find((item) => item.id === opened.id) ?? null) : null;
  const loading =
    (shortlist.loading && shortlist.data === null) ||
    (shortlistId !== null && board.loading && board.data === null);
  const failed = shortlist.error !== null || board.error !== null;

  const retry = () => {
    if (shortlist.error) void refreshShortlist();
    else void refreshBoard();
  };

  const columnOf = (status: ShortlistItemStatus, headed: boolean) => (
    <Column
      status={status}
      items={groups[status]}
      headed={headed}
      render={(item) => (
        <ItemCard
          item={item}
          orgId={org.id}
          threadCount={threadCounts?.get(item.id) ?? 0}
          canEdit={canEdit}
          members={members}
          onChanged={onChanged}
          onOpen={(tab) => setOpened({ id: item.id, tab })}
        />
      )}
    />
  );

  return (
    <div>
      {/* The one action above the board, filled: the brief page's header gives up its primary on this tab. */}
      {canEdit && shortlistId && groups.retained.length > 0 ? (
        <div className="mb-4 flex justify-end">
          <Button
            type="button"
            variant="primary"
            icon={<Share2 />}
            onClick={() => setShareOpen(true)}
          >
            {t("shortlists.share")}
          </Button>
        </div>
      ) : null}

      {failed ? (
        <EmptyState
          icon={<TriangleAlert />}
          title={t("shortlists.boardError")}
          action={
            <Button type="button" variant="outline" icon={<RefreshCw />} onClick={retry}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : loading ? (
        <BoardSkeleton columns={desktop ? 3 : 1} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t("shortlists.board.empty.title")}
          action={
            <Button asChild variant="outline">
              <Link to="/app/briefs/$briefId" params={{ briefId }} search={{ tab: "matches" }}>
                {t("shortlists.board.empty.action")}
              </Link>
            </Button>
          }
        />
      ) : desktop ? (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          {ITEM_STATUSES.map((status) => (
            <div key={status} className="min-w-0">
              {columnOf(status, true)}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented
            value={column}
            onChange={setColumn}
            aria-label={t("shortlists.columns")}
            className="max-w-full"
            options={ITEM_STATUSES.map((status) => ({
              value: status,
              label: t(`shortlists.status.${status}`),
              count: groups[status].length,
            }))}
          />
          {columnOf(column, false)}
        </div>
      )}

      {shortlistId ? (
        <div className="mt-8">
          <SharesPanel shortlistId={shortlistId} />
        </div>
      ) : null}

      <ItemDrawer
        item={openItem}
        tab={opened?.tab ?? "reading"}
        onTabChange={(tab) => setOpened((current) => (current ? { ...current, tab } : current))}
        orgId={org.id}
        criteria={criteria}
        threadCount={openItem ? (threadCounts?.get(openItem.id) ?? 0) : 0}
        canEdit={canEdit}
        members={members}
        currentUserId={userId}
        onChanged={onChanged}
        onClose={() => setOpened(null)}
      />

      {shortlistId ? (
        <ShareDialog
          shortlistId={shortlistId}
          briefTitle={brief.data?.title ?? ""}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
    </div>
  );
}

/** Three placeholder cards per column while the board is read. */
function BoardSkeleton({ columns }: { columns: number }) {
  const { t } = useI18n();
  return (
    <div className="grid items-start gap-6 lg:grid-cols-3" aria-busy="true">
      <p className="sr-only">{t("common.loading")}</p>
      {Array.from({ length: columns }, (_, index) => (
        <div key={index} className="space-y-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/**
 * One column: its title with the count (on a desk; on a phone the
 * segmented control names it), one short line when it is empty, else
 * the cards 16px apart, rising in once.
 */
function Column({
  status,
  items,
  headed,
  render,
}: {
  status: ShortlistItemStatus;
  items: readonly BoardItem[];
  /** False on a phone, where the segmented control above is the heading. */
  headed: boolean;
  render: (item: BoardItem) => ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const title = t(`shortlists.status.${status}`);
  return (
    <section
      className="min-w-0"
      aria-labelledby={headed ? `${id}-title` : undefined}
      aria-label={headed ? undefined : title}
    >
      {headed ? (
        <h3
          id={`${id}-title`}
          className="mb-3 flex items-baseline gap-2 px-1 text-base font-semibold text-ink"
        >
          {title}
          <span className="font-normal text-muted-foreground tabular-nums">
            {/* Keeps the title and the count two words in the heading's name ("Retenus, 3"). */}
            <span className="sr-only">, </span>
            {items.length}
          </span>
        </h3>
      ) : null}
      {items.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">
          {t(`shortlists.section.empty.${status}`)}
        </p>
      ) : (
        <ul className="stagger space-y-4">
          {items.map((item) => (
            <li key={item.id} className="rise-in min-w-0">
              {render(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
