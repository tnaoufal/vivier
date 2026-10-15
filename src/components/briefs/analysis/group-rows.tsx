/**
 * The rows of the brief page's list pane, one `ol` for the group on
 * screen. The matches and the near profiles are ranked: the position
 * held today, the years and the place as the line, the tier (or "À
 * confirmer" while the second reading has not seen a match; nothing
 * for a near profile) and, for a member, the way to the shortlist (a
 * check once the profile is there). The shortlist's rows say the
 * position, the years, the score and who decided; the tier and the
 * decision as a pill; for a member the decision in one click (retain
 * or dismiss a profile to examine, examine a decided one again) and
 * the item's thread. The profiles set aside say the triage's verdict
 * and its reason (or why the reading set them aside), with "Lire quand
 * même" for a member; a near profile the screening scored but nobody
 * read offers the same. The selected row carries aria-current;
 * ArrowUp and ArrowDown move the selection when the list has focus and
 * bring the row into view; the rows rise in once when the list first
 * lands.
 */
import { Fragment, useId, useMemo } from "react";
import { Check, FileSearch, ListPlus, MessageSquare, RotateCcw, X } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import { useListKeys } from "@/components/app-shell/row";
import { Button } from "@/components/ui/button";
import { kindKey } from "@/lib/briefs/criteria";
import { setAsideReason, type SetAsideReason } from "@/lib/briefs/presentation";
import { currentPosition, headerLine, yearsLabel } from "@/lib/candidates/format";
import type {
  BriefCriterion,
  MatchResult,
  ShortlistItemStatus,
  TriageVerdict,
} from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { decisionLineOf } from "@/lib/shortlists/decision-line";
import { subjectIds, type BriefGroup, type ReadingSubject } from "@/lib/shortlists/groups";
import type { BoardItem } from "@/lib/shortlists/queries";
import { assessedScore, tierOf } from "@/lib/shortlists/requirements";
import { useMemberNamer } from "@/lib/shortlists/use-members";

import { TierPill } from "../tier-pill";

import { ProfileRow } from "./profile-row";
import type { RowCandidate } from "./use-analysis";

/** The icon and the word of each decision a row offers. */
export const DECISION_ICONS: Record<ShortlistItemStatus, typeof Check> = {
  retained: Check,
  dismissed: X,
  to_review: RotateCcw,
};

export const DECISION_KEYS: Record<ShortlistItemStatus, TranslationKey> = {
  retained: "shortlists.action.retain",
  dismissed: "shortlists.action.dismiss",
  to_review: "shortlists.action.review",
};

/** The pill of a shortlist item's status: retained the ink filled with a check, dismissed a grey outline with a cross, to examine an ink outline. */
export const STATUS_PILL: Record<
  ShortlistItemStatus,
  { tone: PillTone; icon: typeof Check | null; key: TranslationKey }
> = {
  retained: { tone: "positive", icon: Check, key: "shortlists.pill.retained" },
  dismissed: { tone: "negative", icon: X, key: "shortlists.pill.dismissed" },
  to_review: { tone: "caution", icon: null, key: "shortlists.pill.to_review" },
};

export const TRIAGE_KEYS: Record<TriageVerdict, TranslationKey> = {
  yes: "briefs.triage.yes",
  close: "briefs.triage.close",
  unknown: "briefs.triage.unknown",
  no: "briefs.triage.no",
};

/** The decisions a row offers from a status: both on a profile to examine, "examine again" on a decided one. */
export function rowDecisions(status: ShortlistItemStatus): readonly ShortlistItemStatus[] {
  return status === "to_review" ? ["retained", "dismissed"] : ["to_review"];
}

/** The name of a thread button: "Discussion · 3 messages", "Discussion" when empty. */
export function useThreadLabel(): (count: number) => string {
  const { t } = useI18n();
  return (count) =>
    count
      ? `${t("thread.title")} · ${t(count === 1 ? "thread.count.one" : "thread.count.many", { count })}`
      : t("thread.title");
}

