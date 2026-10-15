/**
 * "To handle": the last messages that mention the person, newest first,
 * each a row of the plane (`Row`, lines between rows, no sheet) that
 * leads to the object it is about (a brief by its title, a candidate or
 * a shortlisted candidate by their name), with who wrote it, when and
 * the first words on one line. The rows' names line up with the block's
 * title. For the dashboard's detail pane; re-read on every change of
 * the organisation's comments.
 */
import { Fragment } from "react";
import { AtSign } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { ROW_SKELETON, Row, RowText } from "@/components/app-shell/row";
import { Section } from "@/components/app-shell/section";
import { SkeletonRows } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { memberName } from "@/lib/org/org-context";
import { MENTIONS_LIMIT } from "@/lib/threads/queries";
import { excerpt, mentionPath, type MentionItem } from "@/lib/threads/thread";
import { useMyMentions } from "@/lib/threads/use-mentions";

/** The skeleton drawn like the 64px rows it stands for, pulled into the gutter like them. */
const SKELETON = `-mx-3 ${ROW_SKELETON.lg}`;

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
        <SkeletonRows rows={3} avatarSize="md" className={SKELETON} />
      ) : items.length === 0 ? (
        <EmptyState quiet icon={<AtSign />} title={t("thread.mentions.empty")} />
      ) : (
        // Pulled into the pane's gutter by the row's own 12px, so the names line up with the title.
        <ol className="stagger -mx-3" aria-label={t("thread.mentions.title")}>
          {items.map((item) => (
            <Fragment key={item.id}>
              <MentionRow item={item} />
            </Fragment>
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
  return (
    <Row
      as={path ? "link" : "div"}
      to={path ?? undefined}
      height="lg"
      className="rise-in"
      leading={<Avatar name={author} size="md" decorative />}
    >
      <RowText
        title={label}
        line={
          <>
            <span className="font-medium text-ink">{author}</span>
            {" · "}
            <time dateTime={item.created_at} title={formatDateTime(locale, item.created_at)}>
              {formatRelative(locale, item.created_at)}
            </time>
            {" · "}
            {excerpt(item.body)}
          </>
        }
      />
    </Row>
  );
}
