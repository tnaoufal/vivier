/**
 * The team's thread on one object (a brief, a candidate, a shortlisted
 * candidate): a short header (the title, the count), the messages
 * grouped by day under a quiet label, newest last, each a disc, a name,
 * a moment and a body with its mentions in ink weight (a list, no
 * bubbles: the caller's messages sit with the others), and a composer
 * kept at the bottom for members. What is sent shows at once and the
 * next read confirms it; every change of the object's column re-reads;
 * what arrives is announced (a polite live region on the list, the
 * skeleton outside it); a failure is one line in a toast. `compact` caps
 * the height and scrolls inside (a drawer's tab, a card); by default the
 * thread fills its column. `hideHeader` is for a drawer whose title is
 * the thread's. `pane` draws it as the plane's thread pane: the header
 * (48px, a line under it), the list and the composer (on the paper, a
 * line above it) each carry the pane's 16px gutter, edge to edge.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import type { MentionMember } from "@/lib/shortlists/mentions";
import {
  groupByDay,
  isMine,
  mentionsOf,
  type ThreadDayLabel,
  type ThreadMessage,
  type ThreadTarget,
} from "@/lib/threads/thread";
import { useThread } from "@/lib/threads/use-thread";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { ThreadComposer } from "./composer";
import { MessageItem } from "./message-item";

/** How close to the bottom the reader must be for a new message to scroll into view. */
const STICK_PX = 120;

function dayText(label: ThreadDayLabel, t: (key: TranslationKey) => string): string {
  if (label.kind === "today") return t("thread.today");
  if (label.kind === "yesterday") return t("thread.yesterday");
  return label.text;
}

export function TeamThread({
  target,
  canPost,
  members,
  currentUserId,
  title,
  compact = false,
  hideHeader = false,
  pane = false,
  className,
}: {
  target: ThreadTarget;
  /** Members write; viewers read. */
  canPost: boolean;
  /** The team, for the mentions (`useTeamMembers()`). */
  members: readonly MentionMember[];
  currentUserId: string | null;
  /** The header's title; "Discussion" when omitted. */
  title?: string | undefined;
  /** A capped height with its own scroll, for a drawer's tab or a card. */
  compact?: boolean | undefined;
  /** No header of its own: the drawer's title is the thread's. */
  hideHeader?: boolean | undefined;
  /** The thread pane of the plane: the gutter inside each part, the lines edge to edge. */
  pane?: boolean | undefined;
  className?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const { can } = useOrg();
  const { messages, count, loading, error, post, remove, rowKey } = useThread(
    target,
    currentUserId,
  );
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<ThreadMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** True while the reader is at the bottom: a new message then scrolls into view. */
  const stickRef = useRef(true);
  const shownRef = useRef(0);
  // The sentences through a ref: a toast belongs to the moment, not to the locale.
  const tRef = useRef(t);
  tRef.current = t;
  const headingId = useId();
  const heading = title ?? t("thread.title");
  const admin = can("admin");

  useEffect(() => {
    if (error) toast.error(tRef.current("common.error"));
  }, [error]);

  useEffect(() => {
    const element = listRef.current;
    const previous = shownRef.current;
    shownRef.current = messages.length;
    if (!element || messages.length <= previous) return;
    const last = messages[messages.length - 1];
    if (previous === 0 || stickRef.current || (last !== undefined && isMine(last, currentUserId))) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, currentUserId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const sent = await post(text, mentionsOf(text, members));
    if (!sent) {
      toast.error(tRef.current("common.error"));
      // The text comes back unless the person has moved on to the next message.
      setDraft((current) => (current.trim() ? current : text));
    }
  }, [draft, members, post]);

  async function confirmDelete() {
    if (!deleting) return;
    const messageId = deleting.id;
    setDeleting(null);
    const done = await remove(messageId);
    if (!done) toast.error(tRef.current("common.error"));
  }

  const days = groupByDay(messages, locale);
  const countKey: TranslationKey = count === 1 ? "thread.count.one" : "thread.count.many";

  return (
    <section
      aria-labelledby={hideHeader ? undefined : headingId}
      aria-label={hideHeader ? heading : undefined}
      className={cn(
        "flex min-h-0 flex-col",
        compact ? "max-h-[min(32rem,70dvh)]" : "h-full",
        className,
      )}
    >
      {hideHeader ? null : (
        <header
          className={cn(
            "shrink-0",
            pane ? "flex min-h-12 items-center border-b border-line px-4" : "pb-3",
          )}
        >
          <h2
            id={headingId}
            className={cn("font-semibold text-ink", pane ? "text-sm" : "text-base")}
          >
            {heading}
            {count ? (
              <>
                <span className="sr-only">, {t(countKey, { count })}</span>
                <span
                  aria-hidden="true"
                  className="ml-2 font-normal text-muted-foreground tabular-nums"
                >
                  {count}
                </span>
              </>
            ) : null}
          </h2>
        </header>
      )}
      <div
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX;
        }}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", pane && "p-4")}
      >
        {loading && messages.length === 0 ? (
          <>
            <p className="sr-only">{t("common.loading")}</p>
            <SkeletonRows rows={3} avatarSize="sm" className="[&>li]:px-0" />
          </>
        ) : (
          // Mounted with what was read, so the history is not read out; a message that lands
          // after is an addition and is announced. The skeleton stays outside the live region.
          <div aria-live="polite" aria-relevant="additions">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("thread.empty")}</p>
            ) : (
              days.map((day) => (
                <section
                  key={day.key}
                  aria-labelledby={`${headingId}-${day.key}`}
                  className="pt-3 first:pt-0"
                >
                  <h3
                    id={`${headingId}-${day.key}`}
                    className="py-1 text-center text-meta text-muted-foreground"
                  >
                    {dayText(day.label, t)}
                  </h3>
                  <ol className="space-y-4 py-3">
                    {day.messages.map((message) => (
                      <li key={rowKey(message)}>
                        <MessageItem
                          message={message}
                          members={members}
                          canDelete={canPost && (admin || isMine(message, currentUserId))}
                          onDelete={() => setDeleting(message)}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              ))
            )}
          </div>
        )}
      </div>
      {canPost ? (
        <div
          className={cn("shrink-0 border-t border-line bg-background", pane ? "px-4 py-3" : "pt-3")}
        >
          <ThreadComposer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            members={members}
            placeholder={t("thread.placeholder")}
            ariaLabel={heading}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("thread.deleteTitle")}
        text={t("thread.deleteText")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={confirmDelete}
      />
    </section>
  );
}
