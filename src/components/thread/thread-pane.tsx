/**
 * The thread as the right pane of the plane. From `lg`, `ThreadPane` is
 * the 320px column (the thread's own background, a line on its left)
 * holding `TeamThread` with its header and the composer at the bottom,
 * rendered only while `open`; below `lg` it is a sheet from the right
 * on the same flag. `useThreadPane` is the flag: remembered per device
 * (localStorage, `vivier-thread`), open by default from `xl` and closed
 * between `lg` and `xl`, read through `useSyncExternalStore` so the
 * server and the first client render agree on "closed"; below `lg` the
 * flag is the sheet's and is not remembered. `ThreadToggle` is the
 * header's button that flips it (the comment icon, the count beside it
 * from `sm`), pressed from `lg`, a dialog opener below. `children`, when
 * given, render above the thread (a `Segmented` that switches the
 * target, see brief.md). One thread is mounted at a time, so the object
 * is read once.
 */
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";

import { PHONE_ICON } from "@/components/app-shell/workspace";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT, type TranslationKey } from "@/lib/i18n";
import type { MentionMember } from "@/lib/shortlists/mentions";
import type { ThreadTarget } from "@/lib/threads/thread";
import { useThreadCount } from "@/lib/threads/use-thread";
import { cn } from "@/lib/utils";

import { TeamThread } from "./team-thread";
import { useDesktop } from "./use-desktop";

export const THREAD_STORAGE_KEY = "vivier-thread";
/** Tailwind's `xl`: the pane is open by default from here. */
const WIDE_QUERY = "(min-width: 80rem)";

/** The flag from what the device remembers ("open" or "closed") and, failing that, its width (open from `xl`). */
export function readThreadOpen(stored: string | null, wide: boolean): boolean {
  if (stored === "open") return true;
  if (stored === "closed") return false;
  return wide;
}

const listeners = new Set<() => void>();
/** The last choice made in this tab, so a blocked storage still toggles. */
let chosen: boolean | null = null;

function wideQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(WIDE_QUERY);
}

function storedChoice(): string | null {
  try {
    return window.localStorage.getItem(THREAD_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const query = wideQuery();
  query?.addEventListener("change", onChange);
  // Another tab's choice: this one follows it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THREAD_STORAGE_KEY) return;
    chosen = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    query?.removeEventListener("change", onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot(): boolean {
  return chosen ?? readThreadOpen(storedChoice(), wideQuery()?.matches ?? false);
}

function serverSnapshot(): boolean {
  return false;
}

function remember(open: boolean): void {
  chosen = open;
  try {
    window.localStorage.setItem(THREAD_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // Storage may be blocked: the choice holds for this tab.
  }
  for (const listener of listeners) listener();
}

export function useThreadPane(): {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
} {
  const desktop = useDesktop();
  const remembered = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [sheetOpen, setSheetOpen] = useState(false);
  const open = desktop ? remembered : sheetOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (desktop) remember(next);
      else setSheetOpen(next);
    },
    [desktop],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return { open, toggle, setOpen };
}

export function ThreadPane({
  target,
  title,
  canPost,
  members,
  currentUserId,
  open,
  onOpenChange,
  children,
  className,
}: {
  target: ThreadTarget;
  /** The thread's title; "Discussion" when omitted. */
  title?: string | undefined;
  canPost: boolean;
  members: readonly MentionMember[];
  currentUserId: string | null;
  /** `useThreadPane().open`. */
  open: boolean;
  /** `useThreadPane().setOpen`: the sheet closes through it below `lg`. */
  onOpenChange: (open: boolean) => void;
  /** Above the thread: a `Segmented` that switches the target. */
  children?: ReactNode;
  className?: string | undefined;
}) {
  const t = useT();
  const desktop = useDesktop();
  const heading = title ?? t("thread.title");
  if (desktop) {
    if (!open) return null;
    return (
      <aside
        aria-label={heading}
        className={cn(
          // The previous pane's right line and this left line sit on the same pixel.
          "-ml-px flex w-80 min-h-0 shrink-0 flex-col border-l border-line bg-thread",
          className,
        )}
      >
        {children ? <div className="shrink-0 border-b border-line px-4 py-3">{children}</div> : null}
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
          <TeamThread
            target={target}
            canPost={canPost}
            members={members}
            currentUserId={currentUserId}
            title={title}
          />
        </div>
      </aside>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-4 overflow-hidden"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>{heading}</SheetTitle>
        </SheetHeader>
        {children}
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
  );
}

/**
 * The header's way to the thread: the comment icon and the count (read
 * for `target` when the page does not pass one), pressed while the pane
 * is open from `lg`, a dialog opener below.
 */
export function ThreadToggle({
  open,
  onToggle,
  count,
  target,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  /** The count when the page knows it; else read for `target`. */
  count?: number | undefined;
  target?: ThreadTarget | undefined;
  className?: string | undefined;
}) {
  const t = useT();
  const desktop = useDesktop();
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
      onClick={onToggle}
      aria-label={label}
      title={label}
      {...(desktop ? { "aria-pressed": open } : { "aria-haspopup": "dialog", "aria-expanded": open })}
      className={cn(shown ? PHONE_ICON : null, className)}
    >
      {shown ? <span className="tabular-nums max-sm:sr-only">{shown}</span> : null}
    </Button>
  );
}
