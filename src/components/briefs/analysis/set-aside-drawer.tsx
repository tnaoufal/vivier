/**
 * The profiles an analysis set aside, on demand: a drawer from the right
 * that the funnel's figure opens, its title carrying that same count and
 * marked as the model's reading. Two groups: the profiles set aside
 * after the full reading (no_fit), closest first, then the ones the
 * triage set aside, by candidate: another métier (the model's reason on
 * the row), or a card it could not judge ("Non lus" when the model
 * could not read it, "Fiche trop mince pour trancher" when it carried
 * no title and no position). Each row names the person, the position
 * held today and the reason, and leads to the profile; a person may
 * bring one the triage set aside back to be read in full ("Lire quand
 * même": the runner promotes it and reads it). A group shows fifty
 * rows, then "Voir plus": the triage's are read from search_triage page
 * by page under RLS (each page after the last id read, so a verdict
 * written meanwhile hides no row), and the candidates of the rows shown
 * in lots. The model proposed this; a person can always look, and
 * decides.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, CircleAlert, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { kindKey } from "@/lib/briefs/criteria";
import {
  appendPage,
  SET_ASIDE_PAGE,
  setAsideReason,
  type SetAsideReason,
} from "@/lib/briefs/presentation";
import {
  listSetAside,
  readCandidatesById,
  type ResultCandidate,
  type SetAsideEntry,
} from "@/lib/briefs/queries";
import { formatCount } from "@/lib/candidates/format";
import type { BriefCriterion, MatchResult } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";

import { AsideRows, MoreButton, type ShownRow } from "./aside-rows";

/** The triage's rows read so far, the last id read (the next page starts after it), how many there are in all, and whether the last page ended the list. */
interface TriageList {
  rows: SetAsideEntry[];
  cursor: string | null;
  total: number;
  ended: boolean;
}

