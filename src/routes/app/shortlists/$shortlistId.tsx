/**
 * /app/shortlists/:shortlistId: the board of one shortlist. The brief in
 * the header (a link to it, its status when not open, "read only" for a
 * viewer), a way to the brief's search to add candidates and the share
 * dialog (members), folded to their icons on a phone; three columns from
 * lg, stacked before: to review, retained, dismissed, each with its count
 * and a list of cards; a drawer for one item, in three tabs; the shares
 * under the board. Live through realtime on the shortlist's items, the
 * organisation's votes and comments, each change debounced into one
 * re-read.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Eye, ListChecks, RefreshCw, Share2, TriangleAlert, UserPlus } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill } from "@/components/app-shell/pill";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { ShareDialog } from "@/components/share/share-dialog";
import { SharesPanel } from "@/components/share/shares-panel";
import { ItemCard } from "@/components/shortlist/item-card";
import { ItemDrawer, type DrawerTab } from "@/components/shortlist/item-drawer";
import { StatusSection } from "@/components/shortlist/status-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { briefPath } from "@/lib/activity/links";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { readBoard, readShortlist } from "@/lib/shortlists/queries";
import {
  ITEM_STATUSES,
  NO_VOTES,
  groupByStatus,
  tallyVotes,
  votesByItem,
} from "@/lib/shortlists/tally";

export const Route = createFileRoute("/app/shortlists/$shortlistId")({
  component: ShortlistPage,
});

/** A labelled header button folded to its 40px icon under `sm`. */
const PHONE_ICON = "max-sm:size-10 max-sm:px-0";

