/**
 * The dashboard: a greeting, four counts read under RLS, the fifteen
 * most recent activities, and the two actions that fill a talent pool.
 * The feed and the counts refresh when the activity log or the documents
 * table changes.
 */
import { useEffect, useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, Briefcase, FileText, ListChecks, Plus, Upload, Users } from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { StatGrid, StatTile } from "@/components/team/stat-tiles";
import { Button } from "@/components/ui/button";
import { memberNames, readActivities, readActivityTargets } from "@/lib/activity/activity";
import type { ActivityNames } from "@/lib/activity/describe";
import { BRIEFS_PATH, CANDIDATES_PATH, NEW_BRIEF_PATH, SHORTLISTS_PATH } from "@/lib/activity/links";
import { readDashboardStats } from "@/lib/activity/stats";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";
import { memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

const RECENT = 15;

function DashboardPage() {
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { members } = useOrg();
  const { user } = useAuth();
  const name = memberName(user ? members.get(user.id) : undefined, user?.email?.split("@")[0] ?? "");

  const { data, loading, error, refresh } = useQuery(`dashboard:${org.id}`, async () => {
    const supabase = await requireSupabase();
    const [stats, rows] = await Promise.all([
      readDashboardStats(supabase, org.id),
      readActivities(supabase, org.id, { family: null, from: 0, to: RECENT - 1 }),
    ]);
    const targets = await readActivityTargets(supabase, rows);
    return { stats, rows, targets };
  });

  useEffect(() => {
    const soon = debounce(() => void refresh());
    const filter = `org_id=eq.${org.id}`;
    const stopActivities = subscribeToTable("activities", filter, soon);
    const stopDocuments = subscribeToTable("documents", filter, soon);
    return () => {
      stopActivities();
      stopDocuments();
    };
  }, [org.id, refresh]);

  const names = useMemo<ActivityNames>(
    () => ({
      members: memberNames(members),
      briefs: data?.targets.briefs ?? new Map<string, string>(),
      candidates: data?.targets.candidates ?? new Map<string, string>(),
    }),
    [data, members],
  );

  const stats = data?.stats ?? null;

  return (
    <>
      <PageHeader
        title={t("shell.dashboard.title", { name })}
        description={t("shell.dashboard.subtitle")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={CANDIDATES_PATH}>
                <Upload />
                {t("shell.dashboard.uploadCta")}
              </Link>
            </Button>
            <Button asChild>
              <Link to={NEW_BRIEF_PATH}>
                <Plus />
                {t("shell.dashboard.briefCta")}
              </Link>
            </Button>
          </>
        }
      />

      {error ? <p className="mb-3 text-sm text-negative">{t("dashboard.statsUnread")}</p> : null}

      <StatGrid>
        <StatTile label={t("shell.dashboard.candidates")} value={stats?.candidates ?? null} icon={<Users />} to={CANDIDATES_PATH} loading={loading} />
        <StatTile label={t("shell.dashboard.processing")} value={stats?.processing ?? null} icon={<FileText />} to={CANDIDATES_PATH} loading={loading} />
        <StatTile label={t("shell.dashboard.openBriefs")} value={stats?.openBriefs ?? null} icon={<Briefcase />} to={BRIEFS_PATH} loading={loading} />
        <StatTile label={t("shell.dashboard.retained")} value={stats?.retainedThisMonth ?? null} icon={<ListChecks />} to={SHORTLISTS_PATH} loading={loading} />
      </StatGrid>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">{t("shell.dashboard.recentActivity")}</h2>
          <Link to="/app/activity" className="text-sm text-primary hover:underline">
            {t("dashboard.viewAll")}
          </Link>
        </div>
        <ActivityList
          rows={data?.rows ?? []}
          names={names}
          loading={loading}
          emptyState={
            <EmptyState
              icon={<Activity />}
              title={t("shell.dashboard.noActivity")}
              action={
                <Button asChild variant="outline">
                  <Link to={CANDIDATES_PATH}>
                    <Upload />
                    {t("shell.dashboard.uploadCta")}
                  </Link>
                </Button>
              }
            />
          }
        />
      </section>
    </>
  );
}
