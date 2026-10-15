/**
 * The plane of every signed-in page: a 56px header (the eyebrow as a
 * quiet link before the title in one line, the title, the meta, the
 * actions with the one filled button) and panes side by side, each
 * scrolling inside itself. From `lg` the frame fills the viewport (the
 * shell's column is as tall as the viewport): the rail and the header
 * are fixed by construction and the viewport never scrolls. Below `lg`
 * the header is sticky with a menu button that opens the rail's items
 * in a sheet, the meta is hidden below `sm`, the panes stack full width
 * and the page scrolls.
 *
 * `Pane` is one column (the list of 440 or 520px, or the detail that
 * fills the rest) with its own label, an optional header and footer
 * kept in place around the body that scrolls; `PaneTitle` the
 * label-caps line of a pane header (a title, its count, an action);
 * `PHONE_ICON` the classes a header action takes to shrink to its icon
 * on a phone (the page keeps the label in a `max-sm:sr-only` span and
 * an `aria-label`).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { BrandSquare, RailItems } from "./rail";

/** On a header action: a 40px icon button on a phone (keep the label in a `max-sm:sr-only` span). */
export const PHONE_ICON = "max-sm:size-10 max-sm:px-0";

export function Workspace({
  title,
  eyebrow,
  meta,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  /** The way back, as a quiet link ("Briefs" before "Directeur…"). */
  eyebrow?: ReactNode;
  /** The page's figures after the title: a count, a date, a pill, a `Segmented`. Hidden below `sm`. */
  meta?: ReactNode;
  /** Right-aligned: the one filled button, the `ThreadToggle`, an `Ellipsis` menu. */
  actions?: ReactNode;
  /** The panes (`Pane`, `ThreadPane`). */
  children: ReactNode;
  className?: string | undefined;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // The phone menu closes whenever the page changes, whatever opened it.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-background text-foreground lg:h-dvh",
        className,
      )}
    >
      <header className="sticky top-0 z-sticky flex h-14 shrink-0 items-center gap-3 border-b border-line bg-background px-4 sm:px-5 lg:static">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ml-2 shrink-0 lg:hidden"
          onClick={() => setMenuOpen(true)}
          aria-label={t("common.menu")}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
        >
          <Menu />
        </Button>
        <BrandSquare className="max-sm:hidden lg:hidden" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {eyebrow ? (
            <>
              <span className="shrink-0 text-meta text-muted-foreground">{eyebrow}</span>
              <span aria-hidden="true" className="shrink-0 text-meta text-neutral">
                /
              </span>
            </>
          ) : null}
          <h1 className="min-w-0 truncate text-base font-semibold text-ink">{title}</h1>
          {meta ? (
            <div className="hidden min-w-0 shrink-0 items-center gap-2 text-meta text-muted-foreground sm:flex">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {/* Relative: between `lg` and `xl` an open ThreadPane lies over the detail's right side. */}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">{children}</div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 sm:max-w-72 sm:p-0 lg:hidden"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">{t("common.menu")}</SheetTitle>
          <RailItems onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

export type PaneWidth = "list" | "wide" | "fill";

const WIDTHS: Record<PaneWidth, string> = {
  list: "lg:w-[27.5rem] lg:shrink-0",
  wide: "lg:w-[32.5rem] lg:shrink-0",
  fill: "min-w-0 lg:flex-1",
};

/**
 * One column of the plane: a labelled region with an optional header
 * and footer kept in place and a body that scrolls from `lg` (below,
 * the pane is full width and the page scrolls). A line on its right,
 * except on the last pane.
 */
export function Pane({
  label,
  width = "fill",
  header,
  footer,
  children,
  className,
  bodyClassName,
}: {
  /** The region's name for assistive technologies. */
  label: string;
  width?: PaneWidth | undefined;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  /** On the scrolling body (a padding, a grid). */
  bodyClassName?: string | undefined;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex w-full min-w-0 flex-col border-line max-lg:border-b max-lg:last:border-b-0 lg:min-h-0 lg:border-r lg:last:border-r-0",
        WIDTHS[width],
        className,
      )}
    >
      {header ? <div className="shrink-0 border-b border-line">{header}</div> : null}
      <div className={cn("flex-1 lg:min-h-0 lg:overflow-y-auto", bodyClassName)}>{children}</div>
      {footer ? <div className="shrink-0 border-t border-line">{footer}</div> : null}
    </section>
  );
}

/** The line of a pane header: a label-caps title with its count, an action on the right. */
export function PaneTitle({
  title,
  count,
  action,
  as: Heading = "h2",
  className,
}: {
  title: ReactNode;
  count?: number | undefined;
  action?: ReactNode;
  as?: "h2" | "h3" | "p" | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex min-h-12 items-center justify-between gap-3 px-4", className)}>
      <Heading className="label-caps min-w-0 truncate">
        {title}
        {typeof count === "number" ? <span className="ml-1.5 tabular-nums">{count}</span> : null}
      </Heading>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}
