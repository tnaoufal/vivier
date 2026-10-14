/**
 * /app/candidates: the talent pool. One toolbar that wraps (a debounced
 * search over the name, the headline and the location; tabs for active
 * and archived; tag chips from the loaded page), fifty rows a page in a
 * sheet, and the two ways in: a batch of CVs or a candidate typed by
 * hand. A banner above the list follows the documents the service is
 * reading (the set-aside counts and the wave's progress), live through
 * realtime on documents, and every fifteen seconds while something is
 * pending (the list too: a dense burst of events keeps the debounce
 * from firing) so the rate and the estimate move even between two
 * events. The page keeps the start of the wave it follows between two
 * reads, so the bar never steps back as the queue's earliest document
 * moves on, and the end of the wave is counted from it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Upload, UserPlus, Users } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { FilterChip } from "@/components/app-shell/filter-chip";
import { PageHeader } from "@/components/app-shell/page-header";
import { CandidateRow } from "@/components/candidates/candidate-row";
import { ManualCandidateDialog } from "@/components/candidates/manual-candidate-dialog";
import { ProcessingBanner } from "@/components/candidates/processing-banner";
import { UploadDialog } from "@/components/candidates/upload-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { distinctTags } from "@/lib/candidates/format";
import { listCandidates, readProcessingCounts, readProcessingProgress } from "@/lib/candidates/queries";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { CandidateStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/candidates/")({
  component: CandidatesPage,
});

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;
/** While something is pending, the wave is read again this often: the rate and the estimate follow the clock. */
const PROGRESS_INTERVAL_MS = 15_000;

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
  // The start of the wave this page follows: kept while something is pending, let go once the
  // wave ended, and never carried from one organisation to another.
  const waveStart = useRef<{ orgId: string; startedAt: string | null }>({ orgId: org.id, startedAt: null });
  const wave = useQuery(`processing-wave:${org.id}`, async () => {
    const held = waveStart.current.orgId === org.id ? waveStart.current.startedAt : null;
    const read = await readProcessingProgress(await requireSupabase(), org.id, { startedAt: held });
    waveStart.current = { orgId: org.id, startedAt: read.pending > 0 ? read.startedAt : null };
    return read;
  });

  const refreshList = list.refresh;
  const refreshCounts = counts.refresh;
  const refreshWave = wave.refresh;
  useEffect(() => {
    const refresh = debounce(() => {
      void refreshList();
      void refreshCounts();
      void refreshWave();
    }, 400);
    return subscribeToTable("documents", `org_id=eq.${org.id}`, refresh);
  }, [org.id, refreshList, refreshCounts, refreshWave]);

  // The throughput is a window on the clock: between two events it moves on its own. Keyed on
  // whether something is pending, not on how much, so the clock is steady across refreshes.
  const reading = (wave.data?.pending ?? 0) > 0;
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => {
      void refreshWave();
      void refreshCounts();
      void refreshList();
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reading, refreshWave, refreshCounts, refreshList]);

  const refreshProcessing = () => {
    void refreshCounts();
    void refreshWave();
  };

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
    <Button type="button" onClick={() => setUploadOpen(true)}>
      <Upload />
      {t("candidates.import")}
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.candidates")}
        title={t("candidates.title")}
        description={countText}
        actions={
          canEdit ? (
            <>
              <Button type="button" variant="outline" onClick={() => setManualOpen(true)}>
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
        counts={counts.data ?? { failed: 0, rejected: 0, quota: 0 }}
        wave={wave.data}
        canEdit={canEdit}
        onChanged={refreshProcessing}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("candidates.search.placeholder")}
            aria-label={t("common.search")}
            maxLength={200}
            className="pl-11"
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
        {tags.length ? (
          <ul className="flex w-full flex-wrap items-center gap-2" aria-label={t("candidates.tags.filterLabel")}>
            <li>
              <FilterChip active={tag === null} onClick={() => setTag(null)}>
                {t("common.all")}
              </FilterChip>
            </li>
            {tags.map((value) => (
              <li key={value} className="min-w-0">
                <FilterChip active={tag === value} onClick={() => setTag(tag === value ? null : value)}>
                  {value}
                </FilterChip>
              </li>
            ))}
          </ul>
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
        <div className="sheet overflow-hidden" aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className="sheet-row">
              <Skeleton className="size-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
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
          <ol className="sheet divide-y divide-border overflow-hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <CandidateRow row={row} />
              </li>
            ))}
          </ol>
          {pageCount > 1 ? (
            <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label={t("candidates.page", { page: page + 1, count: pageCount })}>
              <span className="text-[13px] leading-5 text-muted-foreground tabular-nums">
                {t("candidates.page", { page: page + 1, count: pageCount })}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || list.loading}>
                  {t("common.previous")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1 || list.loading}>
                  {t("common.next")}
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={refreshProcessing}
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
