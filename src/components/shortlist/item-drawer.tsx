/**
 * The detail of one shortlist item, in a panel from the right, laid out
 * so a recruiter decides without scrolling past what they do not need:
 * the header names the person (photo or initials, title, status, tier,
 * decision, who decided); three tabs hold the decision (the fit, the
 * model's detailed reading, the requirement list), the profile in short
 * and the team's side (votes, the shared note, the comments with
 * mentions, the history); the footer carries the decision controls for
 * members. The page tells the drawer when the tables changed so its
 * reads follow.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { DecisionPill } from "@/components/briefs/decision-pill";
import { TierPill } from "@/components/briefs/tier-pill";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { memberNames } from "@/lib/activity/activity";
import type { ActivityNames } from "@/lib/activity/describe";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion, ShortlistItemStatus } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import {
  listItemComments,
  listItemHistory,
  readDrawerCandidate,
  type BoardItem,
} from "@/lib/shortlists/queries";
import { tierOf } from "@/lib/shortlists/requirements";
import { NO_VOTES, type VoteTally } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";
import { useTeamMembers } from "@/lib/shortlists/use-members";

import { CommentsThread } from "./comments";
import { DrawerProfile } from "./drawer-profile";
import { DecisionTrace, StatusPill, VoteButtons } from "./item-bits";
import { ItemHistory } from "./item-history";
import { VerdictList } from "./verdict-list";

export type DrawerTab = "decision" | "profile" | "team";

const TABS: readonly DrawerTab[] = ["decision", "profile", "team"];

function isDrawerTab(value: string): value is DrawerTab {
  return (TABS as readonly string[]).includes(value);
}

/** Where an item can go from each status; the current one is never offered. */
const NEXT_STATUSES: Record<ShortlistItemStatus, ShortlistItemStatus[]> = {
  to_review: ["retained", "dismissed"],
  retained: ["dismissed", "to_review"],
  dismissed: ["retained", "to_review"],
};

function nextStatusesOf(status: ShortlistItemStatus): ShortlistItemStatus[] {
  return NEXT_STATUSES[status];
}

const NO_ASSIGNEE = "__none__";

