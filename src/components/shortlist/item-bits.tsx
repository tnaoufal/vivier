/**
 * Small pieces shared by the card and the drawer of a shortlist item:
 * the score line, the four verdict counts, the vote buttons, the
 * decision trace ("Retained by Ana · 2 h ago") and a comment body with
 * its mentions highlighted. Each shows only what was read: no score
 * means "no score", an unknown decider is named as such.
 */
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { CriterionVerdict, MatchResult, ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { renderMentions, type MentionMember } from "@/lib/shortlists/mentions";
import {
  VERDICTS,
  coveragePercent,
  scorePercent,
  verdictCounts,
  type VoteTally,
  type VoteValue,
} from "@/lib/shortlists/tally";
import { useMemberNamer } from "@/lib/shortlists/use-members";
import { cn } from "@/lib/utils";

export const VERDICT_PILL_TONES: Record<CriterionVerdict, PillTone> = {
  match: "positive",
  partial: "caution",
  missing: "negative",
  not_stated: "neutral",
};

const VERDICT_TEXT: Record<CriterionVerdict, string> = {
  match: "text-positive",
  partial: "text-caution-foreground dark:text-caution",
  missing: "text-negative",
  not_stated: "text-muted-foreground",
};

export function ScoreLine({ match, className }: { match: MatchResult | null; className?: string }) {
  const { t } = useI18n();
  const score = scorePercent(match);
  const coverage = coveragePercent(match);
  if (score === null) {
    return <span className={cn("text-xs text-muted-foreground", className)}>{t("shortlists.item.noScore")}</span>;
  }
  return (
    <span className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="font-medium text-ink">{t("shortlists.item.score", { score })}</span>
      {coverage !== null ? <span>· {t("shortlists.item.coverage", { coverage })}</span> : null}
      {match?.blocked ? <Pill tone="negative">{t("shortlists.item.blocked")}</Pill> : null}
    </span>
  );
}

/** The verdicts of a match compacted to four numbers; nothing when the item has no match. */
export function VerdictCounts({ match, className }: { match: MatchResult | null; className?: string }) {
  const { t } = useI18n();
  const counts = verdictCounts(match);
  if (!counts) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs", className)} aria-label={t("shortlists.drawer.match")}>
      {VERDICTS.map((verdict) => (
        <li
          key={verdict}
          className={cn("flex items-center gap-1 font-medium tabular-nums", VERDICT_TEXT[verdict])}
          title={t(`shortlists.verdict.${verdict}`)}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {counts[verdict]}
          <span className="sr-only">{t(`shortlists.verdict.${verdict}`)}</span>
        </li>
      ))}
    </ul>
  );
}

function VoteButton({
  value,
  count,
  active,
  label,
  disabled,
  onClick,
}: {
  value: VoteValue;
  count: number;
  active: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const activeClass = value === 1 ? "bg-positive/12 text-positive" : "bg-negative/12 text-negative";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={active ? `${label} · ${t("shortlists.vote.mine")}` : label}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums transition-colors disabled:cursor-default [&_svg]:size-3.5",
        active ? activeClass : "bg-muted text-muted-foreground",
        disabled ? "" : "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {value === 1 ? <ThumbsUp /> : <ThumbsDown />}
      {count}
    </button>
  );
}

/** Up and down with their counts; the caller's own vote is highlighted. Viewers see the counts only. */
export function VoteButtons({
  tally,
  canVote,
  busy,
  onVote,
  className,
}: {
  tally: VoteTally;
  canVote: boolean;
  busy: boolean;
  onVote: (value: VoteValue) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const disabled = !canVote || busy;
  return (
    <div className={cn("flex items-center gap-1", className)} title={t("shortlists.vote.tally", { up: tally.up, down: tally.down })}>
      <VoteButton value={1} count={tally.up} active={tally.mine === 1} label={t("shortlists.vote.up")} disabled={disabled} onClick={() => onVote(1)} />
      <VoteButton value={-1} count={tally.down} active={tally.mine === -1} label={t("shortlists.vote.down")} disabled={disabled} onClick={() => onVote(-1)} />
    </div>
  );
}

/** "Retained by Ana · 2 h ago", from decided_by / decided_at; nothing before any decision. */
export function DecisionTrace({
  status,
  decidedBy,
  decidedAt,
  className,
}: {
  status: ShortlistItemStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const nameOf = useMemberNamer();
  if (!decidedAt) return null;
  const key =
    status === "retained"
      ? "shortlists.trace.retained"
      : status === "dismissed"
        ? "shortlists.trace.dismissed"
        : "shortlists.trace.reviewed";
  return (
    <p className={cn("text-xs text-muted-foreground", className)} title={formatDateTime(locale, decidedAt)}>
      {t(key, { name: nameOf(decidedBy), when: formatRelative(locale, decidedAt) })}
    </p>
  );
}

/** A comment body with each "@Name" of a member set apart. */
export function MentionText({ body, members, className }: { body: string; members: readonly MentionMember[]; className?: string }) {
  const segments = renderMentions(body, members);
  return (
    <p className={cn("whitespace-pre-line break-words text-sm text-ink", className)}>
      {segments.map((segment, index) =>
        segment.kind === "mention" ? (
          <span key={index} className="rounded bg-primary/12 px-1 font-medium text-primary">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
