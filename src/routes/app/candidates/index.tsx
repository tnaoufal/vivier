/**
 * /app/candidates: the talent pool. The header carries the pool's one
 * figure (the profiles, and the CVs being read while a wave runs) and
 * the one filled action, the import; a person typed in by hand waits in
 * the header's menu and in the empty state. One toolbar: a search over
 * the name, the headline and the location (debounced), a sort, and a
 * "Filtrer" button that opens the filters in a popover (the location,
 * the years, a skill, a tag when the page holds some, and whether the
 * archived profiles are listed too), its count on the button. Then
 * fifty rows a page in a sheet, 64px each, rising in once. A banner
 * above the list follows the documents the service is reading (the
 * wave's progress, what waits for the month's quota, what failed), live
 * through realtime on documents and every fifteen seconds while
 * something is pending (the list too: a dense burst of events keeps the
 * debounce from firing), and keeps the start of the wave it follows
 * between two reads so the bar never steps back. The page accepts
 * `?import=1` (the dashboard's "Importer des CV"): the import dialog
 * opens once for a member and the param is dropped.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Ellipsis,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { CandidateRow } from "@/components/candidates/candidate-row";
import { ManualCandidateDialog } from "@/components/candidates/manual-candidate-dialog";
import { ProcessingBanner } from "@/components/candidates/processing-banner";
import { UploadDialog } from "@/components/candidates/upload-dialog";
import { Switch } from "@/components/team/switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { distinctSkills, distinctTags, formatCount, parseYearsMin } from "@/lib/candidates/format";
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
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";

export const Route = createFileRoute("/app/candidates/")({
  // `?import=1` opens the import dialog once (the dashboard's button); the router parses
  // the value as a number, a link written by hand may carry a string: both are accepted.
  validateSearch: (search: Record<string, unknown>): { import?: true } =>
    search["import"] === 1 || search["import"] === "1" || search["import"] === true
      ? { import: true }
      : {},
  component: CandidatesPage,
});

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 6;
/** While something is pending, the wave is read again this often: the rate and the estimate follow the clock. */
const PROGRESS_INTERVAL_MS = 15_000;

/** The typed filters, before the debounce turns them into a query; the archived switch applies at once. */
interface FilterText {
  location: string;
  years: string;
  skill: string;
  tag: string;
}

const EMPTY_TEXT: FilterText = { location: "", years: "", skill: "", tag: "" };

/** What a popover field may add to its input: the digits keyboard, a shorter length, a datalist. */
interface FilterFieldExtra {
  inputMode?: "numeric";
  maxLength?: number;
  className?: string;
  list?: string;
}

function toFilters(text: FilterText, archived: boolean): CandidateListFilters {
  return {
    location: text.location.trim(),
    yearsMin: parseYearsMin(text.years),
    skill: text.skill.trim(),
    tag: text.tag.trim(),
    archived,
  };
}

