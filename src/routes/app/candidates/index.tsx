/**
 * /app/candidates: the talent pool. One toolbar that wraps (a debounced
 * search over the name, the headline and the location; tabs for active
 * and archived; a sort in a select, so it does not read as a third tab;
 * quick filters on the location, the years and one skill, folded behind
 * a chip until used; tag chips from the loaded page), fifty rows a page
 * in a sheet that rise in once, and the two ways in: a batch of CVs or a
 * candidate typed by hand (the import is the one filled button, in the
 * header while the pool holds rows and in the empty state before). A banner above
 * the list follows the documents the service is reading (the set-aside
 * counts and the wave's progress), live through realtime on documents,
 * and every fifteen seconds while something is pending (the list too: a
 * dense burst of events keeps the debounce from firing) so the rate and
 * the estimate move even between two events. The page keeps the start
 * of the wave it follows between two reads, so the bar never steps back
 * as the queue's earliest document moves on, and the end of the wave is
 * counted from it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpDown,
  MapPin,
  Search,
  SlidersHorizontal,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { FilterChip } from "@/components/app-shell/filter-chip";
import { PageHeader } from "@/components/app-shell/page-header";
import { CandidateRow } from "@/components/candidates/candidate-row";
import { ManualCandidateDialog } from "@/components/candidates/manual-candidate-dialog";
import { ProcessingBanner } from "@/components/candidates/processing-banner";
import { UploadDialog } from "@/components/candidates/upload-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { distinctSkills, distinctTags, parseYearsMin } from "@/lib/candidates/format";
import {
  CANDIDATE_SORTS,
  EMPTY_FILTERS,
  activeFilterCount,
  isCandidateSort,
  listCandidates,
  readProcessingCounts,
  readProcessingProgress,
  type CandidateListFilters,
  type CandidateSort,
} from "@/lib/candidates/queries";
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

/** The quick filters as typed, before the debounce turns them into a query. */
interface FilterText {
  location: string;
  years: string;
  skill: string;
}

const EMPTY_TEXT: FilterText = { location: "", years: "", skill: "" };

function toFilters(text: FilterText): CandidateListFilters {
  return {
    location: text.location.trim(),
    yearsMin: parseYearsMin(text.years),
    skill: text.skill.trim(),
  };
}