function ShortlistPage() {
  const { shortlistId } = Route.useParams();
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const { user } = useAuth();
  const canAct = can("member");

  const [opened, setOpened] = useState<{ id: string; tab: DrawerTab } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const shortlist = useQuery(`shortlist:${org.id}:${shortlistId}`, async () =>
    readShortlist(await requireSupabase(), org.id, shortlistId),
  );
  const board = useQuery(`board:${org.id}:${shortlistId}`, async () =>
    readBoard(await requireSupabase(), org.id, shortlistId),
  );

  const refreshBoard = board.refresh;
  const onChanged = useCallback(() => {
    void refreshBoard();
    setRefreshSignal((value) => value + 1);
  }, [refreshBoard]);

  useEffect(() => {
    const soon = debounce(onChanged, 300);
    const stops = [
      subscribeToTable("shortlist_items", `shortlist_id=eq.${shortlistId}`, soon),
      subscribeToTable("votes", `org_id=eq.${org.id}`, soon),
      subscribeToTable("comments", `org_id=eq.${org.id}`, soon),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [onChanged, org.id, shortlistId]);

  const items = useMemo(() => board.data?.items ?? [], [board.data]);
  const groups = useMemo(() => groupByStatus(items), [items]);
  const votes = useMemo(() => votesByItem(board.data?.votes ?? []), [board.data]);
  const commentCounts = board.data?.commentCounts;
  const userId = user?.id ?? null;
  const openItem = opened ? (items.find((item) => item.id === opened.id) ?? null) : null;
  const openTally = openItem ? tallyVotes(votes.get(openItem.id) ?? [], userId) : NO_VOTES;

  const row = shortlist.data ?? null;
  const brief = row?.briefs ?? null;
  const briefId = row?.brief_id ?? null;
  const criteria = useMemo(() => brief?.criteria ?? [], [brief]);
  const title = brief ? brief.title : t("shortlists.noBrief");

  // The way back is the header's eyebrow, as on a brief or a candidate: one detail skeleton across the product.
  const eyebrow = (
    <Link
      to="/app/shortlists"
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("nav.shortlists")}
    </Link>
  );

  if (shortlist.loading && !row) {
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
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div>
        <PageHeader sticky eyebrow={eyebrow} title={t("shortlists.title")} />
        <EmptyState
          icon={shortlist.error ? <TriangleAlert /> : <ListChecks />}
          title={shortlist.error ? t("shortlists.boardError") : t("shortlists.notFound.title")}
          action={
            shortlist.error ? (
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw />}
                onClick={() => void shortlist.refresh()}
              >
                {t("common.retry")}
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/app/shortlists">{t("shortlists.back")}</Link>
              </Button>
            )
          }
        />
      </div>
    );
  }

  const addLink = briefId ? (
    <Button asChild variant="outline" icon={<UserPlus />}>
      <Link to={briefPath(briefId)}>{t("shortlists.addCandidates")}</Link>
    </Button>
  ) : null;
  // In the slim header a phone has no room for two labelled buttons next to the title: under `sm`
  // each one is its 40px icon, its name kept for assistive technologies.
  const addHeaderLink = briefId ? (
    <Button asChild variant="outline" icon={<UserPlus />} className={PHONE_ICON}>
      <Link to={briefPath(briefId)}>
        <span className="max-sm:sr-only">{t("shortlists.addCandidates")}</span>
      </Link>
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        sticky
        eyebrow={eyebrow}
        title={title}
        meta={
          // The counts are the columns' own headings below; the header keeps the way to the brief.
          <>
            {briefId ? (
              <Link
                to={briefPath(briefId)}
                className="rounded-sm text-meta font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("shortlists.openBrief")}
              </Link>
            ) : null}
            {brief && brief.status !== "open" ? (
              <BriefStatusPill status={brief.status} size="sm" />
            ) : null}
            {!canAct ? (
              <Pill size="sm" icon={<Eye />}>
                {t("shortlists.readOnly")}
              </Pill>
            ) : null}
          </>
        }
        actions={
          canAct ? (
            <>
              {addHeaderLink}
              <Button
                type="button"
                icon={<Share2 />}
                onClick={() => setShareOpen(true)}
                className={PHONE_ICON}
              >
                <span className="max-sm:sr-only">{t("shortlists.share")}</span>
              </Button>
            </>
          ) : null
        }
      />

      {board.error ? (
        <EmptyState
          icon={<TriangleAlert />}
          title={t("shortlists.boardError")}
          action={
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw />}
              onClick={() => void refreshBoard()}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : board.loading && !board.data ? (
        <div className="grid items-start gap-6 lg:grid-cols-3" aria-busy="true">
          {ITEM_STATUSES.map((status) => (
            <div key={status} className="space-y-4">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-36 w-full rounded-lg" />
              <Skeleton className="h-36 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title={t("shortlists.board.empty.title")}
          action={canAct ? addLink : undefined}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          {ITEM_STATUSES.map((status) => (
            <div key={status} className="min-w-0">
              <StatusSection status={status} count={groups[status].length}>
                {groups[status].map((item) => (
                  <li key={item.id} className="rise-in min-w-0">
                    <ItemCard
                      item={item}
                      orgId={org.id}
                      criteria={criteria}
                      tally={tallyVotes(votes.get(item.id) ?? [], userId)}
                      commentCount={commentCounts?.get(item.id) ?? 0}
                      canAct={canAct}
                      onChanged={onChanged}
                      onOpen={(tab) => setOpened({ id: item.id, tab: tab ?? "decision" })}
                    />
                  </li>
                ))}
              </StatusSection>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <SharesPanel shortlistId={shortlistId} />
      </div>

      <ItemDrawer
        item={openItem}
        tab={opened?.tab ?? "decision"}
        onTabChange={(tab) => setOpened((current) => (current ? { ...current, tab } : current))}
        orgId={org.id}
        briefId={briefId}
        briefTitle={brief ? brief.title : null}
        criteria={criteria}
        tally={openTally}
        canAct={canAct}
        refreshSignal={refreshSignal}
        onChanged={onChanged}
        onClose={() => setOpened(null)}
      />

      <ShareDialog
        shortlistId={shortlistId}
        briefTitle={title}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}
