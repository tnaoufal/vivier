/**
 * The dashboard: the date and a greeting, four counts read under RLS
 * (candidates, CVs being read with their progress, open briefs, retained
 * this month), then two columns from lg: the open briefs with where
 * each stands (the last analysis, what the model proposes, what the
 * team retained) and the recent activity as a timeline. A "to begin"
 * card shows only while the pool is empty. Everything refreshes when
 * the activity log, the documents or the searches change. The page's
 * one primary action is a new brief.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Briefcase,
  Check,
  FileText,
  ListChecks,
  Plus,
  Share2,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";

import { ActivityList } from "@/components/activity/activity-list";
import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Section } from "@/components/app-shell/section";
import { StatGrid, StatTile } from "@/components/app-shell/stat-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { memberNames, readActivities, readActivityTargets } from "@/lib/activity/activity";
import type { ActivityNames } from "@/lib/activity/describe";
import {
  BRIEFS_PATH,
  CANDIDATES_PATH,
  NEW_BRIEF_PATH,
  SHORTLISTS_PATH,
  briefPath,
} from "@/lib/activity/links";
import { readBriefsOverview, type BriefOverview } from "@/lib/activity/overview";
import { readDashboardStats } from "@/lib/activity/stats";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefStatus } from "@/lib/db/types";
import { formatRelative, useI18n, type Locale } from "@/lib/i18n";
import { memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

const RECENT = 8;

const STATUS_TONES: Record<BriefStatus, PillTone> = {
  draft: "neutral",
  open: "positive",
  closed: "caution",
};

/** "mardi 14 octobre 2026", with a capital, in the person's language. */
function longDate(locale: Locale, now: Date = new Date()): string {
  const text = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One of the three steps of the "to begin" card: a number, a title, a sentence, its button. */
function StartStep({
  index,
  title,
  text,
  action,
}: {
  index: number;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <li className="rise-in flex gap-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-sm text-primary tabular-nums">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold leading-6 text-ink">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        <div className="mt-4">{action}</div>
      </div>
    </li>
  );
}

/** The three steps that fill a talent pool, shown while it is empty. */
function StartCard() {
  const { t } = useI18n();
  return (
    <section className="sheet fade-in p-6 sm:p-8" aria-labelledby="dashboard-start-title">
      <h2 id="dashboard-start-title" className="font-display text-xl text-ink">
        {t("shell.dashboard.start.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("shell.dashboard.start.text")}</p>
      <ol className="stagger mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
        <StartStep
          index={1}
          title={t("shell.dashboard.step.upload.title")}
          text={t("shell.dashboard.step.upload.text")}
          action={
            <Button asChild variant="outline" icon={<Upload />}>
              <Link to={CANDIDATES_PATH}>{t("shell.dashboard.uploadCta")}</Link>
            </Button>
          }
        />
        <StartStep
          index={2}
          title={t("shell.dashboard.step.brief.title")}
          text={t("shell.dashboard.step.brief.text")}
          action={
            <Button asChild variant="outline" icon={<Briefcase />}>
              <Link to={NEW_BRIEF_PATH}>{t("shell.dashboard.briefCta")}</Link>
            </Button>
          }
        />
        <StartStep
          index={3}
          title={t("shell.dashboard.step.share.title")}
          text={t("shell.dashboard.step.share.text")}
          action={
            <Button asChild variant="outline" icon={<Share2 />}>
              <Link to={SHORTLISTS_PATH}>{t("shell.dashboard.step.share.cta")}</Link>
            </Button>
          }
        />
      </ol>
    </section>
  );
}

/** One open brief: its title and status, the last analysis, what the model proposes and what the team retained. */
function BriefCard({ item }: { item: BriefOverview }) {
  const { t, locale } = useI18n();
  const { brief, lastSearch, shortlist } = item;
  const criteria =
    brief.criteria.length === 0
      ? t("briefs.list.criteria.none")
      : brief.criteria.length === 1
        ? t("briefs.list.criteria.one")
        : t("briefs.list.criteria.many", { count: brief.criteria.length });
  const analysis = lastSearch
    ? `${t("dashboard.briefs.lastAnalysis", { when: formatRelative(locale, lastSearch.at) })} · ${
        lastSearch.read === 1
          ? t("dashboard.briefs.read.one")
          : t("dashboard.briefs.read.many", { count: lastSearch.read })
      }`
    : t("dashboard.briefs.noAnalysis");
  const present =
    shortlist === null || shortlist.present === 0
      ? t("dashboard.briefs.present.none")
      : shortlist.present === 1
        ? t("dashboard.briefs.present.one")
        : t("dashboard.briefs.present.many", { count: shortlist.present });
  const retained =
    shortlist === null || shortlist.retained === 0
      ? t("dashboard.briefs.retained.none")
      : shortlist.retained === 1
        ? t("dashboard.briefs.retained.one")
        : t("dashboard.briefs.retained.many", { count: shortlist.retained });
  return (
    <Link to={briefPath(brief.id)} className="sheet sheet-link flex min-w-0 flex-col gap-3 p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-6 text-ink break-words">
          {brief.title}
        </h3>
        <Pill tone={STATUS_TONES[brief.status]} dot>
          {t(`briefs.status.${brief.status}`)}
        </Pill>
      </div>
      <p className="text-meta text-muted-foreground">
        <span className="tabular-nums">{criteria}</span>
        <span aria-hidden="true"> · </span>
        <span className={lastSearch ? "tabular-nums" : undefined}>{analysis}</span>
      </p>
      {shortlist ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-meta text-muted-foreground">
            {t("dashboard.briefs.shortlist")}
          </span>
          <Pill
            tone={shortlist.present > 0 ? "primary" : "neutral"}
            icon={<Sparkles />}
            title={t("dashboard.briefs.present.help")}
          >
            {present}
          </Pill>
          <span className="sr-only">{t("dashboard.briefs.present.help")}</span>
          <Pill
            tone={shortlist.retained > 0 ? "positive" : "neutral"}
            icon={<Check />}
            title={t("dashboard.briefs.retained.help")}
          >
            {retained}
          </Pill>
          <span className="sr-only">{t("dashboard.briefs.retained.help")}</span>
        </div>
      ) : (
        <p className="text-meta text-muted-foreground">{t("dashboard.briefs.noShortlist")}</p>
      )}
    </Link>
  );
}

function BriefCardsSkeleton() {
  return (
    <ul className="space-y-4" aria-busy="true" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <li key={index} className="sheet space-y-3 p-6">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-6 w-40 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

function DashboardPage() {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { members, can } = useOrg();
  const { user } = useAuth();
  const name = memberName(
    user ? members.get(user.id) : undefined,
    user?.email?.split("@")[0] ?? "",
  );

  const { data, loading, error, refresh } = useQuery(`dashboard:${org.id}`, async () => {
    const supabase = await requireSupabase();
    const [stats, rows, briefs] = await Promise.all([
      readDashboardStats(supabase, org.id),
      readActivities(supabase, org.id, { family: null, from: 0, to: RECENT - 1 }),
      // The briefs column is secondary: a failed read leaves it null and the rest of the page stands.
      readBriefsOverview(supabase, org.id).catch((caught: unknown) => {
        console.error(caught);
        return null;
      }),
    ]);
    const targets = await readActivityTargets(supabase, rows);
    return { stats, rows, targets, briefs };
  });

  useEffect(() => {
    const soon = debounce(() => void refresh());
    const filter = `org_id=eq.${org.id}`;
    const stops = [
      subscribeToTable("activities", filter, soon),
      subscribeToTable("documents", filter, soon),
      subscribeToTable("searches", filter, soon),
    ];
    return () => {
      for (const stop of stops) stop();
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
  const processing = stats?.processing ?? null;
  const poolEmpty = stats !== null && stats.candidates === 0 && (processing ?? 0) === 0;
  const briefs = data?.briefs ?? null;

  return (
    <>
      <PageHeader
        eyebrow={<time dateTime={new Date().toISOString().slice(0, 10)}>{longDate(locale)}</time>}
        title={t("shell.dashboard.title", { name })}
        description={t("shell.dashboard.subtitle")}
        actions={
          can("member") ? (
            <Button asChild icon={<Plus />}>
              <Link to={NEW_BRIEF_PATH}>{t("shell.dashboard.briefCta")}</Link>
            </Button>
          ) : null
        }
      />

      {error ? (
        <p className="mb-4 text-sm text-negative" role="alert">
          {t("dashboard.statsUnread")}
        </p>
      ) : null}

      <StatGrid>
        <StatTile
          label={t("shell.dashboard.candidates")}
          value={stats?.candidates ?? null}
          icon={<Users />}
          to={CANDIDATES_PATH}
          loading={loading}
          hint={t("dashboard.tile.candidates.hint")}
        />
        <StatTile
          label={t("shell.dashboard.processing")}
          value={processing}
          icon={<FileText />}
          to={CANDIDATES_PATH}
          loading={loading}
          hint={
            processing === null
              ? undefined
              : processing > 0
                ? t("dashboard.tile.processing.busy")
                : t("dashboard.tile.processing.idle")
          }
          progress={
            stats && processing !== null && stats.processingTotal !== null && processing > 0
              ? {
                  done: Math.max(0, stats.processingTotal - processing),
                  total: stats.processingTotal,
                }
              : undefined
          }
        />
        <StatTile
          label={t("shell.dashboard.openBriefs")}
          value={stats?.openBriefs ?? null}
          icon={<Briefcase />}
          to={BRIEFS_PATH}
          loading={loading}
          hint={t("dashboard.tile.briefs.hint")}
        />
        <StatTile
          label={t("shell.dashboard.retained")}
          value={stats?.retainedThisMonth ?? null}
          icon={<ListChecks />}
          to={SHORTLISTS_PATH}
          loading={loading}
          hint={t("dashboard.tile.retained.hint")}
        />
      </StatGrid>

      {poolEmpty ? (
        <div className="mt-8">
          <StartCard />
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Section
          title={t("dashboard.briefs.title")}
          count={briefs ? briefs.length : undefined}
          action={
            <Button asChild variant="ghost">
              <Link to={BRIEFS_PATH}>{t("dashboard.briefs.all")}</Link>
            </Button>
          }
        >
          {loading && !data ? (
            <BriefCardsSkeleton />
          ) : briefs === null ? (
            <p className="text-sm text-muted-foreground">{t("common.error")}</p>
          ) : briefs.length === 0 ? (
            <EmptyState
              compact
              icon={<Briefcase />}
              title={t("dashboard.briefs.empty")}
              text={t("dashboard.briefs.empty.text")}
              action={
                can("member") ? (
                  <Button asChild variant="outline" icon={<Briefcase />}>
                    <Link to={NEW_BRIEF_PATH}>{t("shell.dashboard.briefCta")}</Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="stagger space-y-4">
              {briefs.map((item) => (
                <li key={item.brief.id} className="rise-in min-w-0">
                  <BriefCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t("shell.dashboard.recentActivity")}
          action={
            <Button asChild variant="ghost">
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
                compact
                icon={<Activity />}
                title={t("shell.dashboard.noActivity")}
                text={t("dashboard.activity.empty.text")}
                action={
                  can("member") ? (
                    <Button asChild variant="outline" icon={<Upload />}>
                      <Link to={CANDIDATES_PATH}>{t("shell.dashboard.uploadCta")}</Link>
                    </Button>
                  ) : null
                }
              />
            }
          />
        </Section>
      </div>
    </>
  );
}
