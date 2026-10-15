/**
 * The whole activity log of the organisation on the plane: one pane,
 * the families as chips in its header (each with its icon), the rows
 * grouped by day in one timeline that runs edge to edge (lines, no
 * card), fifty at a time, newest first, refreshed live.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, ChevronDown, CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { FamilyFilter } from "@/components/activity/family-filter";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pane, Workspace } from "@/components/app-shell/workspace";
import { Button } from "@/components/ui/button";
import { memberNames } from "@/lib/activity/activity";
import type { ActivityFamily, ActivityNames } from "@/lib/activity/describe";
import { useActivityFeed } from "@/lib/activity/use-activity-feed";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { members } = useOrg();
  const [family, setFamily] = useState<ActivityFamily | null>(null);
  const feed = useActivityFeed(org.id, family);

  const names = useMemo<ActivityNames>(
    () => ({ members: memberNames(members), briefs: feed.briefs, candidates: feed.candidates }),
    [feed.briefs, feed.candidates, members],
  );

  return (
    <Workspace title={t("nav.activity")}>
      <Pane
        label={t("nav.activity")}
        width="fill"
        header={
          <div className="px-4 py-3">
            <FamilyFilter value={family} onChange={setFamily} />
          </div>
        }
      >
        {/* With rows on screen, a failed refresh or "show more" keeps them and says so in one line. */}
        {feed.error && feed.rows.length > 0 ? (
          <p
            className="flex items-start gap-1.5 border-b border-line px-4 py-3 text-sm text-ink sm:px-6"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("common.error")}
          </p>
        ) : null}
        <ActivityList
          rows={feed.rows}
          names={names}
          loading={feed.loading}
          headingLevel={2}
          emptyState={
            // A failed read is never shown as "no activity": it says what failed and offers a retry.
            feed.error ? (
              <div role="alert">
                <EmptyState
                  quiet
                  icon={<TriangleAlert />}
                  title={t("activity.loadError")}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      icon={<RefreshCw />}
                      onClick={() => void feed.refresh()}
                    >
                      {t("common.retry")}
                    </Button>
                  }
                />
              </div>
            ) : (
              <EmptyState
                quiet
                icon={<Activity />}
                title={family ? t("activity.emptyFiltered") : t("activity.empty")}
              />
            )
          }
        />
        {feed.hasMore ? (
          <div className="flex justify-center border-t border-line px-4 py-6 sm:px-6">
            <Button
              variant="outline"
              icon={<ChevronDown />}
              onClick={() => void feed.loadMore()}
              disabled={feed.loadingMore}
            >
              {feed.loadingMore ? t("common.loading") : t("activity.loadMore")}
            </Button>
          </div>
        ) : null}
      </Pane>
    </Workspace>
  );
}
