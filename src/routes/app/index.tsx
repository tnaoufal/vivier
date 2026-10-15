/**
 * The dashboard: a greeting and the date, then what asks for the person.
 * The open briefs as rows (the newest analysis, what the team retained,
 * the team's last word), the most recently active first; the messages
 * that mention the person; one line for the pool with its import. One
 * filled button: a new brief (the import, while the pool is empty).
 * Figures, no sentences. Everything re-reads when the briefs, the
 * searches, the shortlists, the threads or the documents change.
 */
import { useEffect, type MouseEvent } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import {
  Briefcase,
  MessageSquare,
  Plus,
  RefreshCw,
  TriangleAlert,
  Upload,
  Users,
} from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Section } from "@/components/app-shell/section";
import { MyMentions } from "@/components/thread/my-mentions";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  BRIEFS_PATH,
  CANDIDATES_IMPORT_HREF,
  CANDIDATES_PATH,
  NEW_BRIEF_PATH,
  briefPath,
} from "@/lib/activity/links";
import {
  readBriefsOverview,
  readPoolGlance,
  type AnalysisGlance,
  type BriefOverview,
  type PoolGlance,
} from "@/lib/activity/overview";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { formatCount } from "@/lib/candidates/format";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { formatRelative, useI18n, type Locale, type TranslationKey } from "@/lib/i18n";
import { memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/")({
  component: DashboardPage,
});

const MENTIONS = 8;

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

/** The words of an analysis glance: a figure first, or the state in two words. */
function analysisText(
  glance: AnalysisGlance,
  locale: Locale,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (glance.kind === "none") return t("dashboard.briefs.noAnalysis");
  if (glance.kind === "unfinished") return t("dashboard.briefs.unfinished");
  const count = formatCount(locale, glance.count);
  if (glance.kind === "ranked") {
    return glance.count === 1
      ? t("dashboard.briefs.ranked.one")
      : t("dashboard.briefs.ranked.many", { count });
  }
  if (glance.count === 0) return t("dashboard.briefs.matches.none");
  if (glance.count === 1) return t("dashboard.briefs.matches.one");
  return t("dashboard.briefs.matches.many", { count });
}

/**
 * One open brief: its title, where the analysis stands, what the team
 * retained (only when someone was), and the thread's last message with
 * who wrote it and when. The row is the link to the brief.
 */