function CandidatesPage() {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can, showPhotos } = useOrg();
  const { import: importParam } = Route.useSearch();
  const navigate = useNavigate();
  const canEdit = can("member");
  const ids = useId();

  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CandidateSort>("recent");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterText, setFilterText] = useState<FilterText>(EMPTY_TEXT);
  const [archived, setArchived] = useState(false);
  const [filters, setFilters] = useState<CandidateListFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters(toFilters(filterText, archived)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterText, archived]);

  // The dashboard's way in: the dialog opens once, then the address reads as the plain page.
  const importHandled = useRef(false);
  useEffect(() => {
    if (!importParam || importHandled.current) return;
    importHandled.current = true;
    if (canEdit) setUploadOpen(true);
    void navigate({ to: "/app/candidates", search: {}, replace: true });
  }, [importParam, canEdit, navigate]);

  const filterKey = `${filters.location}|${filters.yearsMin ?? ""}|${filters.skill}|${filters.tag}|${filters.archived ? 1 : 0}`;
  useEffect(() => {
    setPage(0);
  }, [query, sort, filterKey]);

  const list = useQuery(`candidates:${org.id}:${query}:${sort}:${filterKey}:${page}`, async () =>
    listCandidates(await requireSupabase(), { orgId: org.id, text: query, page, sort, filters }),
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
  const pending = wave.data?.pending ?? 0;
  const reading = pending > 0;
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
  // The suggestions come from the page on screen; a tag or a skill typed stays suggested while it filters.
  const tags = useMemo(() => {
    const onPage = distinctTags(rows);
    const chosen = filters.tag;
    return chosen && !onPage.includes(chosen) ? [chosen, ...onPage] : onPage;
  }, [rows, filters.tag]);
  const skillOptions = useMemo(() => distinctSkills(rows), [rows]);
  const activeFilters = activeFilterCount(filters);
  const filtered = query.length > 0 || activeFilters > 0;

  function clearFilters() {
    setFilterText(EMPTY_TEXT);
    setArchived(false);
    setFilters(EMPTY_FILTERS);
  }

  function clearAll() {
    setText("");
    clearFilters();
  }

  const countText =
    list.loading && !list.data
      ? t("common.loading")
      : total === 0
        ? t("candidates.count.none")
        : total === 1
          ? t("candidates.count.one")
          : t("candidates.count.many", { count: formatCount(locale, total) });
  const pendingText =
    pending === 1
      ? t("candidates.processing.pending.one")
      : t("candidates.processing.pending.many", { count: formatCount(locale, pending) });

  const importButton = canEdit ? (
    <Button type="button" icon={<Upload />} onClick={() => setUploadOpen(true)}>
      {t("candidates.import")}
    </Button>
  ) : null;
  const manualButton = canEdit ? (
    <Button type="button" variant="outline" icon={<UserPlus />} onClick={() => setManualOpen(true)}>
      {t("candidates.manual")}
    </Button>
  ) : null;
  // The same condition as the plain empty state below: it carries the two buttons then, and the
  // header keeps them the rest of the time, so a view never shows the filled one twice.
  const poolEmpty = !list.error && !(list.loading && !list.data) && rows.length === 0 && !filtered;

  /** One field of the popover: a label and its input; `extra` is what a field needs beyond the text. */
  const filterField = (key: keyof FilterText, label: string, extra: FilterFieldExtra = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`${ids}-${key}`}>{label}</Label>
      <Input
        id={`${ids}-${key}`}
        value={filterText[key]}
        onChange={(event) => setFilterText({ ...filterText, [key]: event.target.value })}
        maxLength={100}
        {...extra}
      />
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t("candidates.title")}
        meta={
          <>
            {/* The count is the page's one figure; announced when a search or a filter changes it. */}
            <span
              role="status"
              className="text-meta font-medium text-muted-foreground tabular-nums"
            >
              {countText}
            </span>
            {/* The pending figure moves with every CV read: shown, never announced. */}
            {pending > 0 ? (
              <span className="text-meta text-muted-foreground tabular-nums">· {pendingText}</span>
            ) : null}
          </>
        }
        actions={
          canEdit && !poolEmpty ? (
            <>
              {importButton}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    icon={<Ellipsis />}
                    aria-label={t("candidates.moreActions")}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setManualOpen(true)}>
                    <UserPlus />
                    {t("candidates.manual")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-64">
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
        <Select
          value={sort}
          onValueChange={(value) => {
            if (isCandidateSort(value)) setSort(value);
          }}
        >
          <SelectTrigger className="w-40" aria-label={t("candidates.sort.label")}>
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
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" icon={<SlidersHorizontal />}>
              {t("candidates.filters")}
              {activeFilters > 0 ? (
                <span className="font-normal text-muted-foreground tabular-nums">
                  {/* Keeps the label and the count two words in the accessible name ("Filtrer, 2"). */}
                  <span className="sr-only">, </span>
                  {activeFilters}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-4">
            {filterField("location", t("candidates.field.location"))}
            {filterField("years", t("candidates.filter.years"), {
              inputMode: "numeric",
              maxLength: 2,
              className: "tabular-nums",
            })}
            {filterField("skill", t("candidates.filter.skill"), { list: `${ids}-skills` })}
            <datalist id={`${ids}-skills`}>
              {skillOptions.map((skill) => (
                <option key={skill} value={skill} />
              ))}
            </datalist>
            {tags.length ? (
              <>
                {filterField("tag", t("candidates.field.tags"), { list: `${ids}-tags` })}
                <datalist id={`${ids}-tags`}>
                  {tags.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <span id={`${ids}-archived`} className="text-sm text-ink">
                {t("candidates.filter.archived")}
              </span>
              <Switch
                checked={archived}
                onCheckedChange={setArchived}
                aria-labelledby={`${ids}-archived`}
              />
            </div>
            {activeFilters > 0 ? (
              <Button type="button" variant="ghost" icon={<X />} onClick={clearFilters}>
                {t("candidates.filters.clear")}
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      {list.error ? (
        <EmptyState
          icon={<TriangleAlert />}
          title={t("candidates.listError")}
          action={
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw />}
              onClick={() => void refreshList()}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : list.loading && !list.data ? (
        <div className="sheet overflow-hidden">
          <p className="sr-only">{t("common.loading")}</p>
          <SkeletonRows rows={SKELETON_ROWS} avatarSize="sm" className="[&>li]:py-3" />
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search />}
            title={t("candidates.empty.filtered.title")}
            action={
              <Button type="button" variant="outline" icon={<X />} onClick={clearAll}>
                {t("candidates.filters.clear")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Users />}
            title={t("candidates.empty.title")}
            action={
              canEdit ? (
                <>
                  {importButton}
                  {manualButton}
                </>
              ) : undefined
            }
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
