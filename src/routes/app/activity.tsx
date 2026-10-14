/**
 * The whole activity log of the organisation, newest first, fifty rows
 * at a time, filtered by family of kinds (chips with their icons),
 * grouped by day in one timeline, refreshed live.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, ChevronDown } from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { FamilyFilter } from "@/components/activity/family-filter";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
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
    <>
      <PageHeader eyebrow={org.name} title={t("nav.activity")} description={t("activity.subtitle")} />
      <div className="mb-6">
        <FamilyFilter value={family} onChange={setFamily} />
      </div>
      {feed.error ? (
        <p className="mb-4 text-sm text-negative" role="alert">
          {t("common.error")}
        </p>
      ) : null}
      <ActivityList
        rows={feed.rows}
        names={names}
        loading={feed.loading}
        emptyState={
          <EmptyState icon={<Activity />} title={family ? t("activity.emptyFiltered") : t("activity.empty")} text={t("dashboard.activity.empty.text")} />
        }
      />
      {feed.hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" icon={<ChevronDown />} onClick={() => void feed.loadMore()} disabled={feed.loadingMore}>
            {feed.loadingMore ? t("common.loading") : t("activity.loadMore")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