export function GroupRows({
  group,
  subjects,
  candidateOf,
  selectedId,
  onSelect,
  label,
  canEdit,
  provisional,
  addedIds,
  pendingIds,
  onAdd,
  canReadAnyway,
  onReadAnyway,
  onDecide,
  busyItemId,
  threadCounts,
  onOpenThread,
  criteria,
}: {
  group: BriefGroup;
  subjects: readonly ReadingSubject[];
  candidateOf: (candidateId: string) => RowCandidate;
  selectedId: string | null;
  onSelect: (candidateId: string) => void;
  /** The list's name for assistive technologies: the group's. */
  label: string;
  canEdit: boolean;
  /** The analysis is not through (running, or stopped): a match the second reading has not seen is marked. */
  provisional: boolean;
  addedIds: ReadonlySet<string>;
  /** The profiles added from a row since the last read. */
  pendingIds: ReadonlySet<string>;
  onAdd: (result: MatchResult) => Promise<unknown>;
  canReadAnyway: boolean;
  onReadAnyway: (candidateId: string) => Promise<unknown>;
  onDecide: (item: BoardItem, status: ShortlistItemStatus) => Promise<unknown>;
  busyItemId: string | null;
  threadCounts: ReadonlyMap<string, number>;
  onOpenThread: (item: BoardItem) => void;
  /** The criteria of the analysis, which a missing must-have is named from. */
  criteria: readonly BriefCriterion[];
}) {
  const { t, locale } = useI18n();
  const nameOf = useMemberNamer();
  const threadLabel = useThreadLabel();
  const ids = useMemo(() => subjectIds(subjects), [subjects]);
  const index = selectedId ? ids.indexOf(selectedId) : -1;
  const listId = useId();
  const rowId = (candidateId: string) => `${listId}-row-${candidateId}`;
  const onKeyDown = useListKeys(ids.length, index, (next) => {
    const id = ids[next];
    if (!id) return;
    onSelect(id);
    // The row is already in the list: it comes into view at once, with the selection.
    document.getElementById(rowId(id))?.scrollIntoView({ block: "nearest" });
  });
  const ranked = group === "matches" || group === "near";

  function reasonText(reason: SetAsideReason | null, fallback: string): string {
    if (!reason) return fallback;
    if (reason.kind === "text") return reason.text;
    if (reason.kind === "unread") return t("briefs.setAside.unread");
    if (reason.kind === "gone") return t("briefs.setAside.gone");
    if (reason.kind === "thin") return t("briefs.triage.unknown");
    const { kind, label: name } = reason.criterion;
    return t("briefs.setAside.missing", {
      label: kind === "role" ? `${t(kindKey(kind))} · ${name}` : name,
    });
  }

  /** The one line of a profile: the position held today, the years, the place; "" when the CV states none. */
  const personLine = (candidate: RowCandidate): string =>
    candidate ? headerLine(locale, candidate) : "";

  const readAnywayButton = (candidateId: string) =>
    canReadAnyway ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={<FileSearch />}
        onClick={() => void onReadAnyway(candidateId)}
        className="text-muted-foreground hover:text-ink"
      >
        {t("briefs.setAside.readAnyway")}
      </Button>
    ) : undefined;

  return (
    <ol
      tabIndex={0}
      aria-label={label}
      onKeyDown={onKeyDown}
      className="stagger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {subjects.map((subject, position) => {
        const candidate = candidateOf(subject.candidateId);
        const selected = subject.candidateId === selectedId;
        const select = () => onSelect(subject.candidateId);
        const rank = ranked ? position + 1 : undefined;

        if (subject.kind === "result") {
          const { result } = subject;
          const line =
            group === "aside"
              ? reasonText(setAsideReason(criteria, result), t("briefs.decision.no_fit"))
              : personLine(candidate);
          const tier = group === "matches" ? tierOf(result) : null;
          const unconfirmed =
            group === "matches" &&
            provisional &&
            result.assessment?.decision === "fit" &&
            !result.assessment.challenge;
          const added = addedIds.has(result.candidateId) || pendingIds.has(result.candidateId);
          const addLabel = added
            ? t("briefs.match.addedLabel")
            : t("briefs.results.addToShortlist");
          return (
            <Fragment key={subject.candidateId}>
              <ProfileRow
                id={rowId(subject.candidateId)}
                candidate={candidate}
                line={line}
                rank={rank}
                selected={selected}
                onSelect={select}
                className="rise-in"
                mark={
                  unconfirmed ? (
                    <span className="text-meta text-muted-foreground">
                      {t("briefs.match.unconfirmed")}
                    </span>
                  ) : tier ? (
                    <TierPill tier={tier} compact />
                  ) : undefined
                }
                trailing={
                  group !== "aside" && canEdit && candidate ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={addLabel}
                      title={addLabel}
                      aria-disabled={added}
                      onClick={() => {
                        if (!added) void onAdd(result);
                      }}
                      className={added ? "cursor-default hover:bg-transparent" : undefined}
                    >
                      {added ? <Check aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
                    </Button>
                  ) : undefined
                }
              />
            </Fragment>
          );
        }

        if (subject.kind === "screened") {
          return (
            <Fragment key={subject.candidateId}>
              <ProfileRow
                id={rowId(subject.candidateId)}
                candidate={candidate}
                line={personLine(candidate)}
                rank={rank}
                selected={selected}
                onSelect={select}
                className="rise-in"
                trailing={candidate ? readAnywayButton(subject.candidateId) : undefined}
              />
            </Fragment>
          );
        }

        if (subject.kind === "triage") {
          const reason = reasonText(
            setAsideReason(criteria, {
              triage: { verdict: subject.verdict, reason: subject.reason },
            }),
            "",
          );
          const verdict = t(TRIAGE_KEYS[subject.verdict]);
          return (
            <Fragment key={subject.candidateId}>
              <ProfileRow
                id={rowId(subject.candidateId)}
                candidate={candidate}
                line={reason && reason !== verdict ? `${verdict} · ${reason}` : verdict}
                selected={selected}
                onSelect={select}
                className="rise-in"
                trailing={candidate ? readAnywayButton(subject.candidateId) : undefined}
              />
            </Fragment>
          );
        }

        const { item } = subject;
        const person = item.candidates;
        const score = assessedScore(item.match);
        const decision = decisionLineOf(item);
        const facts = [
          person ? currentPosition(person)?.title : null,
          person ? yearsLabel(locale, person.years_experience) : null,
          score === null ? null : t("shortlists.item.score", { score }),
        ].filter((part): part is string => typeof part === "string" && part.length > 0);
        // "à examiner" ends a line; alone it starts one, capitalised.
        const words =
          decision.kind === "toReview"
            ? t(facts.length ? "shortlists.line.to_review" : "shortlists.pill.to_review")
            : t(`shortlists.line.${decision.kind}`, { name: nameOf(decision.by) });
        const line = [...facts, words].join(" · ");
        const tier = tierOf(item.match);
        const pill = STATUS_PILL[item.status];
        const PillIcon = pill.icon;
        const count = threadCounts.get(item.id) ?? 0;
        const threadName = threadLabel(count);
        const busy = busyItemId === item.id;
        return (
          <Fragment key={subject.candidateId}>
            <ProfileRow
              id={rowId(subject.candidateId)}
              candidate={candidate}
              line={line}
              selected={selected}
              onSelect={select}
              muted={item.status === "dismissed"}
              className="rise-in"
              mark={
                <>
                  {tier ? <TierPill tier={tier} compact /> : null}
                  <Pill
                    tone={pill.tone}
                    size="sm"
                    dot={false}
                    icon={PillIcon ? <PillIcon /> : undefined}
                  >
                    {t(pill.key)}
                  </Pill>
                </>
              }
              trailing={
                <>
                  {canEdit
                    ? rowDecisions(item.status).map((next) => {
                        const Icon = DECISION_ICONS[next];
                        const word = t(DECISION_KEYS[next]);
                        return (
                          <Fragment key={next}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={word}
                              title={word}
                              disabled={busy}
                              aria-busy={busy || undefined}
                              onClick={() => void onDecide(item, next)}
                              className="text-muted-foreground hover:text-ink"
                            >
                              <Icon aria-hidden="true" />
                            </Button>
                          </Fragment>
                        );
                      })
                    : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size={count ? "sm" : "icon-sm"}
                    icon={<MessageSquare />}
                    aria-label={threadName}
                    title={threadName}
                    onClick={() => onOpenThread(item)}
                    className="text-muted-foreground hover:text-ink"
                  >
                    {count ? <span className="tabular-nums">{count}</span> : null}
                  </Button>
                </>
              }
            />
          </Fragment>
        );
      })}
    </ol>
  );
}
