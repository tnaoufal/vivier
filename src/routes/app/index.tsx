/**
 * The dashboard on the plane: the greeting and the date in the header,
 * one filled button (a new brief; the import while the pool is empty);
 * the open briefs as rows in the wide pane (the newest analysis, what
 * the team retained, the thread's last word), the most recently active
 * first; the fill pane with what asks for the person (the mentions) and
 * the pool in one line with its bar and its import. Figures, no
 * sentences. Everything re-reads when the briefs, the searches, the
 * shortlists, the threads or the documents change.
 */
import { Fragment, useEffect, type MouseEvent } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { Briefcase, Plus, RefreshCw, TriangleAlert, Upload } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { ProgressBar } from "@/components/app-shell/progress-bar";
import { ROW_SKELETON, Row, RowText } from "@/components/app-shell/row";
import { Section } from "@/components/app-shell/section";
import { PHONE_ICON, Pane, PaneTitle, Workspace } from "@/components/app-shell/workspace";
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
import { useI18n, type Locale, type TranslationKey } from "@/lib/i18n";
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
 * One open brief as a row: its title, then one line with where the
 * analysis stands, what the team retained (only when someone was) and
 * the thread's last word with who wrote it. The row is the link.
 */
function BriefRow({ item }: { item: BriefOverview }) {
  const { t, locale } = useI18n();
  const { members } = useOrg();
  const { brief, analysis, retained, thread } = item;
  const author = thread
    ? memberName(members.get(thread.lastAuthorId), t("thread.formerMember"))
    : null;
  return (
    <Row as="link" to={briefPath(brief.id)} height="lg" className="rise-in">
      <RowText
        title={brief.title}
        line={
          <>
            {analysisText(analysis, locale, t)}
            {retained > 0 ? (
              <>
                <span aria-hidden="true"> · </span>
                {retained === 1
                  ? t("dashboard.briefs.retained.one")
                  : t("dashboard.briefs.retained.many", {
                      count: formatCount(locale, retained),
                    })}
              </>
            ) : null}
            {thread && author ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-medium text-ink">{author}</span>
                <span aria-hidden="true"> · </span>
                {thread.lastExcerpt}
              </>
            ) : null}
          </>
        }
      />
    </Row>
  );
}

/**
 * The pool in one block: the profiles (a link to the pool), the CVs
 * being read with their progress, and the import. The import is the
 * page's filled button only while the pool is empty (there is nothing
 * else to do first); the link opens the pool's page on its import
 * dialog, a free path pushed through the history so the page parses
 * its search itself.
 */
function PoolBlock({
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
    <Section title={t("nav.candidates")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
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
                  : t("dashboard.pool.processing.many", {
                      count: formatCount(locale, processing),
                    })}
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
      </div>
    </Section>
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
  /** The new brief: in the header it shrinks to its icon on a phone, in an empty state it keeps its word. */
  const newBrief = (variant: "primary" | "outline", inHeader = false) => (
    <Button asChild variant={variant} icon={<Plus />} className={inHeader ? PHONE_ICON : undefined}>
      <Link to={NEW_BRIEF_PATH} aria-label={inHeader ? t("shell.dashboard.briefCta") : undefined}>
        <span className={inHeader ? "max-sm:sr-only" : undefined}>
          {t("shell.dashboard.briefCta")}
        </span>
      </Link>
    </Button>
  );

  return (
    <Workspace
      title={t("shell.dashboard.title", { name })}
      meta={<time dateTime={new Date().toISOString().slice(0, 10)}>{longDate(locale)}</time>}
      actions={
        member && !(briefsEmpty && !poolEmpty)
          ? newBrief(poolEmpty ? "outline" : "primary", true)
          : null
      }
    >
      <Pane
        label={t("dashboard.briefs.title")}
        width="wide"
        header={
          <PaneTitle
            title={t("dashboard.briefs.title")}
            count={briefs ? briefs.length : undefined}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link to={BRIEFS_PATH}>{t("dashboard.briefs.all")}</Link>
              </Button>
            }
          />
        }
      >
        {loading && !data ? (
          <SkeletonRows rows={3} avatar={false} className={ROW_SKELETON.lg} />
        ) : briefs === null ? (
          <EmptyState
            quiet
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
            quiet
            icon={<Briefcase />}
            title={t("dashboard.briefs.empty")}
            action={member && !poolEmpty ? newBrief("primary") : undefined}
          />
        ) : (
          <ol className="stagger">
            {briefs.map((item) => (
              <Fragment key={item.brief.id}>
                <BriefRow item={item} />
              </Fragment>
            ))}
          </ol>
        )}
      </Pane>

      <Pane
        label={t("thread.mentions.title")}
        width="fill"
        bodyClassName="flex flex-col gap-6 p-4 sm:p-6"
      >
        <MyMentions limit={MENTIONS} />
        <PoolBlock pool={pool} poolEmpty={poolEmpty} canImport={member} />
      </Pane>
    </Workspace>
  );
}
