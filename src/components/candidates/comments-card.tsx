/**
 * The team's notes on a candidate: who wrote what and when, a box to
 * add one, and a delete for the author (or an admin). Live through
 * realtime on comments, handled by the page.
 */
import { useState, type FormEvent } from "react";
import { MessageSquare, Trash2 } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import type { CommentRow } from "@/lib/db/types";
import { formatRelative, useI18n } from "@/lib/i18n";
import { memberName, useOrg } from "@/lib/org/org-context";
import { toast } from "@/lib/toast";

export function CommentsCard({
  orgId,
  candidateId,
  comments,
  canComment,
  onChanged,
}: {
  orgId: string;
  candidateId: string;
  comments: CommentRow[];
  canComment: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { members, can } = useOrg();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CommentRow | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (busy || !user || !text) return;
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      const { error } = await supabase
        .from("comments")
        .insert({ org_id: orgId, candidate_id: candidateId, author_id: user.id, body: text.slice(0, 8000) });
      if (error) {
        console.error(error);
        toast.error(t("common.error"));
        return;
      }
      setBody("");
      onChanged();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !deleting) return;
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      const { error } = await supabase.from("comments").delete().eq("id", deleting.id).eq("org_id", orgId);
      if (error) {
        console.error(error);
        toast.error(t("common.error"));
        return;
      }
      setDeleting(null);
      onChanged();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet p-4 sm:p-5">
      <h2 className="label-caps mb-3">{t("candidates.comments.title")}</h2>
      {comments.length ? (
        <ul className="space-y-3">
          {comments.map((comment) => {
            const author = memberName(members.get(comment.author_id), t("common.someone"));
            const mine = user?.id === comment.author_id;
            return (
              <li key={comment.id} className="flex gap-2">
                <Avatar name={author} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium text-ink">{author}</span>
                    <span>{formatRelative(locale, comment.created_at)}</span>
                    {mine || can("admin") ? (
                      <button
                        type="button"
                        onClick={() => setDeleting(comment)}
                        disabled={busy}
                        aria-label={t("common.delete")}
                        title={t("common.delete")}
                        className="ml-auto rounded-full p-1 hover:bg-accent disabled:opacity-50 [&_svg]:size-3.5"
                      >
                        <Trash2 />
                      </button>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-line text-sm text-ink">{comment.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={<MessageSquare />} title={t("candidates.comments.empty")} className="py-6" />
      )}
      {canComment ? (
        <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t("candidates.comments.placeholder")}
            rows={3}
            maxLength={8000}
            disabled={busy}
            aria-label={t("candidates.comments.title")}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !body.trim()}>
              {t("common.send")}
            </Button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
        title={t("candidates.comments.deleteTitle")}
        confirmLabel={t("common.delete")}
        destructive
        busy={busy}
        onConfirm={remove}
      />
    </section>
  );
}
