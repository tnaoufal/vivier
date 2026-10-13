/**
 * The detail of one shortlist item, in a sheet from the right: the
 * candidate in short, the explained match against the brief, the team's
 * note (saved when the field loses focus), the votes, the comments with
 * mentions, and the item's history. Members write; viewers read. The
 * page tells it when the tables changed so its reads follow.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { memberNames } from "@/lib/activity/activity";
import type { ActivityNames } from "@/lib/activity/describe";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import type { BriefCriterion } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import {
  listItemComments,
  listItemHistory,
  readDrawerCandidate,
  type BoardItem,
} from "@/lib/shortlists/queries";
import { NO_VOTES, type VoteTally } from "@/lib/shortlists/tally";
import { useItemActions } from "@/lib/shortlists/use-item-actions";

import { CommentsThread } from "./comments";
import { DrawerProfile } from "./drawer-profile";
import { DecisionTrace, VoteButtons } from "./item-bits";
import { ItemHistory } from "./item-history";
import { VerdictList } from "./verdict-list";

export function ItemDrawer({
  item,
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
  orgId: string;
  briefId: string | null;
  briefTitle: string | null;
  criteria: BriefCriterion[];
  tally: VoteTally;
  canAct: boolean;
  /** Bumped by the page on every realtime change: the comments and history re-read. */
  refreshSignal: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { members } = useOrg();
  // The last item shown stays rendered while the sheet slides out.
  const lastRef = useRef<BoardItem | null>(null);
  if (item) lastRef.current = item;
  const shown = item ?? lastRef.current;
  const itemId = shown?.id ?? null;
  const candidateId = shown?.candidate_id ?? null;
  const enabled = item !== null;

  const actions = useItemActions({ orgId, itemId: itemId ?? "", userId: user?.id ?? null, onChanged });

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
    shown?.candidates?.full_name?.trim() || (shown?.candidates ? t("shortlists.item.noName") : t("shortlists.item.candidateGone"));
  const headline = shown?.candidates?.headline?.trim() ?? "";

  const names = useMemo<ActivityNames>(() => {
    const briefs = new Map<string, string>();
    if (briefId && briefTitle) briefs.set(briefId, briefTitle);
    const candidates = new Map<string, string>();
    if (candidateId && shown?.candidates?.full_name?.trim()) candidates.set(candidateId, shown.candidates.full_name.trim());
    return { members: memberNames(members), briefs, candidates };
  }, [briefId, briefTitle, candidateId, members, shown?.candidates?.full_name]);

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {shown ? (
          <div className="space-y-6">
            <SheetHeader className="pr-8 text-left">
              <SheetTitle className="font-display text-xl text-ink">{candidateName}</SheetTitle>
              <SheetDescription>{headline || t("common.unknown")}</SheetDescription>
              <DecisionTrace status={shown.status} decidedBy={shown.decided_by} decidedAt={shown.decided_at} />
            </SheetHeader>

            <DrawerProfile candidate={candidate.data ?? null} fallback={shown.candidates} loading={candidate.loading} />

            <VerdictList match={shown.match} criteria={criteria} />

            <section>
              <h3 className="label-caps mb-2">{t("shortlists.note.title")}</h3>
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
                <p className="whitespace-pre-line text-sm text-ink">
                  {shown.note?.trim() || <span className="text-muted-foreground">{t("shortlists.note.empty")}</span>}
                </p>
              )}
            </section>

            <section>
              <VoteButtons
                tally={item ? tally : NO_VOTES}
                canVote={canAct && item !== null}
                busy={actions.busy}
                onVote={(value) => void actions.vote(value, tally.mine)}
              />
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

            <ItemHistory rows={history.data ?? []} names={names} loading={history.loading} error={history.error !== null} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
