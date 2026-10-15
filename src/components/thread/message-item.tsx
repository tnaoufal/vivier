/**
 * One message of the thread: the author's disc (initials; a photo would
 * be greyscale through the primitive), the name, the moment (relative,
 * the exact time on hover), the body with each "@Name" in ink weight,
 * and, for the author or an administrator, a quiet delete that shows on
 * hover or focus (always on a touch screen). A message just sent and
 * not read back yet has no delete: it has no id to act on.
 */
import { Trash2 } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { memberName } from "@/lib/org/org-context";
import { renderMentions, type MentionMember } from "@/lib/shortlists/mentions";
import { isPending, type ThreadMessage } from "@/lib/threads/thread";

export function MessageItem({
  message,
  members,
  canDelete,
  onDelete,
}: {
  message: ThreadMessage;
  members: readonly MentionMember[];
  canDelete: boolean;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const name = memberName(message.author ?? undefined, t("thread.formerMember"));
  const segments = renderMentions(message.body, members);
  return (
    <div className="group flex gap-3">
      <Avatar name={name} size="sm" className="mt-0.5" decorative />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted-foreground">
          <span className="font-medium text-ink">{name}</span>
          <time dateTime={message.created_at} title={formatDateTime(locale, message.created_at)}>
            {formatRelative(locale, message.created_at)}
          </time>
          {canDelete && !isPending(message) ? (
            // A 40px target drawn into the meta line: the negative margin keeps the line's height.
            <span className="-my-2 ml-auto flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                icon={<Trash2 />}
                onClick={onDelete}
                aria-label={t("common.delete")}
                title={t("common.delete")}
                className="text-muted-foreground opacity-0 transition-opacity duration-fast hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
              />
            </span>
          ) : null}
        </div>
        <p className="whitespace-pre-line break-words text-body text-ink">
          {segments.map((segment, index) =>
            segment.kind === "mention" ? (
              <span key={index} className="font-semibold">
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}