function BriefRow({ item }: { item: BriefOverview }) {
  const { t, locale } = useI18n();
  const { members } = useOrg();
  const { brief, analysis, retained, thread } = item;
  const author = thread
    ? memberName(members.get(thread.lastAuthorId), t("thread.formerMember"))
    : null;
  return (
    <Link to={briefPath(brief.id)} className="sheet-row">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{brief.title}</p>
        <p className="text-meta text-muted-foreground tabular-nums">
          {analysisText(analysis, locale, t)}
          {retained > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              {retained === 1
                ? t("dashboard.briefs.retained.one")
                : t("dashboard.briefs.retained.many", { count: formatCount(locale, retained) })}
            </>
          ) : null}
        </p>
        {thread && author ? (
          <p className="mt-1 flex items-center gap-1.5 text-meta text-muted-foreground">
            <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              <span className="font-medium text-ink">{author}</span>
              <span aria-hidden="true"> · </span>
              {thread.lastExcerpt}
            </span>
            <time dateTime={thread.lastAt} className="shrink-0 tabular-nums">
              {formatRelative(locale, thread.lastAt)}
            </time>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * The pool in one line: the profiles, the CVs being read with their
 * progress, and the import. The import is the page's filled button only
 * while the pool is empty (there is nothing else to do first); the link
 * opens the pool's page on its import dialog, a free path pushed through
 * the history so the page parses its search itself.
 */
function PoolLine({
  pool,
  poolEmpty,
  canImport,
}: {
  pool: PoolGlance | null;
  poolEmpty: boolean;
  canImport: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const candidates = pool?.candidates ?? null;
  const processing = pool?.processing ?? null;
  const total = pool?.processingTotal ?? null;
  const profiles =
    candidates === null
      ? null
      : candidates === 0
        ? t("dashboard.pool.profiles.none")
        : candidates === 1
          ? t("dashboard.pool.profiles.one")
          : t("dashboard.pool.profiles.many", { count: formatCount(locale, candidates) });

  function open(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click keeps the browser's own behaviour (a new tab); a plain one stays in the app.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.history.push(CANDIDATES_IMPORT_HREF);
  }

  return (
    <section
      className="sheet flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-6"
      aria-label={t("nav.candidates")}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-ink [&_svg]:size-4"
      >
        <Users />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink tabular-nums">
          {profiles === null ? (
            <span title={t("dashboard.statsUnread")}>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t("dashboard.statsUnread")}</span>
            </span>
          ) : (
            <Link
              to={CANDIDATES_PATH}
              className="rounded-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {profiles}
            </Link>
          )}
          {processing ? (
            <>
              <span aria-hidden="true"> · </span>
              {processing === 1
                ? t("dashboard.pool.processing.one")
                : t("dashboard.pool.processing.many", { count: formatCount(locale, processing) })}
            </>
          ) : null}
        </p>
        {processing && total ? (
          <ProgressBar
            className="mt-2 max-w-sm"
            value={Math.max(0, total - processing)}
            max={total}
            active
            label={t("shell.stat.progress", { done: Math.max(0, total - processing), total })}
          />
        ) : null}
      </div>
      {canImport ? (
        <Button asChild variant={poolEmpty ? "primary" : "outline"} icon={<Upload />}>
          <a href={CANDIDATES_IMPORT_HREF} onClick={open}>
            {t("shell.dashboard.uploadCta")}
          </a>
        </Button>
      ) : null}
    </section>
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

  const { data, loading, refresh } = useQuery(`dashboard:${org.id}`, async () => {
    const supabase = await requireSupabase();
    const [pool, briefs] = await Promise.all([
      readPoolGlance(supabase, org.id),
      // The briefs are the page's heart, but a failed read leaves them null and the rest stands.
      readBriefsOverview(supabase, org.id).catch((caught: unknown) => {
        console.error(caught);
        return null;
      }),
    ]);
    return { pool, briefs };
  });

  useEffect(() => {
    const soon = debounce(() => void refresh());
    const filter = `org_id=eq.${org.id}`;
    const stops = ["briefs", "searches", "shortlist_items", "comments", "documents"].map((table) =>
      subscribeToTable(table, filter, soon),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [org.id, refresh]);

  const pool = data?.pool ?? null;
  const poolEmpty = pool !== null && pool.candidates === 0 && (pool.processing ?? 0) === 0;
  const briefs = data?.briefs ?? null;
  const member = can("member");
  // One filled button per view: the import while the pool is empty, the new brief in the briefs'
  // empty state when there is none, the header's otherwise.
  const briefsEmpty = briefs !== null && briefs.length === 0;
  const newBrief = (variant: "primary" | "outline") => (
    <Button asChild variant={variant} icon={<Plus />}>
      <Link to={NEW_BRIEF_PATH}>{t("shell.dashboard.briefCta")}</Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("shell.dashboard.title", { name })}
        meta={
          <time
            dateTime={new Date().toISOString().slice(0, 10)}
            className="text-meta text-muted-foreground"
          >
            {longDate(locale)}
          </time>
        }
        actions={
          member && !(briefsEmpty && !poolEmpty)
            ? newBrief(poolEmpty ? "outline" : "primary")
            : null
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
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
            <div className="sheet overflow-hidden">
              <SkeletonRows rows={3} avatar={false} />
            </div>
          ) : briefs === null ? (
            <EmptyState
              compact
              icon={<TriangleAlert />}
              title={t("dashboard.briefs.error")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  icon={<RefreshCw />}
                  onClick={() => void refresh()}
                >
                  {t("common.retry")}
                </Button>
              }
            />
          ) : briefs.length === 0 ? (
            <EmptyState
              compact
              icon={<Briefcase />}
              title={t("dashboard.briefs.empty")}
              action={member && !poolEmpty ? newBrief("primary") : undefined}
            />
          ) : (
            <ul className="sheet stagger divide-y divide-border overflow-hidden">
              {briefs.map((item) => (
                <li key={item.brief.id} className="rise-in">
                  <BriefRow item={item} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-8">
          <MyMentions limit={MENTIONS} />
          <PoolLine pool={pool} poolEmpty={poolEmpty} canImport={member} />
        </div>
      </div>
    </>
  );
}
