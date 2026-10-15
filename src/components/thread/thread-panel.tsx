/**
 * The thread beside a page. On a desk, a right column of 360px that
 * stays in view while the page scrolls (the thread scrolls inside, the
 * composer at its bottom); on a phone, a drawer from the right that
 * `ThreadButton` opens from the page header's actions (the icon and the
 * count; hidden on a desk, where the column is always there). One
 * thread is mounted at a time, so the object is read once. Given
 * children, the panel lays out the two columns itself.
 */
import type { ReactNode } from "react";
import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT, type TranslationKey } from "@/lib/i18n";
import type { MentionMember } from "@/lib/shortlists/mentions";
import type { ThreadTarget } from "@/lib/threads/thread";
import { useThreadCount } from "@/lib/threads/use-thread";
import { cn } from "@/lib/utils";

import { TeamThread } from "./team-thread";
import { useDesktop } from "./use-desktop";

export function ThreadPanel({
  target,
  canPost,
  members,
  currentUserId,
  title,
  open,
  onOpenChange,
  children,
  className,
}: {
  target: ThreadTarget;
  canPost: boolean;
  members: readonly MentionMember[];
  currentUserId: string | null;
  title?: string | undefined;
  /** The drawer, on a phone: owned by the page, opened by `ThreadButton`. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page's content: given, the panel draws the two-column grid around it. */
  children?: ReactNode;
  /** On the column (a different `lg:top-*` under a taller sticky header, say). */
  className?: string | undefined;
}) {
  const t = useT();
  const desktop = useDesktop();
  const heading = title ?? t("thread.title");
  const aside = (
    <aside
      className={cn(
        "hidden lg:sticky lg:top-24 lg:flex lg:h-[calc(100dvh-7rem)] lg:w-[22.5rem] lg:flex-col",
        className,
      )}
    >
      {desktop ? (
        <TeamThread
          target={target}
          canPost={canPost}
          members={members}
          currentUserId={currentUserId}
          title={title}
        />
      ) : null}
    </aside>
  );
  return (
    <>
      {children !== undefined ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start lg:gap-8">
          <div className="min-w-0">{children}</div>
          {aside}
        </div>
      ) : (
        aside
      )}
      {desktop ? null : (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="right"
            className="flex flex-col gap-4 overflow-hidden"
            aria-describedby={undefined}
          >
            <SheetHeader className="shrink-0">
              <SheetTitle>{heading}</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col">
              <TeamThread
                target={target}
                canPost={canPost}
                members={members}
                currentUserId={currentUserId}
                title={title}
                hideHeader
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

/**
 * The header's way to the thread on a phone: the comment icon and the
 * count (read for `target` when the page does not pass one). Hidden
 * from `lg`, where the panel's column is always in view.
 */
export function ThreadButton({
  onClick,
  count,
  target,
  className,
}: {
  onClick: () => void;
  /** The count when the page knows it; else read for `target`. */
  count?: number | undefined;
  target?: ThreadTarget | undefined;
  className?: string | undefined;
}) {
  const t = useT();
  const read = useThreadCount(count === undefined && target ? target : null);
  const shown = count ?? read ?? 0;
  const countKey: TranslationKey = shown === 1 ? "thread.count.one" : "thread.count.many";
  const label = shown
    ? `${t("thread.title")} · ${t(countKey, { count: shown })}`
    : t("thread.title");
  return (
    <Button
      type="button"
      variant="outline"
      size={shown ? "default" : "icon"}
      icon={<MessageSquare />}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      className={cn("lg:hidden", className)}
    >
      {shown ? <span className="tabular-nums">{shown}</span> : null}
    </Button>
  );
}
