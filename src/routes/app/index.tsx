/**
 * The dashboard: a greeting, four counts read under RLS, then two
 * columns from lg: the fifteen most recent activities and a "to begin"
 * card with the three steps that fill a talent pool (upload, brief,
 * share). The feed and the counts refresh when the activity log or the
 * documents table changes. The page's one primary action is a new brief.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, Briefcase, FileText, ListChecks, Plus, Share2, Upload, Users } from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Section } from "@/components/app-shell/section";
import { StatGrid, StatTile } from "@/components/app-shell/stat-tile";
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

/** One of the three steps of the "to begin" card: a number, a title, a sentence, its button. */
function StartStep({ index, title, text, action }: { index: number; title: string; text: string; action: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-sm text-primary tabular-nums">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold leading-6 text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{text}</p>
        <div className="mt-3">{action}</div>
      </div>
    </li>
  );
}

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
        eyebrow={t("nav.dashboard")}
        title={t("shell.dashboard.title", { name })}
        description={t("shell.dashboard.subtitle")}
        actions={
          <Button asChild>
            <Link to={NEW_BRIEF_PATH}>
              <Plus />
              {t("shell.dashboard.briefCta")}
            </Link>
          </Button>
        }
      />

      {error ? <p className="mb-4 text-sm text-negative">{t("dashboard.statsUnread")}</p> : null}

      <StatGrid>
        <StatTile label={t("shell.dashboard.candidates")} value={stats?.candidates ?? null} icon={<Users />} to={CANDIDATES_PATH} loading={loading} />
        <StatTile label={t("shell.dashboard.processing")} value={stats?.processing ?? null} icon={<FileText />} to={CANDIDATES_PATH} loading={loading} />
        <StatTile label={t("shell.dashboard.openBriefs")} value={stats?.openBriefs ?? null} icon={<Briefcase />} to={BRIEFS_PATH} loading={loading} />
        <StatTile label={t("shell.dashboard.retained")} value={stats?.retainedThisMonth ?? null} icon={<ListChecks />} to={SHORTLISTS_PATH} loading={loading} />
      </StatGrid>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Section
          title={t("shell.dashboard.recentActivity")}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/activity">{t("dashboard.viewAll")}</Link>
            </Button>
          }
        >
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
        </Section>

        <aside className="sheet p-6" aria-labelledby="dashboard-start-title">
          <h2 id="dashboard-start-title" className="font-display text-xl text-ink">
            {t("shell.dashboard.start.title")}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("shell.dashboard.start.text")}</p>
          <ol className="mt-6 space-y-6">
            <StartStep
              index={1}
              title={t("shell.dashboard.step.upload.title")}
              text={t("shell.dashboard.step.upload.text")}
              action={
                <Button asChild variant="outline">
                  <Link to={CANDIDATES_PATH}>
                    <Upload />
                    {t("shell.dashboard.uploadCta")}
                  </Link>
                </Button>
              }
            />
            <StartStep
              index={2}
              title={t("shell.dashboard.step.brief.title")}
              text={t("shell.dashboard.step.brief.text")}
              action={
                <Button asChild variant="outline">
                  <Link to={NEW_BRIEF_PATH}>
                    <Briefcase />
                    {t("shell.dashboard.briefCta")}
                  </Link>
                </Button>
              }
            />
            <StartStep
              index={3}
              title={t("shell.dashboard.step.share.title")}
              text={t("shell.dashboard.step.share.text")}
              action={
                <Button asChild variant="outline">
                  <Link to={SHORTLISTS_PATH}>
                    <Share2 />
                    {t("shell.dashboard.step.share.cta")}
                  </Link>
                </Button>
              }
            />
          </ol>
        </aside>
      </div>
    </>
  );
}