function CandidatesPage() {
  const t = useT();
  const { org } = useCurrentOrg();
  const { can, showPhotos } = useOrg();
  const navigate = useNavigate();
  const canEdit = can("member");

  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CandidateStatus>("active");
  const [sort, setSort] = useState<CandidateSort>("recent");
  const [tag, setTag] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterText, setFilterText] = useState<FilterText>(EMPTY_TEXT);
  const [filters, setFilters] = useState<CandidateListFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters(toFilters(filterText)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterText]);

  const filterKey = `${filters.location}|${filters.yearsMin ?? ""}|${filters.skill}`;
  useEffect(() => {
    setPage(0);
  }, [query, status, tag, sort, filterKey]);

  const list = useQuery(
    `candidates:${org.id}:${status}:${query}:${tag ?? ""}:${sort}:${filterKey}:${page}`,
    async () =>
      listCandidates(await requireSupabase(), {
        orgId: org.id,
        status,
        text: query,
        tag,
        page,
        sort,
        filters,
      }),
  );
  const counts = useQuery(`processing:${org.id}`, async () =>
    readProcessingCounts(await requireSupabase(), org.id),
  );
  // The start of the wave this page follows: kept while something is pending, let go once the
  // wave ended, and never carried from one organisation to another.
  const waveStart = useRef<{ orgId: string; startedAt: string | null }>({
    orgId: org.id,
    startedAt: null,
  });
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
  const skillOptions = useMemo(() => distinctSkills(rows), [rows]);
  const activeFilters = activeFilterCount(filters);
  const filtered = query.length > 0 || tag !== null || activeFilters > 0;
  const showFilters = filtersOpen || activeFilters > 0;

  function clearAll() {
    setText("");
    setTag(null);
    setFilterText(EMPTY_TEXT);
    setFilters(EMPTY_FILTERS);
  }

  const countText =
    list.loading && !list.data
      ? t("common.loading")
      : total === 0
        ? t("candidates.count.none")
        : total === 1
          ? t("candidates.count.one")
          : t("candidates.count.many", { count: total });

  const importButton = canEdit ? (
    <Button type="button" icon={<Upload />} onClick={() => setUploadOpen(true)}>
      {t("candidates.import")}
    </Button>
  ) : null;
  // The same condition as the plain empty state below: it carries the one filled button then,
  // and the header keeps it the rest of the time, so a view never shows two.
  const poolEmpty =
    !list.error &&
    !(list.loading && !list.data) &&
    rows.length === 0 &&
    !filtered &&
    status === "active";

  return (
    <div>
      <PageHeader
        eyebrow={t("nav.candidates")}
        title={t("candidates.title")}
        description={countText}
        actions={
          canEdit ? (
            <>
              <Button
                type="button"
                variant="outline"
                icon={<UserPlus />}
                onClick={() => setManualOpen(true)}
              >
                {t("candidates.manual")}
              </Button>
              {poolEmpty ? null : importButton}
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

      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
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
            <TabsList aria-label={t("candidates.tab.label")}>
              <TabsTrigger value="active">{t("candidates.tab.active")}</TabsTrigger>
              <TabsTrigger value="archived">{t("candidates.tab.archived")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            value={sort}
            onValueChange={(value) => {
              if (isCandidateSort(value)) setSort(value);
            }}
          >
            <SelectTrigger
              className="w-44 [&>span]:flex-1 [&>span]:text-left"
              aria-label={t("candidates.sort.label")}
            >
              <ArrowUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANDIDATE_SORTS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`candidates.sort.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FilterChip
            active={showFilters}
            onClick={() => setFiltersOpen((value) => !value)}
            icon={<SlidersHorizontal />}
            count={activeFilters > 0 ? activeFilters : undefined}
          >
            {t("candidates.filters")}
          </FilterChip>
        </div>

        {showFilters ? (
          <div className="fade-in flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 basis-56">
              <MapPin
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={filterText.location}
                onChange={(event) => setFilterText({ ...filterText, location: event.target.value })}
                placeholder={t("candidates.filter.location")}
                aria-label={t("candidates.field.location")}
                maxLength={100}
                className="pl-11"
              />
            </div>
            <Input
              inputMode="numeric"
              value={filterText.years}
              onChange={(event) => setFilterText({ ...filterText, years: event.target.value })}
              placeholder={t("candidates.filter.years")}
              aria-label={t("candidates.filter.years")}
              maxLength={2}
              className="w-32 tabular-nums"
            />
            <Input
              list="candidate-skill-options"
              value={filterText.skill}
              onChange={(event) => setFilterText({ ...filterText, skill: event.target.value })}
              placeholder={t("candidates.filter.skill")}
              aria-label={t("candidates.filter.skill")}
              title={t("candidates.filter.skill.help")}
              maxLength={60}
              className="min-w-0 basis-56"
            />
            <datalist id="candidate-skill-options">
              {skillOptions.map((skill) => (
                <option key={skill} value={skill} />
              ))}
            </datalist>
            {activeFilters > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<X />}
                onClick={() => {
                  setFilterText(EMPTY_TEXT);
                  setFilters(EMPTY_FILTERS);
                }}
              >
                {t("candidates.filters.clear")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {tags.length ? (
          <ul
            className="flex w-full flex-wrap items-center gap-2"
            aria-label={t("candidates.tags.filterLabel")}
          >
            <li>
              <FilterChip active={tag === null} onClick={() => setTag(null)}>
                {t("common.all")}
              </FilterChip>
            </li>
            {tags.map((value) => (
              <li key={value} className="min-w-0">
                <FilterChip
                  active={tag === value}
                  onClick={() => setTag(tag === value ? null : value)}
                >
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
        <div className="sheet overflow-hidden">
          <p className="sr-only">{t("common.loading")}</p>
          <SkeletonRows rows={SKELETON_ROWS} />
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search />}
            title={t("candidates.empty.filtered.title")}
            text={t("candidates.empty.filtered.text")}
            action={
              <Button type="button" variant="outline" icon={<X />} onClick={clearAll}>
                {t("candidates.filters.clear")}
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
          <ol className="sheet stagger divide-y divide-border overflow-hidden">
            {rows.map((row) => (
              <li key={row.id} className="rise-in">
                <CandidateRow row={row} showPhotos={showPhotos} />
              </li>
            ))}
          </ol>
          {pageCount > 1 ? (
            <nav
              className="mt-6 flex flex-wrap items-center justify-between gap-3"
              aria-label={t("candidates.page", { page: page + 1, count: pageCount })}
            >
              <span className="text-meta text-muted-foreground tabular-nums">
                {t("candidates.page", { page: page + 1, count: pageCount })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={page === 0 || list.loading}
                >
                  {t("common.previous")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                  disabled={page >= pageCount - 1 || list.loading}
                >
                  {t("common.next")}
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={refreshProcessing} />
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
