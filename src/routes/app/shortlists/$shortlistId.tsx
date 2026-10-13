/**
 * /app/shortlists/:shortlistId: the board of one shortlist. The brief in
 * the header with the counts, a way to the brief's search to add
 * candidates and the share dialog (members); three columns from lg,
 * stacked before: to review, retained, dismissed, each a list of cards;
 * a drawer for one item; the shares under the board. Live through
 * realtime on the shortlist's items, the organisation's votes and
 * comments, each change debounced into one re-read.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Share2, UserPlus } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { ShareDialog } from "@/components/share/share-dialog";
import { SharesPanel } from "@/components/share/shares-panel";
import { ItemCard } from "@/components/shortlist/item-card";
import { ItemDrawer } from "@/components/shortlist/item-drawer";
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
  countByStatus,
  groupByStatus,
  tallyVotes,
  votesByItem,
} from "@/lib/shortlists/tally";

export const Route = createFileRoute("/app/shortlists/$shortlistId")({
  component: ShortlistPage,
});

function ShortlistPage() {
  const { shortlistId } = Route.useParams();
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const { user } = useAuth();
  const canAct = can("member");

  const [openItemId, setOpenItemId] = useState<string | null>(null);
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
  const counts = useMemo(() => countByStatus(items), [items]);
  const commentCounts = board.data?.commentCounts;
  const userId = user?.id ?? null;
  const openItem = openItemId ? (items.find((item) => item.id === openItemId) ?? null) : null;
  const openTally = openItem ? tallyVotes(votes.get(openItem.id) ?? [], userId) : NO_VOTES;

  const row = shortlist.data ?? null;
  const brief = row?.briefs ?? null;
  const briefId = row?.brief_id ?? null;
  const title = brief ? brief.title : t("shortlists.noBrief");

  const backLink = (
    <div className="mb-4">
      <Button asChild variant="ghost" size="sm" className="-ml-3 text-muted-foreground hover:text-ink">
        <Link to="/app/shortlists">
          <ArrowLeft />
          {t("shortlists.back")}
        </Link>
      </Button>
    </div>
  );

  if (shortlist.loading && !row) {
    return (
      <div>
        {backLink}
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
        {backLink}
        <EmptyState
          title={shortlist.error ? t("shortlists.boardError") : t("shortlists.notFound.title")}
          text={shortlist.error ? undefined : t("shortlists.notFound.text")}
          action={
            <Button asChild variant="outline">
              <Link to="/app/shortlists">{t("shortlists.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const addLink = briefId ? (
    <Button asChild variant="outline">
      <Link to={briefPath(briefId)}>
        <UserPlus />
        {t("shortlists.addCandidates")}
      </Link>
    </Button>
  ) : null;

  return (
    <div>
      {backLink}
      <PageHeader
        eyebrow={
          briefId ? (
            <Link to={briefPath(briefId)} className="hover:text-ink hover:underline">
              {t("shortlists.openBrief")}
            </Link>
          ) : (
            t("shortlists.title")
          )
        }
        title={title}
        description={t("shortlists.counts.line", {
          to_review: counts.to_review,
          retained: counts.retained,
          dismissed: counts.dismissed,
        })}
        actions={
          canAct ? (
            <>
              {addLink}
              <Button type="button" onClick={() => setShareOpen(true)}>
                <Share2 />
                {t("shortlists.share")}
              </Button>
            </>
          ) : null
        }
      />

      {!canAct ? <p className="mb-6 text-sm text-muted-foreground">{t("shortlists.viewer")}</p> : null}

      {board.error ? (
        <EmptyState
          title={t("shortlists.boardError")}
          action={
            <Button type="button" variant="outline" onClick={() => void refreshBoard()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : board.loading && !board.data ? (
        <div className="grid items-start gap-6 lg:grid-cols-3" aria-busy="true">
          {ITEM_STATUSES.map((status) => (
            <div key={status} className="space-y-4">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title={t("shortlists.board.empty.title")}
          text={t("shortlists.board.empty.text")}
          action={canAct ? addLink : undefined}
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          {ITEM_STATUSES.map((status) => (
            <div key={status} className="min-w-0">
              <StatusSection status={status} count={groups[status].length}>
                {groups[status].map((item) => (
                  <li key={item.id} className="min-w-0">
                    <ItemCard
                      item={item}
                      orgId={org.id}
                      tally={tallyVotes(votes.get(item.id) ?? [], userId)}
                      commentCount={commentCounts?.get(item.id) ?? 0}
                      canAct={canAct}
                      onChanged={onChanged}
                      onOpen={() => setOpenItemId(item.id)}
                    />
                  </li>
                ))}
              </StatusSection>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        <SharesPanel shortlistId={shortlistId} />
      </div>

      <ItemDrawer
        item={openItem}
        orgId={org.id}
        briefId={briefId}
        briefTitle={brief ? brief.title : null}
        criteria={brief?.criteria ?? []}
        tally={openTally}
        canAct={canAct}
        refreshSignal={refreshSignal}
        onChanged={onChanged}
        onClose={() => setOpenItemId(null)}
      />

      <ShareDialog shortlistId={shortlistId} briefTitle={title} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  );
}
