/**
 * /app/candidates on the plane: the pool as a list and a sheet. The
 * header carries the pool's figure (the profiles, and the CVs being
 * read while a wave runs), the search (debounced; at the top of the
 * list pane below `lg`), "Filtrer" with its count (the filters in a
 * popover: the location, the years, a skill, a tag when the page holds
 * some, the archived profiles or not), the one filled action, the
 * import, the thread's toggle for the selected profile and a menu with
 * the person typed in by hand. The list pane (520px): the sort as chips
 * (the seniority first by default), the processing facts while
 * something is pending or failed (live through realtime on documents
 * and every fifteen seconds while something is pending, the list too:
 * a dense burst of events keeps the debounce from firing; the start of
 * the wave kept between two reads so the bar never steps back), fifty
 * rows a page (the photo or the initials, the name and the position
 * held today, the seniority, the place and three skills, the date from
 * `sm`), the page's figure and "Suivants" at the bottom. `?c=<id>` is
 * the selected profile, shown in the detail pane as a CandidateSheet;
 * from `lg` the first row is selected when `c` is absent and the arrow
 * keys move the selection; below `lg` a row leads to the candidate's
 * page and the detail pane does not show. The thread pane follows the
 * selected profile. `?import=1` (the dashboard's "Importer des CV")
 * opens the import dialog once for a member and the param is dropped.
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Ellipsis,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Row, RowText, useListKeys } from "@/components/app-shell/row";
import { PHONE_ICON, Pane, Workspace } from "@/components/app-shell/workspace";
import { CandidateSheet } from "@/components/candidates/candidate-sheet";
import { ManualCandidateDialog } from "@/components/candidates/manual-candidate-dialog";
import { ProcessingBanner } from "@/components/candidates/processing-banner";
import { UploadDialog } from "@/components/candidates/upload-dialog";
import { Switch } from "@/components/team/switch";
import { ThreadPane, ThreadToggle, useThreadPane } from "@/components/thread/thread-pane";
import { useDesktop } from "@/components/thread/use-desktop";
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
import { SkeletonRows } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/tabs";
import { candidatePath } from "@/lib/activity/links";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import {
  currentPosition,
  displayName,
  distinctSkills,
  distinctTags,
  formatCount,
  listLine,
  parseYearsMin,
} from "@/lib/candidates/format";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  listCandidates,
  readProcessingCounts,
  readProcessingProgress,
  type CandidateListFilters,
  type CandidateListRow,
  type CandidateSort,
} from "@/lib/candidates/queries";
import { useCandidate } from "@/lib/candidates/use-candidate";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { useTeamMembers } from "@/lib/shortlists/use-members";
import { cn } from "@/lib/utils";

/** `import=1` opens the import dialog once (the dashboard's button); `c` is the selected profile. */
interface PoolSearch {
  import?: true;
  c?: string;
}

