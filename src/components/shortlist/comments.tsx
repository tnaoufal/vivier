/**
 * The thread under a shortlist item: each comment with its author's
 * initials, the name, when it was written, its body with the mentions
 * set apart; an edit and a delete for the author (a delete for an admin
 * too); a composer with @ completion over the team. Members comment;
 * viewers read. Its buttons stay outline: the drawer's footer already
 * carries the one filled action, the decision.
 */
import { useState } from "react";
import { MessageSquare, Pencil, Send, Trash2 } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import type { CommentRow } from "@/lib/db/types";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { parseMentions } from "@/lib/shortlists/mentions";
import { addComment, deleteComment, editComment } from "@/lib/shortlists/queries";
import { useMemberNamer, useTeamMembers } from "@/lib/shortlists/use-members";
import { toast } from "@/lib/toast";

import { MentionText } from "./item-bits";
import { MentionComposer } from "./mention-composer";

const EDITED_AFTER_MS = 5_000;

export function CommentsThread({
  orgId,
  itemId,
  comments,
  loading,
  canComment,
  onChanged,
}: {
  orgId: string;
  itemId: string;
  comments: CommentRow[];
  loading: boolean;
  canComment: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { can } = useOrg();
  const members = useTeamMembers();
  const nameOf = useMemberNamer();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [deleting, setDeleting] = useState<CommentRow | null>(null);

  async function write(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      onChanged();
      return true;
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const text = body.trim();
    if (!user || !text) return;
    const authorId = user.id;
    const sent = await write(async () => {
      const supabase = await requireSupabase();
      await addComment(supabase, { orgId, itemId, authorId, body: text, mentions: parseMentions(text, members) });
    });
    if (sent) setBody("");
  }

  async function saveEdit() {
    if (!editing) return;
    const text = editing.draft.trim();
    if (!text) return;
    const commentId = editing.id;
    const saved = await write(async () => {
      const supabase = await requireSupabase();
      await editComment(supabase, orgId, commentId, text, parseMentions(text, members));
    });
    if (saved) setEditing(null);
  }

  async function remove() {
    if (!deleting) return;
    const commentId = deleting.id;
    const done = await write(async () => {
      const supabase = await requireSupabase();
      await deleteComment(supabase, orgId, commentId);
    });
    if (done) setDeleting(null);
  }

  const count = comments.length;
  const countLabel =
    count === 1 ? t("shortlists.comments.count.one") : t("shortlists.comments.count.many", { count });

  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold text-ink">
        {t("shortlists.comments.title")}
        {count ? (
          <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{countLabel}</span>
        ) : null}
      </h3>
      {comments.length ? (
        <ul className="stagger space-y-5">
          {comments.map((comment) => {
            const author = nameOf(comment.author_id);
            const mine = user?.id === comment.author_id;
            const edited = Date.parse(comment.updated_at) - Date.parse(comment.created_at) > EDITED_AFTER_MS;
            return (
              <li key={comment.id} className="rise-in flex gap-3">
                <Avatar name={author} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                    <span className="font-medium text-ink">{author}</span>
                    <time dateTime={comment.created_at} title={formatDateTime(locale, comment.created_at)}>
                      {formatRelative(locale, comment.created_at)}
                    </time>
                    {edited ? <span>({t("shortlists.comments.edited")})</span> : null}
                    <span className="ml-auto flex items-center">
                      {mine && canComment ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditing({ id: comment.id, draft: comment.body })}
                          disabled={busy}
                          aria-label={t("common.edit")}
                          title={t("common.edit")}
                          className="text-muted-foreground"
                        >
                          <Pencil />
                        </Button>
                      ) : null}
                      {mine || can("admin") ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleting(comment)}
                          disabled={busy}
                          aria-label={t("common.delete")}
                          title={t("common.delete")}
                          className="text-muted-foreground hover:text-negative"
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  {editing?.id === comment.id ? (
                    <div className="mt-2 space-y-2">
                      <MentionComposer
                        value={editing.draft}
                        onChange={(draft) => setEditing({ id: comment.id, draft })}
                        members={members}
                        ariaLabel={t("common.edit")}
                        disabled={busy}
                        autoFocus
                        onSubmit={() => void saveEdit()}
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                          {t("common.cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void saveEdit()}
                          disabled={busy || !editing.draft.trim()}
                        >
                          {t("common.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <MentionText body={comment.body} members={members} className="mt-0.5" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
          <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
          {loading ? t("common.loading") : t("shortlists.comments.empty")}
        </div>
      )}

      {canComment ? (
        <div className="space-y-3 pt-1">
          <MentionComposer
            value={body}
            onChange={setBody}
            members={members}
            ariaLabel={t("shortlists.comments.title")}
            placeholder={t("shortlists.comments.placeholder")}
            disabled={busy}
            onSubmit={() => void submit()}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-meta text-muted-foreground">{t("shortlists.comments.help")}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              icon={<Send />}
              onClick={() => void submit()}
              disabled={busy || !body.trim()}
            >
              {t("shortlists.comments.send")}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
        title={t("shortlists.comments.deleteTitle")}
        text={t("shortlists.comments.deleteText")}
        confirmLabel={t("common.delete")}
        destructive
        busy={busy}
        onConfirm={remove}
      />
    </section>
  );
}
