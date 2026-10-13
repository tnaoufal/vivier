/**
 * /app/candidates: the talent pool. A debounced search over the name,
 * the headline and the location, tabs for active and archived, tag
 * chips from the loaded page, fifty rows a page, and the two ways in:
 * a batch of CVs or a candidate typed by hand. A banner above the list
 * follows the documents the service is reading, live through realtime
 * on documents.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Upload, UserPlus, Users } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { CandidateRow } from "@/components/candidates/candidate-row";
import { ManualCandidateDialog } from "@/components/candidates/manual-candidate-dialog";
import { ProcessingBanner } from "@/components/candidates/processing-banner";
import { UploadDialog } from "@/components/candidates/upload-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { distinctTags } from "@/lib/candidates/format";
import { listCandidates, readProcessingCounts } from "@/lib/candidates/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { CandidateStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/candidates/")({
  component: CandidatesPage,
});

const SEARCH_DEBOUNCE_MS = 300;

function isStatus(value: string): value is CandidateStatus {
  return value === "active" || value === "archived";
}

function CandidatesPage() {
  const t = useT();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");

  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CandidateStatus>("active");
  const [tag, setTag] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    setPage(0);
  }, [query, status, tag]);

  const list = useQuery(
    `candidates:${org.id}:${status}:${query}:${tag ?? ""}:${page}`,
    async () => listCandidates(await requireSupabase(), { orgId: org.id, status, text: query, tag, page }),
  );
  const counts = useQuery(`processing:${org.id}`, async () =>
    readProcessingCounts(await requireSupabase(), org.id),
  );

  const refreshList = list.refresh;
  const refreshCounts = counts.refresh;
  useEffect(() => {
    const refresh = debounce(() => {
      void refreshList();
      void refreshCounts();
    }, 400);
    return subscribeToTable("documents", `org_id=eq.${org.id}`, refresh);
  }, [org.id, refreshList, refreshCounts]);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = list.data?.pageCount ?? 1;
  const tags = useMemo(() => {
    const onPage = distinctTags(rows);
    return tag && !onPage.includes(tag) ? [tag, ...onPage] : onPage;
  }, [rows, tag]);
  const filtered = query.length > 0 || tag !== null;

  const countText = list.loading && !list.data
    ? t("common.loading")
    : total === 0
      ? t("candidates.count.none")
      : total === 1
        ? t("candidates.count.one")
        : t("candidates.count.many", { count: total });

  const importButton = canEdit ? (
    <Button type="button" onClick={() => setUploadOpen(true)} className="gap-1.5">
      <Upload />
      {t("candidates.import")}
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        title={t("candidates.title")}
        description={countText}
        actions={
          canEdit ? (
            <>
              <Button type="button" variant="outline" onClick={() => setManualOpen(true)} className="gap-1.5">
                <UserPlus />
                {t("candidates.manual")}
              </Button>
              {importButton}
            </>
          ) : null
        }
      />

      <ProcessingBanner
        orgId={org.id}
        counts={counts.data ?? { pending: 0, failed: 0 }}
        canEdit={canEdit}
        onChanged={() => {
          void refreshCounts();
        }}
      />

      <div className="sheet mb-4 space-y-3 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("candidates.search.placeholder")}
              aria-label={t("common.search")}
              maxLength={200}
              className="pl-9"
            />
          </div>
          <Tabs
            value={status}
            onValueChange={(value) => {
              if (isStatus(value)) setStatus(value);
            }}
          >
            <TabsList>
              <TabsTrigger value="active">{t("candidates.tab.active")}</TabsTrigger>
              <TabsTrigger value="archived">{t("candidates.tab.archived")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {tags.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label-caps mr-1">{t("candidates.tags.filterLabel")}</span>
            <Button type="button" size="sm" variant={tag === null ? "default" : "outline"} onClick={() => setTag(null)}>
              {t("common.all")}
            </Button>
            {tags.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={tag === value ? "default" : "outline"}
                onClick={() => setTag(tag === value ? null : value)}
              >
                {value}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {list.error ? (
        <EmptyState
          title={t("candidates.listError")}
          action={
            <Button type="button" variant="outline" onClick={() => void refreshList()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : list.loading && !list.data ? (
        <div className="sheet divide-y divide-border">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex gap-3 px-4 py-3">
              <div className="skeleton size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-1/3 rounded" />
                <div className="skeleton h-3 w-2/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search />}
            title={t("candidates.empty.filtered.title")}
            text={t("candidates.empty.filtered.text")}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setText("");
                  setTag(null);
                }}
              >
                {t("common.all")}
              </Button>
            }
          />
        ) : status === "archived" ? (
          <EmptyState
            icon={<Users />}
            title={t("candidates.empty.archived.title")}
            text={t("candidates.empty.archived.text")}
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title={t("candidates.empty.title")}
            text={t("candidates.empty.text")}
            action={importButton}
          />
        )
      ) : (
        <>
          <ul className="sheet overflow-hidden">
            {rows.map((row) => (
              <CandidateRow key={row.id} row={row} />
            ))}
          </ul>
          {pageCount > 1 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{t("candidates.page", { page: page + 1, count: pageCount })}</span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || list.loading}>
                  {t("candidates.previous")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1 || list.loading}>
                  {t("common.next")}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          void refreshCounts();
        }}
      />
      <ManualCandidateDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={(candidateId) => {
          void navigate({ to: "/app/candidates/$candidateId", params: { candidateId } });
        }}
      />
    </div>
  );
}
