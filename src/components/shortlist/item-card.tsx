/**
 * One candidate on the board, a sheet of its own: the photo (greyscale)
 * or the initials, the name (it opens the drawer) with the tier letter
 * beside it, the position held today and the years, then the one line
 * the model wrote for this rank (else its main reservation), and a
 * footer with the thread's count (it opens the drawer on the thread)
 * and, for a member, the two decisions that apply as quiet icon buttons
 * (their words from `sm`), the person assigned, and a menu for the rest
 * (assign, open the profile, remove behind a confirmation). No score
 * ring, no votes: the figure lives in the drawer and the team talks in
 * the thread. The caller wraps the card in its list item.
 */
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Ellipsis, MessageSquare, RotateCcw, Trash2, UserRound, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
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
import { yearsLabel } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import type { BoardItem } from "@/lib/shortlists/queries";
import { cardLine, tierOf } from "@/lib/shortlists/requirements";
import { decisionsFrom } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";
import { useMemberNamer, type TeamMember } from "@/lib/shortlists/use-members";

import type { DrawerTab } from "./item-drawer";

/** The icon and the word of each decision, shared with the drawer. */
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

const NO_ASSIGNEE = "__none__";

/** The name of a thread button: "Discussion · 3 messages", "Discussion" when empty. */
export function useThreadLabel(): (count: number) => string {
  const { t } = useI18n();
  return (count) =>
    count
      ? `${t("thread.title")} · ${t(count === 1 ? "thread.count.one" : "thread.count.many", { count })}`
      : t("thread.title");
}

export function ItemCard({
  item,
  orgId,
  threadCount,
  canEdit,
  members,
  onChanged,
  onOpen,
}: {
  item: BoardItem;
  orgId: string;
  threadCount: number;
  canEdit: boolean;
  members: readonly TeamMember[];
  onChanged: () => void;
  /** Opens the drawer on the given tab. */
  onOpen: (tab: DrawerTab) => void;
}) {
  const { t, locale } = useI18n();
  const { showPhotos } = useOrg();
  const nameOf = useMemberNamer();
  const threadLabel = useThreadLabel();
  const actions = useItemActions({ orgId, itemId: item.id, onChanged });
  const [removing, setRemoving] = useState(false);

  const candidate = item.candidates;
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos);
  const name = candidate
    ? candidate.full_name?.trim() || t("shortlists.item.noName")
    : t("shortlists.item.candidateGone");
  const headline = candidate?.headline?.trim() ?? "";
  const years = yearsLabel(locale, candidate?.years_experience);
  // The position and the years on one line: what tells cards apart, nothing the CV did not say.
  const meta = [headline, years].filter(Boolean).join(" · ");
  const tier = tierOf(item.match);
  const line = cardLine(item.match);
  const assignedKnown =
    item.assigned_to === null || members.some((member) => member.id === item.assigned_to);
  const label = threadLabel(threadCount);
  // "Assigné à {name}" is the mark's accessible name, not only its hover.
  const assignedTo = item.assigned_to
    ? t("shortlists.item.assignedTo", { name: nameOf(item.assigned_to) })
    : null;

  async function confirmRemove() {
    if (await actions.remove()) setRemoving(false);
  }

  return (
    <article className="sheet p-4">
      <div className="flex items-start gap-3">
        <Avatar name={name} size="sm" photoUrl={photoUrl} className="mt-0.5" decorative />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpen("reading")}
              className="block min-w-0 max-w-full cursor-pointer truncate rounded-sm text-left text-base font-semibold leading-6 text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {name}
            </button>
            {tier ? (
              <span className="mt-0.5 shrink-0">
                <TierPill tier={tier} compact />
              </span>
            ) : null}
          </div>
          {meta ? <p className="truncate text-sm text-muted-foreground">{meta}</p> : null}
        </div>
      </div>

      {line ? <p className="mt-3 line-clamp-2 text-sm text-ink break-words">{line}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3">
        <Button
          type="button"
          variant="ghost"
          size={threadCount ? "default" : "icon"}
          icon={<MessageSquare />}
          onClick={() => onOpen("thread")}
          aria-label={label}
          title={label}
          className="text-muted-foreground hover:text-ink"
        >
          {threadCount ? <span className="tabular-nums">{threadCount}</span> : null}
        </Button>

        {/* The decision is the board's most frequent action: one click, on the card. */}
        {canEdit
          ? decisionsFrom(item.status).map((next) => {
              const Icon = DECISION_ICONS[next];
              const word = t(DECISION_KEYS[next]);
              return (
                <Fragment key={next}>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<Icon />}
                    disabled={actions.busy}
                    onClick={() => void actions.decide(next)}
                    aria-label={word}
                    title={word}
                    className="text-muted-foreground hover:text-ink max-sm:size-10 max-sm:px-0"
                  >
                    <span className="max-sm:sr-only">{word}</span>
                  </Button>
                </Fragment>
              );
            })
          : null}

        {assignedTo ? (
          <span
            role="img"
            aria-label={assignedTo}
            title={assignedTo}
            className="ml-auto inline-flex"
          >
            <Avatar name={nameOf(item.assigned_to)} size="sm" decorative />
          </span>
        ) : null}

        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                icon={<Ellipsis />}
                aria-label={t("shortlists.item.menu")}
                title={t("shortlists.item.menu")}
                className={
                  item.assigned_to ? "text-muted-foreground" : "ml-auto text-muted-foreground"
                }
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuSub>
                {/* The sub-menu's chevron is its one mark: no leading icon, the label aligned with the others. */}
                <DropdownMenuSubTrigger inset disabled={actions.busy}>
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
              {candidate ? (
                <DropdownMenuItem asChild>
                  <Link to="/app/candidates/$candidateId" params={{ candidateId: candidate.id }}>
                    <UserRound />
                    {t("shortlists.item.open")}
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={actions.busy}
                onSelect={() => setRemoving(true)}
              >
                <Trash2 />
                {t("shortlists.action.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