export function SetAsideDrawer({
  open,
  onOpenChange,
  orgId,
  searchId,
  total,
  triageCount,
  read,
  criteria,
  canReadAnyway,
  onReadAnyway,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  /** The analysis listed; the parent keys the drawer by it, so another one reads afresh. */
  searchId: string;
  /** The funnel's figure: the title says it, and no other place in the drawer does. */
  total: number;
  /** The profiles the triage set aside, another métier or a card it could not judge (0 without a triage). */
  triageCount: number;
  /** The full readings decided no_fit, closest first. */
  read: readonly MatchResult[];
  /** The criteria of the analysis, which a missing must-have is named from. */
  criteria: readonly BriefCriterion[];
  /** True when the person may bring a profile the triage set aside back to be read in full. */
  canReadAnyway: boolean;
  /** Brings it back; true once stored. */
  onReadAnyway: (candidateId: string) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const readId = useId();
  const triageId = useId();
  const [readShown, setReadShown] = useState(SET_ASIDE_PAGE);
  const [triage, setTriage] = useState<TriageList | null>(null);
  const [triageBusy, setTriageBusy] = useState(false);
  const [triageFailed, setTriageFailed] = useState(false);
  const triageRef = useRef(triage);
  triageRef.current = triage;
  // One page at a time: a second click while one is read would ask for the same page.
  const reading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadTriage = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    setTriageBusy(true);
    setTriageFailed(false);
    const after = triageRef.current?.cursor ?? null;
    try {
      const page = await listSetAside(await requireSupabase(), orgId, searchId, {
        after,
        limit: SET_ASIDE_PAGE,
      });
      if (!mounted.current) return;
      setTriage((current) => {
        const rows = appendPage(current?.rows ?? [], page.rows);
        return {
          rows,
          cursor: page.rows[page.rows.length - 1]?.candidateId ?? current?.cursor ?? null,
          // The first page counts them all; a shorter page ends the list, whatever the count said.
          total: page.total ?? current?.total ?? rows.length,
          ended: page.rows.length < SET_ASIDE_PAGE,
        };
      });
    } catch (error) {
      console.error(error);
      if (mounted.current) setTriageFailed(true);
    } finally {
      reading.current = false;
      if (mounted.current) setTriageBusy(false);
    }
  }, [orgId, searchId]);

  // The first page is read when the drawer first opens, not before: most visits never open it.
  const wantTriage = open && triageCount > 0;
  useEffect(() => {
    if (wantTriage && triage === null && !triageFailed) void loadTriage();
  }, [loadTriage, triage, triageFailed, wantTriage]);

  const readRows = useMemo(() => read.slice(0, readShown), [read, readShown]);
  const triageRows = useMemo(() => triage?.rows ?? [], [triage]);

  // The candidates of the rows shown, read once each, in lots.
  const [people, setPeople] = useState<ReadonlyMap<string, ResultCandidate | null>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const wanted = useMemo(
    () =>
      open
        ? [...readRows.map((row) => row.candidateId), ...triageRows.map((row) => row.candidateId)]
        : [],
    [open, readRows, triageRows],
  );
  useEffect(() => {
    const missing = wanted.filter((id) => !asked.current.has(id));
    if (!missing.length) return;
    for (const id of missing) asked.current.add(id);
    void (async () => {
      try {
        const found = await readCandidatesById(await requireSupabase(), orgId, missing);
        if (!mounted.current) return;
        setPeople((current) => {
          const next = new Map(current);
          for (const [id, row] of found) next.set(id, row);
          return next;
        });
      } catch (error) {
        // Read again when the rows shown change: the ids are no longer marked as asked.
        console.error(error);
        for (const id of missing) asked.current.delete(id);
      }
    })();
  }, [orgId, wanted]);
  const candidateOf = useCallback((candidateId: string) => people.get(candidateId), [people]);

  function reasonText(reason: SetAsideReason | null, fallback: string): string {
    if (!reason) return fallback;
    if (reason.kind === "text") return reason.text;
    if (reason.kind === "unread") return t("briefs.setAside.unread");
    if (reason.kind === "gone") return t("briefs.setAside.gone");
    if (reason.kind === "thin") return t("briefs.triage.unknown");
    const { kind, label } = reason.criterion;
    return t("briefs.setAside.missing", {
      label: kind === "role" ? `${t(kindKey(kind))} · ${label}` : label,
    });
  }

  const shownRead: ShownRow[] = readRows.map((result) => ({
    candidateId: result.candidateId,
    line: reasonText(setAsideReason(criteria, result), t("briefs.decision.no_fit")),
  }));
  /** A row brought back leaves the list: the runner promotes it and reads it in full. */
  async function readAnyway(candidateId: string): Promise<void> {
    if (!(await onReadAnyway(candidateId)) || !mounted.current) return;
    setTriage((current) =>
      current
        ? {
            ...current,
            rows: current.rows.filter((row) => row.candidateId !== candidateId),
            total: Math.max(0, current.total - 1),
          }
        : current,
    );
  }

  const shownTriage: ShownRow[] = triageRows.map((row) => ({
    candidateId: row.candidateId,
    line: reasonText(
      setAsideReason(criteria, { triage: { verdict: row.verdict, reason: row.reason } }),
      t(row.verdict === "no" ? "briefs.triage.no" : "briefs.triage.unknown"),
    ),
    onReadAnyway: canReadAnyway ? () => readAnyway(row.candidateId) : undefined,
  }));

  const hasRead = read.length > 0;
  const hasTriage = triageCount > 0 || triageRows.length > 0;
  // Each group's count only when there are two: one group alone would repeat the title's.
  const both = hasRead && hasTriage;
  const close = () => onOpenChange(false);
  const count = (value: number) => formatCount(locale, value);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="lg"
        className="flex flex-col gap-6 overflow-hidden"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SheetTitle>
              {t("briefs.setAside.title")}
              <span className="ml-2 font-sans text-base font-normal text-muted-foreground tabular-nums">
                {count(total)}
              </span>
            </SheetTitle>
            {/* What was set aside is the model's reading: a person can open any of them, and decides. */}
            <Pill size="sm">{t("briefs.results.why")}</Pill>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-8 pb-2">
          {!hasRead && !hasTriage ? (
            <EmptyState compact inset icon={<Archive />} title={t("briefs.setAside.empty")} />
          ) : null}

          {hasRead ? (
            <Group
              id={readId}
              title={t("briefs.setAside.group.read")}
              count={both ? count(read.length) : null}
            >
              <AsideRows rows={shownRead} candidateOf={candidateOf} onOpen={close} />
              {readShown < read.length ? (
                <MoreButton onClick={() => setReadShown((value) => value + SET_ASIDE_PAGE)} />
              ) : null}
            </Group>
          ) : null}

          {hasTriage ? (
            <Group
              id={triageId}
              title={t("briefs.setAside.group.triage")}
              count={both ? count(triageCount) : null}
            >
              {triage === null && !triageFailed ? (
                <>
                  <p className="sr-only">{t("common.loading")}</p>
                  <SkeletonRows rows={3} avatarSize="md" className="-mx-2 [&>li]:px-2" />
                </>
              ) : (
                <AsideRows rows={shownTriage} candidateOf={candidateOf} onOpen={close} />
              )}
              {triageFailed ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0">{t("briefs.listError")}</span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<RefreshCw />}
                    onClick={() => void loadTriage()}
                    disabled={triageBusy}
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              ) : triage !== null && !triage.ended && triage.rows.length < triage.total ? (
                <MoreButton busy={triageBusy} onClick={() => void loadTriage()} />
              ) : null}
            </Group>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** A group of the drawer: a small heading (with its count when the drawer holds two), then its rows. */
function Group({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: string | null;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-2">
      <h3 id={id} className="label-caps">
        {title}
        {count !== null ? (
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">{count}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}
