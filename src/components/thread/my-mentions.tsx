/**
 * "To handle": the last messages that mention the person, newest first,
 * each a row that leads to the object it is about (a brief by its
 * title, a candidate or a shortlisted candidate by their name) with who
 * wrote it, when, and the first line. For the dashboard; re-read on
 * every change of the organisation's comments.
 */
import { Link } from "@tanstack/react-router";
import { AtSign } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Section } from "@/components/app-shell/section";
import { SkeletonRows } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { memberName } from "@/lib/org/org-context";
import { MENTIONS_LIMIT } from "@/lib/threads/queries";
import { excerpt, mentionPath, type MentionItem } from "@/lib/threads/thread";
import { useMyMentions } from "@/lib/threads/use-mentions";

export function MyMentions({
  limit = MENTIONS_LIMIT,
  className,
}: {
  limit?: number | undefined;
  className?: string | undefined;
}) {
  const { t } = useI18n();
  const { items, loading } = useMyMentions(limit);
  return (
    <Section
      title={t("thread.mentions.title")}
      count={items.length || undefined}
      {...(className !== undefined ? { className } : {})}
    >
      {loading && items.length === 0 ? (
        <div className="sheet overflow-hidden">
          <SkeletonRows rows={3} avatarSize="sm" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState compact icon={<AtSign />} title={t("thread.mentions.empty")} />
      ) : (
        <ol
          className="sheet stagger divide-y divide-border overflow-hidden"
          aria-label={t("thread.mentions.title")}
        >
          {items.map((item) => (
            <li key={item.id} className="rise-in">
              <MentionRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function MentionRow({ item }: { item: MentionItem }) {
  const { t, locale } = useI18n();
  const author = memberName(item.author ?? undefined, t("thread.formerMember"));
  const label = item.target.label ?? t("candidates.noName");
  const path = mentionPath(item.target);
  const inner = (
    <>
      <Avatar name={author} size="sm" className="mt-0.5" decorative />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{label}</p>
        <p className="text-meta text-muted-foreground">
          {author}
          {" · "}
          <time dateTime={item.created_at} title={formatDateTime(locale, item.created_at)}>
            {formatRelative(locale, item.created_at)}
          </time>
        </p>
        <p className="mt-0.5 text-sm text-ink break-words">{excerpt(item.body)}</p>
      </div>
    </>
  );
  return path ? (
    <Link to={path} className="sheet-row items-start">
      {inner}
    </Link>
  ) : (
    <div className="sheet-row items-start">{inner}</div>
  );
}
