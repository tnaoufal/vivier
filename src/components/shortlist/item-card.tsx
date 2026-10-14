/**
 * One candidate on a shortlist board, a sheet of its own: name and
 * headline next to the fit ring (the model's score, a dash when no
 * model assessed the profile) with the tier the comparative pass
 * proposed under it when there is one, the analysis's decision as a
 * pill when there is one (else the deterministic score as a muted
 * number), who it is assigned to, the votes, the comment count, and for
 * members the actions: retain, dismiss, review again, assign, remove
 * (confirmed). The decision trace under a decided card names who
 * decided and when, from the database. The caller wraps the card in its
 * list item.
 */
import { useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { Pill } from "@/components/app-shell/pill";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { DecisionPill } from "@/components/briefs/decision-pill";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import type { BoardItem } from "@/lib/shortlists/queries";
import { assessedScore, tierOf } from "@/lib/shortlists/requirements";
import { scorePercent, type VoteTally } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";
import { useMemberNamer, useTeamMembers } from "@/lib/shortlists/use-members";

import { DecisionTrace, TierPill, VoteButtons } from "./item-bits";

/** Where a card can go from each status; the current one is never offered. */
const NEXT_STATUSES: Record<ShortlistItemStatus, ShortlistItemStatus[]> = {
  to_review: ["retained", "dismissed"],
  retained: ["dismissed", "to_review"],
  dismissed: ["retained", "to_review"],
};

const NO_ASSIGNEE = "__none__";

export function ItemCard({
  item,
  orgId,
  tally,
  commentCount,
  canAct,
  onChanged,
  onOpen,
}: {
  item: BoardItem;
  orgId: string;
  tally: VoteTally;
  commentCount: number;
  canAct: boolean;
  onChanged: () => void;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const members = useTeamMembers();
  const nameOf = useMemberNamer();
  const actions = useItemActions({ orgId, itemId: item.id, userId: user?.id ?? null, onChanged });
  const [removing, setRemoving] = useState(false);

  const candidate = item.candidates;
  const name = candidate ? candidate.full_name?.trim() || t("shortlists.item.noName") : t("shortlists.item.candidateGone");
  const line = candidate ? [candidate.headline, candidate.location].filter((part) => part && part.trim()).join(" · ") : "";
  const assignedKnown = item.assigned_to === null || members.some((member) => member.id === item.assigned_to);
  const commentLabel =
    commentCount === 1 ? t("shortlists.comments.count.one") : t("shortlists.comments.count.many", { count: commentCount });
  const assessment = item.match?.assessment ?? null;
  const score = assessedScore(item.match);
  const scoreLabel = score === null ? t("shortlists.item.noAssessment") : t("shortlists.item.fitScore", { score });
  const textScore = scorePercent(item.match);
  const tier = tierOf(item.match);

  async function confirmRemove() {
    if (await actions.remove()) setRemoving(false);
  }

  return (
    <article className="sheet space-y-4 p-6">
      <div className="flex items-start gap-3">
        <Avatar name={name} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full cursor-pointer truncate text-left text-[15px] font-semibold leading-6 text-ink hover:underline"
          >
            {name}
          </button>
          {line ? <p className="truncate text-sm text-muted-foreground">{line}</p> : null}
        </div>
        {/* The tier sits under the ring, letter only: the full label is in the drawer, the name keeps its room. */}
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <ScoreRing score={score} label={scoreLabel} size="md" />
          {tier ? <TierPill tier={tier} note={assessment?.rankNote} compact /> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {assessment ? (
          <DecisionPill decision={assessment.decision} />
        ) : (
          <span className="text-[13px] leading-5 text-muted-foreground tabular-nums">
            {textScore === null ? t("shortlists.item.noScore") : t("shortlists.item.score", { score: textScore })}
          </span>
        )}
        {item.match?.blocked ? (
          <Pill tone="negative" dot>
            {t("shortlists.item.blocked")}
          </Pill>
        ) : null}
        {item.assigned_to ? (
          <span
            className="ml-auto flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-muted-foreground"
            title={t("shortlists.item.assignedTo", { name: nameOf(item.assigned_to) })}
          >
            <Avatar name={nameOf(item.assigned_to)} size="sm" />
            <span className="max-w-32 truncate">{nameOf(item.assigned_to)}</span>
          </span>
        ) : null}
      </div>

      {item.decided_at ? (
        <DecisionTrace status={item.status} decidedBy={item.decided_by} decidedAt={item.decided_at} />
      ) : (
        <p className="text-[13px] leading-5 text-muted-foreground" title={formatDateTime(locale, item.created_at)}>
          {t("shortlists.item.addedBy", { name: nameOf(item.added_by), when: formatRelative(locale, item.created_at) })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <VoteButtons tally={tally} canVote={canAct} busy={actions.busy} onVote={(value) => void actions.vote(value, tally.mine)} />
        <button
          type="button"
          onClick={onOpen}
          aria-label={commentLabel}
          title={commentLabel}
          className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] font-medium text-muted-foreground tabular-nums transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <MessageSquare aria-hidden="true" />
          {commentCount}
        </button>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen} className="ml-auto">
          {t("shortlists.item.details")}
        </Button>
      </div>

      {canAct ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {NEXT_STATUSES[item.status].map((next) => (
            <Button
              key={next}
              type="button"
              size="sm"
              variant="outline"
              disabled={actions.busy}
              onClick={() => void actions.decide(next)}
              className={next === "retained" ? "text-positive hover:text-positive" : next === "dismissed" ? "text-negative hover:text-negative" : ""}
            >
              {next === "retained" ? <Check /> : next === "dismissed" ? <X /> : <RotateCcw />}
              {next === "retained"
                ? t("shortlists.action.retain")
                : next === "dismissed"
                  ? t("shortlists.action.dismiss")
                  : t("shortlists.action.review")}
            </Button>
          ))}
          <Select
            value={item.assigned_to ?? NO_ASSIGNEE}
            onValueChange={(value) => void actions.assign(value === NO_ASSIGNEE ? null : value)}
            disabled={actions.busy}
          >
            <SelectTrigger className="w-auto min-w-32 max-w-full text-[13px]" aria-label={t("shortlists.assign.label")}>
              <SelectValue placeholder={t("shortlists.assign.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ASSIGNEE}>{t("shortlists.assign.none")}</SelectItem>
              {!assignedKnown && item.assigned_to ? (
                <SelectItem value={item.assigned_to}>{t("shortlists.formerMember")}</SelectItem>
              ) : null}
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setRemoving(true)}
            disabled={actions.busy}
            aria-label={t("shortlists.action.remove")}
            title={t("shortlists.action.remove")}
            className="ml-auto text-muted-foreground hover:text-negative"
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => {
          if (!actions.busy) setRemoving(open);
        }}
        title={t("shortlists.remove.title", { name })}
        text={t("shortlists.remove.text")}
        confirmLabel={t("common.remove")}
        destructive
        busy={actions.busy}
        onConfirm={confirmRemove}
      />
    </article>
  );
}