export function ItemDrawer({
  item,
  tab,
  onTabChange,
  orgId,
  briefId,
  briefTitle,
  criteria,
  tally,
  canAct,
  refreshSignal,
  onChanged,
  onClose,
}: {
  /** Null closes the drawer. */
  item: BoardItem | null;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  orgId: string;
  briefId: string | null;
  briefTitle: string | null;
  criteria: readonly BriefCriterion[];
  tally: VoteTally;
  canAct: boolean;
  /** Bumped by the page on every realtime change: the comments and history re-read. */
  refreshSignal: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { members, showPhotos } = useOrg();
  const team = useTeamMembers();
  // The last item shown stays rendered while the sheet slides out.
  const lastRef = useRef<BoardItem | null>(null);
  if (item) lastRef.current = item;
  const shown = item ?? lastRef.current;
  const itemId = shown?.id ?? null;
  const candidateId = shown?.candidate_id ?? null;
  const enabled = item !== null;

  const actions = useItemActions({ orgId, itemId: itemId ?? "", userId: user?.id ?? null, onChanged });
  const photoUrl = usePhotoUrl(shown?.candidates?.photo_path ?? null, showPhotos && enabled);

  const candidate = useQuery(
    `drawer-candidate:${orgId}:${candidateId ?? ""}`,
    async () => (candidateId ? readDrawerCandidate(await requireSupabase(), orgId, candidateId) : null),
    enabled && candidateId !== null,
  );
  const comments = useQuery(
    `drawer-comments:${orgId}:${itemId ?? ""}`,
    async () => (itemId ? listItemComments(await requireSupabase(), orgId, itemId) : []),
    enabled && itemId !== null,
  );
  const history = useQuery(
    `drawer-history:${orgId}:${itemId ?? ""}:${briefId ?? ""}`,
    async () =>
      itemId && candidateId
        ? listItemHistory(await requireSupabase(), orgId, { id: itemId, candidate_id: candidateId }, briefId)
        : [],
    enabled && itemId !== null,
  );

  const refreshComments = comments.refresh;
  const refreshHistory = history.refresh;
  useEffect(() => {
    if (refreshSignal === 0) return;
    void refreshComments();
    void refreshHistory();
  }, [refreshComments, refreshHistory, refreshSignal]);

  const [note, setNote] = useState("");
  const noteItemRef = useRef<string | null>(null);
  useEffect(() => {
    // A new item, or a note changed by someone else: show what the database holds.
    if (itemId !== noteItemRef.current || document.activeElement?.id !== "shortlist-item-note") {
      noteItemRef.current = itemId;
      setNote(shown?.note ?? "");
    }
  }, [itemId, shown?.note]);

  async function saveNote() {
    if (!shown || !canAct) return;
    if (note.trim() === (shown.note ?? "").trim()) return;
    await actions.saveNote(note);
  }

  const candidateName =
    shown?.candidates?.full_name?.trim() ||
    (shown?.candidates ? t("shortlists.item.noName") : t("shortlists.item.candidateGone"));
  const headline = shown?.candidates?.headline?.trim() ?? "";
  const tier = tierOf(shown?.match);
  const assessment = shown?.match?.assessment ?? null;
  const assignee = shown?.assigned_to ?? null;
  const assignedKnown = assignee === null || team.some((member) => member.id === assignee);
  const commentCount = comments.data?.length ?? 0;

  const names = useMemo<ActivityNames>(() => {
    const briefs = new Map<string, string>();
    if (briefId && briefTitle) briefs.set(briefId, briefTitle);
    const candidates = new Map<string, string>();
    if (candidateId && shown?.candidates?.full_name?.trim()) {
      candidates.set(candidateId, shown.candidates.full_name.trim());
    }
    return { members: memberNames(members), briefs, candidates };
  }, [briefId, briefTitle, candidateId, members, shown?.candidates?.full_name]);

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
                <Avatar name={candidateName} size="xl" variant="profile" photoUrl={photoUrl} />
                <div className="min-w-0 flex-1">
                  <SheetTitle>{candidateName}</SheetTitle>
                  <SheetDescription className="mt-0.5 truncate">
                    {headline || t("common.unknown")}
                  </SheetDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusPill status={shown.status} />
                    {tier ? <TierPill tier={tier} /> : null}
                    {assessment ? <DecisionPill decision={assessment.decision} /> : null}
                  </div>
                  {assessment?.rankNote ? (
                    <p className="mt-1.5 text-meta text-muted-foreground">
                      {t("shortlists.item.rankNote", { note: assessment.rankNote })}
                    </p>
                  ) : null}
                </div>
              </div>
              <DecisionTrace status={shown.status} decidedBy={shown.decided_by} decidedAt={shown.decided_at} />
            </SheetHeader>

            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (isDrawerTab(value)) onTabChange(value);
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="shrink-0" aria-label={t("shortlists.drawer.tabs")}>
                <TabsTrigger value="decision">{t("shortlists.drawer.tab.decision")}</TabsTrigger>
                <TabsTrigger value="profile">{t("shortlists.drawer.tab.profile")}</TabsTrigger>
                <TabsTrigger value="team">
                  {t("shortlists.drawer.tab.team")}
                  {commentCount ? (
                    <span className="text-muted-foreground tabular-nums">{commentCount}</span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
              <SheetBody className="pt-4">
                <TabsContent value="decision" className="mt-0 fade-in">
                  <VerdictList match={shown.match} criteria={criteria} />
                </TabsContent>
                <TabsContent value="profile" className="mt-0 fade-in">
                  <DrawerProfile
                    candidate={candidate.data ?? null}
                    fallback={shown.candidates}
                    loading={candidate.loading}
                  />
                </TabsContent>
                <TabsContent value="team" className="mt-0 fade-in space-y-8">
                  <section className="space-y-3">
                    <h3 className="text-base font-semibold text-ink">
                      {t("shortlists.vote.title")}
                      <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                        {t("shortlists.vote.tally", { up: tally.up, down: tally.down })}
                      </span>
                    </h3>
                    <VoteButtons
                      tally={item ? tally : NO_VOTES}
                      canVote={canAct && item !== null}
                      busy={actions.busy}
                      onVote={(value) => void actions.vote(value, tally.mine)}
                    />
                    {canAct ? <p className="text-meta text-muted-foreground">{t("shortlists.vote.help")}</p> : null}
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-base font-semibold text-ink">{t("shortlists.note.title")}</h3>
                    {canAct ? (
                      <Textarea
                        id="shortlist-item-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        onBlur={() => void saveNote()}
                        placeholder={t("shortlists.note.placeholder")}
                        rows={3}
                        maxLength={4000}
                        disabled={actions.busy}
                        aria-label={t("shortlists.note.title")}
                      />
                    ) : (
                      <p className="whitespace-pre-line break-words text-body text-ink">
                        {shown.note?.trim() || (
                          <span className="text-muted-foreground">{t("shortlists.note.empty")}</span>
                        )}
                      </p>
                    )}
                  </section>

                  <CommentsThread
                    orgId={orgId}
                    itemId={shown.id}
                    comments={comments.data ?? []}
                    loading={comments.loading}
                    canComment={canAct && item !== null}
                    onChanged={() => {
                      void refreshComments();
                      void refreshHistory();
                      onChanged();
                    }}
                  />

                  <ItemHistory
                    rows={history.data ?? []}
                    names={names}
                    loading={history.loading}
                    error={history.error !== null}
                  />
                </TabsContent>
              </SheetBody>
            </Tabs>

            {canAct ? (
              <SheetFooter className="shrink-0 border-t border-border pt-4 sm:items-center sm:justify-between">
                <Select
                  value={assignee ?? NO_ASSIGNEE}
                  onValueChange={(value) => void actions.assign(value === NO_ASSIGNEE ? null : value)}
                  disabled={actions.busy || !enabled}
                >
                  <SelectTrigger className="sm:w-56" aria-label={t("shortlists.assign.label")}>
                    <SelectValue placeholder={t("shortlists.assign.placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ASSIGNEE}>{t("shortlists.assign.none")}</SelectItem>
                    {!assignedKnown && assignee ? (
                      <SelectItem value={assignee}>{t("shortlists.formerMember")}</SelectItem>
                    ) : null}
                    {team.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {nextStatusesOf(shown.status).map((next) => (
                    <Button
                      key={next}
                      type="button"
                      variant={next === "retained" ? "primary" : "outline"}
                      icon={next === "retained" ? <Check /> : next === "dismissed" ? <X /> : <RotateCcw />}
                      disabled={actions.busy || !enabled}
                      onClick={() => void actions.decide(next)}
                      className={next === "dismissed" ? "text-negative hover:text-negative" : ""}
                    >
                      {next === "retained"
                        ? t("shortlists.action.retain")
                        : next === "dismissed"
                          ? t("shortlists.action.dismiss")
                          : t("shortlists.action.review")}
                    </Button>
                  ))}
                </div>
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
