/**
 * /app/briefs: the briefs of the organisation as a grid of cards,
 * newest change first, with a status filter and the way to a new one.
 * Live through realtime on briefs.
 */
import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Briefcase, Plus } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { listBriefs } from "@/lib/briefs/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { BriefStatus } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/briefs/")({
  component: BriefsPage,
});

type Filter = BriefStatus | "all";

const FILTERS: readonly Filter[] = ["all", "open", "draft", "closed"];
const SKELETON_CARDS = 4;

function isFilter(value: string): value is Filter {
  return (FILTERS as readonly string[]).includes(value);
}

/** The first non-empty line of a description, for the card (the card clamps it to two lines). */
function firstLine(description: string): string {
  return description.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
}

function BriefsPage() {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");
  const [filter, setFilter] = useState<Filter>("all");

  const list = useQuery(`briefs:${org.id}:${filter}`, async () =>
    listBriefs(await requireSupabase(), org.id, filter === "all" ? null : filter),
  );
  const refresh = list.refresh;
  useEffect(
    () =>
      subscribeToTable(
        "briefs",
        `org_id=eq.${org.id}`,
        debounce(() => {
          void refresh();
        }, 400),
      ),
    [org.id, refresh],
  );

  const rows = list.data ?? [];
  const countText =
    list.loading && !list.data
      ? t("common.loading")
      : rows.length === 0
        ? t("briefs.count.none")
        : rows.length === 1
          ? t("briefs.count.one")
          : t("briefs.count.many", { count: rows.length });

  const newButton = canEdit ? (
    <Button type="button" onClick={() => void navigate({ to: "/app/briefs/new" })}>
      <Plus />
      {t("briefs.new")}
    </Button>
  ) : null;

  function criteriaText(count: number): string {
    if (count === 0) return t("briefs.list.criteria.none");
    if (count === 1) return t("briefs.list.criteria.one");
    return t("briefs.list.criteria.many", { count });
  }

  return (
    <div>
      <PageHeader eyebrow={t("nav.briefs")} title={t("briefs.title")} description={countText} actions={newButton} />

      <div className="mb-6">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            if (isFilter(value)) setFilter(value);
          }}
        >
          <TabsList>
            {FILTERS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value === "all" ? t("common.all") : t(`briefs.status.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {list.error ? (
        <EmptyState
          title={t("briefs.listError")}
          action={
            <Button type="button" variant="outline" onClick={() => void refresh()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : list.loading && !list.data ? (
        <div className="grid gap-6 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            <div key={index} className="sheet space-y-3 p-6">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        filter !== "all" ? (
          <EmptyState
            icon={<Briefcase />}
            title={t("briefs.empty.filtered.title")}
            text={t("briefs.empty.filtered.text")}
            action={
              <Button type="button" variant="outline" onClick={() => setFilter("all")}>
                {t("common.all")}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<Briefcase />} title={t("briefs.empty.title")} text={t("briefs.empty.text")} action={newButton} />
        )
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2">
          {rows.map((row) => {
            const description = firstLine(row.description);
            return (
              <li key={row.id} className="min-w-0">
                <Link
                  to="/app/briefs/$briefId"
                  params={{ briefId: row.id }}
                  className="sheet sheet-link flex h-full min-w-0 flex-col p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-6 text-ink break-words">{row.title}</h2>
                    <BriefStatusPill status={row.status} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground break-words">
                    {description || t("briefs.list.noDescription")}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-5 text-[13px] leading-5 text-muted-foreground">
                    <span className="tabular-nums">{criteriaText(row.criteria.length)}</span>
                    <span>{t("briefs.list.updated", { date: formatDate(locale, row.updated_at) })}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
