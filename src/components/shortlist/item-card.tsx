/**
 * One candidate on a shortlist board, a sheet of its own: the photo or
 * initials, the name (it opens the drawer) and the title, the fit ring
 * (the model's score, a dash when no model assessed the profile), the
 * tier the comparative pass proposed and the analysis's decision as
 * pills, the one required requirement the CV does not meet named in
 * red, who decided and when, then the votes, the comment count and the
 * person assigned. Every action lives in an overflow menu: retain,
 * dismiss, review again, assign, open the sheet or the full profile,
 * remove (confirmed). The caller wraps the card in its list item.
 */
import { useState } from "react";
import {
  Check,
  Ellipsis,
  ExternalLink,
  FileSearch,
  MessageSquare,
  RotateCcw,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { DecisionPill } from "@/components/briefs/decision-pill";
import { TierPill } from "@/components/briefs/tier-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/auth-context";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { BriefCriterion, ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import type { BoardItem } from "@/lib/shortlists/queries";
import { assessedScore, missingRequired, tierOf } from "@/lib/shortlists/requirements";
import { type VoteTally } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";
import { useMemberNamer, useTeamMembers } from "@/lib/shortlists/use-members";

import { DecisionTrace, ScoreLine, VoteButtons } from "./item-bits";
import type { DrawerTab } from "./item-drawer";

/** Where a card can go from each status; the current one is never offered. */
const NEXT_STATUSES: Record<ShortlistItemStatus, ShortlistItemStatus[]> = {
  to_review: ["retained", "dismissed"],
  retained: ["dismissed", "to_review"],
  dismissed: ["retained", "to_review"],
};

const NEXT_ICONS: Record<ShortlistItemStatus, typeof Check> = {
  retained: Check,
  dismissed: X,
  to_review: RotateCcw,
};

const NEXT_KEYS = {
  retained: "shortlists.action.retain",
  dismissed: "shortlists.action.dismiss",
  to_review: "shortlists.action.review",
} as const;

const NO_ASSIGNEE = "__none__";

export function ItemCard({
  item,
  orgId,
  criteria,
  tally,
  commentCount,
  canAct,
  onChanged,
  onOpen,
}: {
  item: BoardItem;
  orgId: string;
  criteria: readonly BriefCriterion[];
  tally: VoteTally;
  commentCount: number;
  canAct: boolean;
  onChanged: () => void;
  /** Opens the drawer, on the given tab (the decision by default). */
  onOpen: (tab?: DrawerTab) => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { showPhotos } = useOrg();
  const members = useTeamMembers();
  const nameOf = useMemberNamer();
  const actions = useItemActions({ orgId, itemId: item.id, userId: user?.id ?? null, onChanged });
  const [removing, setRemoving] = useState(false);

  const candidate = item.candidates;
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos);
  const name = candidate
    ? candidate.full_name?.trim() || t("shortlists.item.noName")
    : t("shortlists.item.candidateGone");
  const headline = candidate?.headline?.trim() ?? "";
  const assignedKnown =
    item.assigned_to === null || members.some((member) => member.id === item.assigned_to);
  const commentLabel =
    commentCount === 1
      ? t("shortlists.comments.count.one")
      : t("shortlists.comments.count.many", { count: commentCount });
  const assessment = item.match?.assessment ?? null;
  const score = assessedScore(item.match);
  const scoreLabel =
    score === null ? t("shortlists.item.noAssessment") : t("shortlists.item.fitScore", { score });
  const tier = tierOf(item.match);
  const missing = missingRequired(criteria, item.match, t("shortlists.drawer.criterion.unknown"));
  const missingLabel =
    missing.length > 1 ? `${missing[0] ?? ""} +${missing.length - 1}` : (missing[0] ?? "");

  async function confirmRemove() {
    if (await actions.remove()) setRemoving(false);
  }

  return (
    <article className="sheet p-6">
      <div className="flex items-start gap-3">
        <Avatar name={name} size="md" photoUrl={photoUrl} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen()}
            className="block max-w-full cursor-pointer truncate rounded-sm text-left text-base font-semibold text-ink transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </button>
          <p className="truncate text-sm text-muted-foreground">
            {headline || t("common.unknown")}
          </p>
        </div>
        <ScoreRing score={score} label={scoreLabel} size="sm" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("shortlists.item.menu")}
              title={t("shortlists.item.menu")}
              className="-mr-2 -mt-1 text-muted-foreground"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {canAct ? (
              <>
                {NEXT_STATUSES[item.status].map((next) => {
                  const Icon = NEXT_ICONS[next];
                  return (
                    <DropdownMenuItem
                      key={next}
                      disabled={actions.busy}
                      onSelect={() => void actions.decide(next)}
                    >
                      <Icon />
                      {t(NEXT_KEYS[next])}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={actions.busy}>
                    <UserCheck />
                    {t("shortlists.assign.menu")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48">
                    <DropdownMenuRadioGroup
                      value={item.assigned_to ?? NO_ASSIGNEE}
                      onValueChange={(value) =>
                        void actions.assign(value === NO_ASSIGNEE ? null : value)
                      }
                    >
                      <DropdownMenuRadioItem value={NO_ASSIGNEE}>
                        {t("shortlists.assign.none")}
                      </DropdownMenuRadioItem>
                      {!assignedKnown && item.assigned_to ? (
                        <DropdownMenuRadioItem value={item.assigned_to}>
                          {t("shortlists.formerMember")}
                        </DropdownMenuRadioItem>
                      ) : null}
                      {members.map((member) => (
                        <DropdownMenuRadioItem key={member.id} value={member.id}>
                          {member.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => onOpen()}>
              <FileSearch />
              {t("shortlists.item.details")}
            </DropdownMenuItem>
            {candidate ? (
              <DropdownMenuItem asChild>
                <Link to="/app/candidates/$candidateId" params={{ candidateId: candidate.id }}>
                  <ExternalLink />
                  {t("shortlists.drawer.openCandidate")}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canAct ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  disabled={actions.busy}
                  onSelect={() => setRemoving(true)}
                >
                  <Trash2 />
                  {t("shortlists.action.remove")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {tier || assessment ? (
        <div className="mt-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {tier ? <TierPill tier={tier} /> : null}
            {assessment ? <DecisionPill decision={assessment.decision} /> : null}
          </div>
          {assessment?.rankNote ? (
            <p className="text-meta text-muted-foreground">
              {t("shortlists.item.rankNote", { note: assessment.rankNote })}
            </p>
          ) : null}
        </div>
      ) : (
        <ScoreLine match={item.match} className="mt-3 block" />
      )}

      {missing.length ? (
        <p className="mt-2 flex items-start gap-1.5 text-meta font-medium text-negative">
          <X className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {t("shortlists.item.missing", { label: missingLabel })}
          </span>
        </p>
      ) : null}

      {item.decided_at ? (
        <DecisionTrace
          status={item.status}
          decidedBy={item.decided_by}
          decidedAt={item.decided_at}
          className="mt-3"
        />
      ) : (
        <p
          className="mt-3 text-meta text-muted-foreground"
          title={formatDateTime(locale, item.created_at)}
        >
          {t("shortlists.item.addedBy", {
            name: nameOf(item.added_by),
            when: formatRelative(locale, item.created_at),
          })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <VoteButtons
          tally={tally}
          canVote={canAct}
          busy={actions.busy}
          onVote={(value) => void actions.vote(value, tally.mine)}
        />
        <button
          type="button"
          onClick={() => onOpen("team")}
          aria-label={commentLabel}
          title={commentLabel}
          className="press inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 text-meta font-medium text-muted-foreground tabular-nums hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <MessageSquare aria-hidden="true" />
          {commentCount}
        </button>
        {item.assigned_to ? (
          <span
            className="ml-auto flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground"
            title={t("shortlists.item.assignedTo", { name: nameOf(item.assigned_to) })}
          >
            <Avatar name={nameOf(item.assigned_to)} size="sm" />
            <span className="max-w-28 truncate">{nameOf(item.assigned_to)}</span>
          </span>
        ) : null}
      </div>

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