export const Route = createFileRoute("/app/candidates/")({
  // The router parses `import` as a number, a link written by hand may carry a string: both are accepted.
  validateSearch: (search: Record<string, unknown>): PoolSearch => {
    const out: PoolSearch = {};
    if (search["import"] === 1 || search["import"] === "1" || search["import"] === true)
      out.import = true;
    if (typeof search["c"] === "string" && search["c"]) out.c = search["c"];
    return out;
  },
  component: CandidatesPage,
});

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 8;
/** While something is pending, the wave is read again this often: the rate and the estimate follow the clock. */
const PROGRESS_INTERVAL_MS = 15_000;
/** The sorts as the chips order them: the seniority first, the default. */
const SORTS: readonly CandidateSort[] = ["experience", "recent", "name"];

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
  const { can } = useOrg();
  const { user } = useAuth();
  const members = useTeamMembers();
  const { import: importParam, c } = Route.useSearch();
  const navigate = useNavigate();
  const desktop = useDesktop();
  const thread = useThreadPane();
  const canEdit = can("member");
  const ids = useId();

  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CandidateSort>("experience");
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

  // The dashboard's way in: the dialog opens once, then the address reads as the plain page (the selection kept).
  const importHandled = useRef(false);
  useEffect(() => {
    if (!importParam || importHandled.current) return;
    importHandled.current = true;
    if (canEdit) setUploadOpen(true);
    void navigate({ to: "/app/candidates", search: c ? { c } : {}, replace: true });
  }, [importParam, c, canEdit, navigate]);

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

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
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
  const loading = list.loading && !list.data;
  // The same condition as the plain empty state below: it carries the filled button then, and the
  // header keeps it the rest of the time, so a view never shows the filled one twice.
  const poolEmpty = !list.error && !loading && rows.length === 0 && !filtered;

  // The selection lives in the URL; from `lg` the first row stands in when it names none. Below
  // `lg` nothing is selected: a row is a link to the candidate's page.
  const selectedId = desktop ? (c ?? rows[0]?.id ?? null) : null;
  const index = rows.findIndex((row) => row.id === selectedId);
  const target = useMemo(() => (selectedId ? { candidateId: selectedId } : null), [selectedId]);

  function select(candidateId: string | null) {
    void navigate({
      to: "/app/candidates",
      search: candidateId ? { c: candidateId } : {},
      replace: true,
    });
  }
  const rowId = (candidateId: string) => `${ids}-row-${candidateId}`;
  const onKeys = useListKeys(rows.length, index, (next) => {
    const row = rows[next];
    if (!row) return;
    select(row.id);
    // The row is already in the list: it comes into view at once, with the selection.
    document.getElementById(rowId(row.id))?.scrollIntoView({ block: "nearest" });
  });

  /** The profile erased from the sheet: the list reads again, then the selection falls back to its first row. */
  async function erased() {
    await refreshList();
    select(null);
  }

  function clearFilters() {
    setFilterText(EMPTY_TEXT);
    setArchived(false);
    setFilters(EMPTY_FILTERS);
  }

  function clearAll() {
    setText("");
    clearFilters();
  }

  const countText = loading
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

  /** The import: in the header it shrinks to its icon on a phone, in the empty state it keeps its word. */
  const importButton = (inHeader: boolean) =>
    canEdit ? (
      <Button
        type="button"
        icon={<Upload />}
        onClick={() => setUploadOpen(true)}
        aria-label={inHeader ? t("candidates.import") : undefined}
        className={inHeader ? PHONE_ICON : undefined}
      >
        <span className={inHeader ? "max-sm:sr-only" : undefined}>{t("candidates.import")}</span>
      </Button>
    ) : null;
  const manualButton = canEdit ? (
    <Button type="button" variant="outline" icon={<UserPlus />} onClick={() => setManualOpen(true)}>
      {t("candidates.manual")}
    </Button>
  ) : null;

  /** The search: in the header from `lg`, at the top of the list pane below. */
  const searchField = (className: string) => (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
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
  );

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

  const filterButton = (
    <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" icon={<SlidersHorizontal />} className={PHONE_ICON}>
          <span className="max-sm:sr-only">{t("candidates.filters")}</span>
          {activeFilters > 0 ? (
            <span className="font-normal text-muted-foreground tabular-nums max-sm:sr-only">
              {/* Keeps the label and the count two words in the accessible name ("Filtrer, 2"). */}
              <span className="sr-only">, </span>
              {activeFilters}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t("candidates.filters")} className="w-80 space-y-4">
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
  );

  const pageText = t("candidates.page", { page: page + 1, count: pageCount });

  return (
    <Workspace
      title={t("candidates.title")}
      meta={
        <>
          {/* The count is the page's one figure; announced when a search or a filter changes it. */}
          <span role="status" className="font-medium tabular-nums">
            {countText}
          </span>
          {/* The pending figure moves with every CV read: shown, never announced. */}
          {pending > 0 ? <span className="tabular-nums">· {pendingText}</span> : null}
        </>
      }
      actions={
        <>
          {poolEmpty ? null : searchField("max-lg:hidden w-48 xl:w-80")}
          {poolEmpty ? null : filterButton}
          {canEdit && !poolEmpty ? importButton(true) : null}
          {target ? (
            <ThreadToggle open={thread.open} onToggle={thread.toggle} target={target} />
          ) : null}
          {canEdit && !poolEmpty ? (
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
          ) : null}
        </>
      }
    >
      <Pane
        label={t("candidates.pane.profiles")}
        width="wide"
        header={
          poolEmpty ? undefined : (
            <div className="flex flex-col gap-2 px-3 py-2">
              <div className="lg:hidden">{searchField("w-full")}</div>
              <div className="flex items-center gap-2">
                <span className="label-caps shrink-0">{t("candidates.sort.label")}</span>
                <Segmented
                  size="sm"
                  value={sort}
                  onChange={setSort}
                  aria-label={t("candidates.sort.label")}
                  options={SORTS.map((value) => ({ value, label: t(`candidates.sort.${value}`) }))}
                />
              </div>
            </div>
          )
        }
        footer={
          pageCount > 1 ? (
            <nav
              aria-label={pageText}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
            >
              <span className="text-meta text-muted-foreground tabular-nums">{pageText}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={page === 0 || list.loading}
                >
                  {t("candidates.page.previous")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                  disabled={page >= pageCount - 1 || list.loading}
                >
                  {t("candidates.page.next")}
                </Button>
              </div>
            </nav>
          ) : undefined
        }
      >
        <ProcessingBanner
          orgId={org.id}
          counts={counts.data ?? { failed: 0, rejected: 0, quota: 0 }}
          wave={wave.data}
          canEdit={canEdit}
          onChanged={refreshProcessing}
        />
        {list.error ? (
          <EmptyState
            quiet
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
        ) : loading ? (
          <>
            <p className="sr-only">{t("common.loading")}</p>
            <SkeletonRows rows={SKELETON_ROWS} className="[&>li]:px-3 sm:[&>li]:px-3" />
          </>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              quiet
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
              quiet
              icon={<Users />}
              title={t("candidates.empty.title")}
              action={
                canEdit ? (
                  <>
                    {importButton(false)}
                    {manualButton}
                  </>
                ) : undefined
              }
            />
          )
        ) : (
          <ol
            className="stagger focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
            tabIndex={desktop ? 0 : undefined}
            onKeyDown={desktop ? onKeys : undefined}
          >
            {rows.map((row) => (
              <Fragment key={row.id}>
                <PoolRow
                  row={row}
                  id={rowId(row.id)}
                  desktop={desktop}
                  selected={row.id === selectedId}
                  onSelect={() => select(row.id)}
                />
              </Fragment>
            ))}
          </ol>
        )}
      </Pane>

      <Pane label={t("candidates.pane.sheet")} width="fill" className="max-lg:hidden">
        {selectedId ? (
          <Fragment key={selectedId}>
            <SelectedProfile
              candidateId={selectedId}
              onChanged={() => void refreshList()}
              onErased={erased}
            />
          </Fragment>
        ) : loading ? null : (
          <EmptyState quiet icon={<UserRound />} title={t("candidates.none.selected")} />
        )}
      </Pane>

      {target ? (
        <ThreadPane
          target={target}
          canPost={canEdit}
          members={members}
          currentUserId={user?.id ?? null}
          open={thread.open}
          onOpenChange={thread.setOpen}
        />
      ) : null}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={refreshProcessing} />
      <ManualCandidateDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={(candidateId) => {
          void navigate({ to: "/app/candidates/$candidateId", params: { candidateId } });
        }}
      />
    </Workspace>
  );
}

