/**
 * The detail of one shortlist item, in a panel from the right: the
 * header names the person (photo or initials, position, years, the
 * tier, the score as a figure), says who decided and when, and carries
 * the two decisions that apply and the way to the full profile; then
 * two tabs, the model's reading of the match (the sentences, the
 * recruiter's reading, the requirements) and the team's thread on this
 * item (live, with mentions). The thread reads itself; the board tells
 * the drawer when the item changed by handing it the fresh row.
 */
import { Fragment, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { TierPill } from "@/components/briefs/tier-pill";
import { TeamThread } from "@/components/thread/team-thread";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { yearsLabel } from "@/lib/candidates/format";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { BriefCriterion, ShortlistItemStatus } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n, type TranslationKey } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import type { BoardItem } from "@/lib/shortlists/queries";
import { assessedScore, tierOf } from "@/lib/shortlists/requirements";
import { decisionsFrom } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";
import { useMemberNamer, type TeamMember } from "@/lib/shortlists/use-members";

import { DECISION_ICONS, DECISION_KEYS } from "./item-card";
import { VerdictList } from "./verdict-list";

export type DrawerTab = "reading" | "thread";

function isDrawerTab(value: string): value is DrawerTab {
  return value === "reading" || value === "thread";
}

const TRACE_KEYS: Record<ShortlistItemStatus, TranslationKey> = {
  retained: "shortlists.trace.retained",
  dismissed: "shortlists.trace.dismissed",
  to_review: "shortlists.trace.reviewed",
};

export function ItemDrawer({
  item,
  tab,
  onTabChange,
  orgId,
  criteria,
  threadCount,
  canEdit,
  members,
  currentUserId,
  onChanged,
  onClose,
}: {
  /** Null closes the drawer. */
  item: BoardItem | null;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  orgId: string;
  /** The brief's criteria, for the rows of a match that carries none of its own. */
  criteria: readonly BriefCriterion[];
  threadCount: number;
  canEdit: boolean;
  members: readonly TeamMember[];
  currentUserId: string | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { showPhotos } = useOrg();
  const nameOf = useMemberNamer();
  // The last item shown stays rendered while the sheet slides out.
  const lastRef = useRef<BoardItem | null>(null);
  if (item) lastRef.current = item;
  const shown: BoardItem | null = item ?? lastRef.current;
  const enabled = item !== null;

  const actions = useItemActions({ orgId, itemId: shown?.id ?? "", onChanged });
  const photoUrl = usePhotoUrl(shown?.candidates?.photo_path ?? null, showPhotos && enabled);

  const candidate = shown?.candidates ?? null;
  const name = candidate
    ? candidate.full_name?.trim() || t("shortlists.item.noName")
    : t("shortlists.item.candidateGone");
  const headline = candidate?.headline?.trim() ?? "";
  const years = yearsLabel(locale, candidate?.years_experience);
  const tier = tierOf(shown?.match);
  const score = assessedScore(shown?.match);

  // Who decided and when, else who added the person: a decision is never anonymous.
  const trace = shown
    ? shown.decided_at
      ? {
          text: t(TRACE_KEYS[shown.status], {
            name: nameOf(shown.decided_by),
            when: formatRelative(locale, shown.decided_at),
          }),
          at: shown.decided_at,
        }
      : {
          text: t("shortlists.item.addedBy", {
            name: nameOf(shown.added_by),
            when: formatRelative(locale, shown.created_at),
          }),
          at: shown.created_at,
        }
    : null;

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" size="lg" className="flex flex-col gap-5 overflow-hidden">
        {shown ? (
          <>
            <SheetHeader className="shrink-0 gap-3">
              <div className="flex items-start gap-4">
                <Avatar name={name} size="lg" variant="profile" photoUrl={photoUrl} decorative />
                <div className="min-w-0 flex-1">
                  <SheetTitle>{name}</SheetTitle>
                  <SheetDescription className="mt-0.5 truncate">
                    {headline || t("common.unknown")}
                  </SheetDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-muted-foreground">
                    {years ? <span>{years}</span> : null}
                    {tier ? <TierPill tier={tier} /> : null}
                    {/* The score is a figure, not a ring: the number is the signal. */}
                    {score === null ? (
                      <span>{t("shortlists.item.noAssessment")}</span>
                    ) : (
                      <span
                        className="font-medium text-ink tabular-nums"
                        title={t("shortlists.item.fitScore", { score })}
                      >
                        {t("shortlists.item.score", { score })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {trace ? (
                <p
                  className="text-meta text-muted-foreground"
                  title={formatDateTime(locale, trace.at)}
                >
                  {trace.text}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {canEdit
                  ? decisionsFrom(shown.status).map((next) => {
                      const Icon = DECISION_ICONS[next];
                      return (
                        <Fragment key={next}>
                          <Button
                            type="button"
                            variant={next === "retained" ? "primary" : "outline"}
                            icon={<Icon />}
                            disabled={actions.busy || !enabled}
                            onClick={() => void actions.decide(next)}
                          >
                            {t(DECISION_KEYS[next])}
                          </Button>
                        </Fragment>
                      );
                    })
                  : null}
                {candidate ? (
                  <Button asChild variant="ghost" icon={<UserRound />} className="sm:ml-auto">
                    <Link to="/app/candidates/$candidateId" params={{ candidateId: candidate.id }}>
                      {t("shortlists.item.open")}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </SheetHeader>

            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (isDrawerTab(value)) onTabChange(value);
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="shrink-0" aria-label={t("shortlists.drawer.tabs")}>
                <TabsTrigger value="reading">{t("shortlists.drawer.tab.reading")}</TabsTrigger>
                <TabsTrigger value="thread">
                  {t("thread.title")}
                  {threadCount ? (
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {/* Keeps the label and the count two words in the tab's name ("Discussion, 3"). */}
                      <span className="sr-only">, </span>
                      {threadCount}
                    </span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
              <SheetBody className="pt-4">
                <TabsContent value="reading" className="mt-0 fade-in">
                  <VerdictList match={shown.match} criteria={criteria} />
                </TabsContent>
                <TabsContent value="thread" className="mt-0 fade-in">
                  {enabled ? (
                    <TeamThread
                      target={{ shortlistItemId: shown.id }}
                      canPost={canEdit}
                      members={members}
                      currentUserId={currentUserId}
                      compact
                      hideHeader
                    />
                  ) : null}
                </TabsContent>
              </SheetBody>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
