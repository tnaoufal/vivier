/**
 * One candidate on a shortlist board: name and headline, the score and
 * the verdict counts of the match (or "no score"), the assignee, the
 * votes, the comment count, and for members the actions: retain,
 * dismiss, review again, assign, remove (confirmed). The decision trace
 * under a decided card names who decided and when, from the database.
 */
import { useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import type { BoardItem } from "@/lib/shortlists/queries";
import type { VoteTally } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";
import { useMemberNamer, useTeamMembers } from "@/lib/shortlists/use-members";

import { DecisionTrace, ScoreLine, VerdictCounts, VoteButtons } from "./item-bits";

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

  async function confirmRemove() {
    if (await actions.remove()) setRemoving(false);
  }

  return (
    <li className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block max-w-full truncate text-left font-medium text-ink hover:underline">
            {name}
          </button>
          {line ? <p className="truncate text-xs text-muted-foreground">{line}</p> : null}
        </div>
        {item.assigned_to ? (
          <Avatar name={nameOf(item.assigned_to)} size="sm" className="mt-0.5" />
        ) : null}
      </div>

      <div className="mt-2 space-y-1">
        <ScoreLine match={item.match} />
        <VerdictCounts match={item.match} />
      </div>

      {item.decided_at ? (
        <DecisionTrace status={item.status} decidedBy={item.decided_by} decidedAt={item.decided_at} className="mt-2" />
      ) : (
        <p className="mt-2 text-xs text-muted-foreground" title={formatDateTime(locale, item.created_at)}>
          {t("shortlists.item.addedBy", { name: nameOf(item.added_by), when: formatRelative(locale, item.created_at) })}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <VoteButtons tally={tally} canVote={canAct} busy={actions.busy} onVote={(value) => void actions.vote(value, tally.mine)} />
        <button
          type="button"
          onClick={onOpen}
          aria-label={commentLabel}
          title={commentLabel}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:size-3.5"
        >
          <MessageSquare />
          {commentCount}
        </button>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen} className="ml-auto">
          {t("shortlists.item.details")}
        </Button>
      </div>

      {canAct ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
          {NEXT_STATUSES[item.status].map((next) => (
            <Button
              key={next}
              type="button"
              size="sm"
              variant={next === "retained" ? "default" : "outline"}
              disabled={actions.busy}
              onClick={() => void actions.decide(next)}
              className="gap-1"
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
            <SelectTrigger className="h-8 w-auto min-w-28 max-w-full text-xs" aria-label={t("shortlists.assign.label")}>
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
            size="icon"
            onClick={() => setRemoving(true)}
            disabled={actions.busy}
            aria-label={t("shortlists.action.remove")}
            title={t("shortlists.action.remove")}
            className="ml-auto size-8 text-muted-foreground hover:text-negative"
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
    </li>
  );
}
