/**
 * The standard row of every list pane. The `li` is the row (56, 60 or
 * 64px; a line between two rows; the muted tint when selected, the
 * hover tint under the pointer; when `muted`, the photo or the initials
 * faded and the name in the muted grey, never a word faded by alpha, so
 * every text keeps AA); the interactive part inside it (a button for a
 * selection, a link built with a path helper for a page, a plain div
 * for a static row) takes `leading` (the rank, the avatar) and the
 * children (`RowText`: the name and one line); `trailing` sits beside
 * it, outside the control, so a row may hold its own buttons without a
 * control inside a control, as match-list.tsx did:
 *
 *   <ol className="stagger" tabIndex={0} onKeyDown={useListKeys(rows.length, index, select)}>
 *     {rows.map((row, i) => (
 *       <Row key={row.id} as="button" selected={i === index} onClick={() => select(i)}
 *            height="sm" leading={<Avatar name={row.name} size="md" decorative />}
 *            trailing={<Button size="icon-sm" variant="ghost" icon={<ListPlus />} aria-label="…" />}>
 *         <RowText title={row.name} line={`${row.position} · ${row.years}`} />
 *       </Row>
 *     ))}
 *   </ol>
 *
 * The selected row carries `aria-current="true"`; `useListKeys` moves
 * the selection with ArrowUp and ArrowDown (Home, End) when the list
 * or a row in it has focus, and leaves a field inside a row its own
 * keys. A value that is not a control (a date) goes inside the row
 * after `RowText`, so the whole row stays the link.
 */
import { useCallback, type KeyboardEvent, type KeyboardEventHandler, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

import { moveIndex } from "./list-keys";

export type RowHeight = "sm" | "md" | "lg";

const HEIGHTS: Record<RowHeight, string> = { sm: "min-h-14", md: "min-h-15", lg: "min-h-16" };

const INNER =
  "flex min-w-0 flex-1 items-center gap-3 self-stretch px-3 py-2 text-left text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function Row({
  as = "div",
  to,
  onClick,
  selected = false,
  muted = false,
  height = "md",
  leading,
  children,
  trailing,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  /** `button` for a selection, `link` (with `to`, a path from a helper) for a page, `div` for a static row. */
  as?: "button" | "link" | "div" | undefined;
  to?: string | undefined;
  onClick?: (() => void) | undefined;
  selected?: boolean | undefined;
  /** A row that matters less (dismissed): its avatar faded, its name in the muted grey, the line and the controls at full strength. */
  muted?: boolean | undefined;
  height?: RowHeight | undefined;
  /** Before the text: a rank, an avatar. */
  leading?: ReactNode;
  children: ReactNode;
  /** Controls of the row, outside the button or the link. */
  trailing?: ReactNode;
  className?: string | undefined;
  /** For `aria-activedescendant` on the list. */
  id?: string | undefined;
  "aria-label"?: string | undefined;
}) {
  const interactive = as === "button" || (as === "link" && to !== undefined);
  const inner = (
    <>
      {leading}
      {children}
    </>
  );
  return (
    <li
      id={id}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-w-0 items-center border-line transition-colors duration-fast ease-out-soft [&+&]:border-t",
        HEIGHTS[height],
        selected && "bg-muted",
        interactive && !selected && "hover:bg-hover",
        // The shape fades, not the words: the initials keep 5.3:1 on their faded disc, the name 5.5:1 selected.
        muted && "[&_[data-slot=avatar]]:opacity-70 [&_[data-slot=row-title]]:text-muted-foreground",
        className,
      )}
    >
      {as === "button" ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          className={cn(INNER, "cursor-pointer")}
        >
          {inner}
        </button>
      ) : as === "link" && to !== undefined ? (
        <Link
          to={to}
          onClick={onClick}
          aria-label={ariaLabel}
          className={cn(INNER, "cursor-pointer")}
        >
          {inner}
        </Link>
      ) : (
        <div className={INNER}>{inner}</div>
      )}
      {trailing ? <div className="flex shrink-0 items-center gap-1 pr-2">{trailing}</div> : null}
    </li>
  );
}

/** The two lines of a row: the name (14/18, semibold) and one line of facts (13/18, muted), each truncated. */
export function RowText({
  title,
  line,
  className,
}: {
  title: ReactNode;
  line?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span className={cn("block min-w-0 flex-1", className)}>
      <span
        data-slot="row-title"
        className="block truncate text-sm leading-[1.125rem] font-semibold text-ink"
      >
        {title}
      </span>
      {line ? (
        <span className="block truncate text-meta leading-[1.125rem] text-muted-foreground tabular-nums">
          {line}
        </span>
      ) : null}
    </span>
  );
}

/**
 * ArrowUp/ArrowDown (Home, End) over `count` rows: the handler of the
 * `ol` (`tabIndex={0}`, `aria-activedescendant` optional); a field or a
 * menu inside a row keeps its own keys.
 */
export function useListKeys(
  count: number,
  index: number,
  onIndex: (index: number) => void,
): KeyboardEventHandler<HTMLElement> {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, select, [role=combobox], [role=menu], [role=listbox]"))
        return;
      const next = moveIndex(event.key, index, count);
      if (next === null) return;
      event.preventDefault();
      if (next !== index) onIndex(next);
    },
    [count, index, onIndex],
  );
}
