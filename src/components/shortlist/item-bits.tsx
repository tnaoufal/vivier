/**
 * Small pieces shared by the card and the drawer of a shortlist item:
 * the item's status as a pill, the vote buttons, the decision trace
 * ("Retained by Ana · 2 h ago"), the deterministic score line and a
 * comment body with its mentions set apart. The tier is drawn by the
 * brief's own pill (`@/components/briefs/tier-pill`) so a proposal keeps
 * one shape from the analysis to the board. Each piece shows only what
 * was read: no score means "no score", an unknown decider is named as
 * such.
 */
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { MatchResult, ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { renderMentions, type MentionMember } from "@/lib/shortlists/mentions";
import {
  coveragePercent,
  scorePercent,
  type VoteTally,
  type VoteValue,
} from "@/lib/shortlists/tally";
import { useMemberNamer } from "@/lib/shortlists/use-members";
import { cn } from "@/lib/utils";

export const STATUS_TONES: Record<ShortlistItemStatus, PillTone> = {
  to_review: "primary",
  retained: "positive",
  dismissed: "negative",
};

/** The item's status (to review, retained, dismissed) as a small pill with a dot. */
export function StatusPill({
  status,
  size = "md",
}: {
  status: ShortlistItemStatus;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  return (
    <Pill tone={STATUS_TONES[status]} dot size={size}>
      {t(`shortlists.item.status.${status}`)}
    </Pill>
  );
}

/** The deterministic score and coverage, muted: a second reading next to the model's ring. */
export function ScoreLine({ match, className }: { match: MatchResult | null; className?: string }) {
  const { t } = useI18n();
  const score = scorePercent(match);
  const coverage = coveragePercent(match);
  if (score === null) {
    return (
      <span className={cn("text-meta text-muted-foreground", className)}>
        {t("shortlists.item.noScore")}
      </span>
    );
  }
  return (
    <span className={cn("text-meta text-muted-foreground tabular-nums", className)}>
      {t("shortlists.item.score", { score })}
      {coverage !== null ? ` · ${t("shortlists.item.coverage", { coverage })}` : ""}
    </span>
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
        "press inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-meta font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default [&_svg]:size-4",
        active ? activeClass : "bg-muted text-muted-foreground",
        disabled ? "" : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {value === 1 ? <ThumbsUp aria-hidden="true" /> : <ThumbsDown aria-hidden="true" />}
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
    <div
      className={cn("flex items-center gap-1.5", className)}
      title={t("shortlists.vote.tally", { up: tally.up, down: tally.down })}
    >
      <VoteButton
        value={1}
        count={tally.up}
        active={tally.mine === 1}
        label={t("shortlists.vote.up")}
        disabled={disabled}
        onClick={() => onVote(1)}
      />
      <VoteButton
        value={-1}
        count={tally.down}
        active={tally.mine === -1}
        label={t("shortlists.vote.down")}
        disabled={disabled}
        onClick={() => onVote(-1)}
      />
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
    <p
      className={cn("text-meta text-muted-foreground", className)}
      title={formatDateTime(locale, decidedAt)}
    >
      {t(key, { name: nameOf(decidedBy), when: formatRelative(locale, decidedAt) })}
    </p>
  );
}

/** A comment body with each "@Name" of a member set apart. */
export function MentionText({
  body,
  members,
  className,
}: {
  body: string;
  members: readonly MentionMember[];
  className?: string;
}) {
  const segments = renderMentions(body, members);
  return (
    <p className={cn("whitespace-pre-line break-words text-body text-ink", className)}>
      {segments.map((segment, index) =>
        segment.kind === "mention" ? (
          <span key={index} className="rounded-sm bg-primary/12 px-1 font-medium text-primary">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
