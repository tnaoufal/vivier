/**
 * /app/briefs: the briefs of the organisation, newest change first, with
 * a status filter and the way to a new one. Live through realtime on
 * briefs.
 */
import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Briefcase, Plus } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { BriefStatusPill } from "@/components/briefs/brief-status-pill";
import { Button } from "@/components/ui/button";
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

function isFilter(value: string): value is Filter {
  return (FILTERS as readonly string[]).includes(value);
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
    <Button type="button" onClick={() => void navigate({ to: "/app/briefs/new" })} className="gap-1.5">
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
      <PageHeader title={t("briefs.title")} description={countText} actions={newButton} />

      <div className="mb-4">
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
        <div className="sheet divide-y divide-border">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2 px-4 py-3">
              <div className="skeleton h-4 w-1/3 rounded" />
              <div className="skeleton h-3 w-2/3 rounded" />
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
        <ul className="sheet overflow-hidden">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-border last:border-b-0">
              <Link
                to="/app/briefs/$briefId"
                params={{ briefId: row.id }}
                className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium text-ink">{row.title}</span>
                    <BriefStatusPill status={row.status} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{row.description.trim() || t("briefs.list.noDescription")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>{criteriaText(row.criteria.length)}</span>
                  <span>{t("briefs.list.updated", { date: formatDate(locale, row.updated_at) })}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