/**
 * One row of the pool: the photo when the organisation shows photos and
 * the CV had one (the initials otherwise), the name with the position
 * held today, then the seniority, the place and the three skills the CV
 * put first; the last update from `sm`. A fact the CV does not state
 * is simply absent (the sheet says "not stated"); an archived profile,
 * listed on demand, carries the one pill that tells it apart. From `lg`
 * the row selects the profile; below, it leads to its page.
 */
function PoolRow({
  row,
  id,
  desktop,
  selected,
  onSelect,
}: {
  row: CandidateListRow;
  /** The row's DOM id, so the arrow keys can bring it into view. */
  id: string;
  desktop: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, locale } = useI18n();
  const { showPhotos } = useOrg();
  const name = displayName(row, t("candidates.noName"));
  const photoUrl = usePhotoUrl(row.photo_path, showPhotos);
  const position = currentPosition(row);
  const line = listLine(locale, row);
  return (
    <Row
      id={id}
      as={desktop ? "button" : "link"}
      to={desktop ? undefined : candidatePath(row.id)}
      onClick={desktop ? onSelect : undefined}
      selected={selected}
      height="md"
      className="rise-in"
      leading={
        <Avatar name={name} size="md" className="size-10 text-sm" photoUrl={photoUrl} decorative />
      }
    >
      <RowText
        title={
          <>
            {name}
            {position ? (
              <span className="font-normal">
                {" "}
                · {position.title}
                {position.company ? (
                  <span className="text-muted-foreground">
                    {" "}
                    {t("candidates.atCompany", { company: position.company })}
                  </span>
                ) : null}
              </span>
            ) : null}
            {row.status === "archived" ? (
              <Pill size="sm" className="ml-2 align-middle">
                {t("candidates.status.archived")}
              </Pill>
            ) : null}
          </>
        }
        line={line || undefined}
      />
      <time
        dateTime={row.updated_at}
        className="hidden shrink-0 text-meta text-muted-foreground tabular-nums sm:block"
      >
        {formatDate(locale, row.updated_at)}
      </time>
    </Row>
  );
}

/** The selected profile, read for its id (and read again when its documents change). */
function SelectedProfile({
  candidateId,
  onChanged,
  onErased,
}: {
  candidateId: string;
  onChanged: () => void;
  onErased: () => void;
}) {
  const { org } = useCurrentOrg();
  const state = useCandidate(org.id, candidateId);
  return <CandidateSheet state={state} onChanged={onChanged} onErased={onErased} />;
}
