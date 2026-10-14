/**
 * A number of the dashboard (and of the team page): a muted label (two
 * lines at most, never cut short: it is what says what the number is),
 * the count in the display face with digits that line up, the icon in a
 * tinted disc from `sm` (on a phone the half-width tile leaves the label
 * its room). A tile that links to a page lifts on hover. A count that
 * could not be read shows a dash with the reason on hover and, for
 * assistive technologies, as the text in its place; never a zero that
 * would look like a fact. A tile that follows work in progress
 * draws a thin bar under its number (`progress`: done out of total);
 * `hint` is one short sentence under the number (a trend, a period).
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { ProgressBar } from "./progress-bar";

export function StatTile({
  label,
  value,
  icon,
  to,
  loading,
  progress,
  hint,
  className,
}: {
  label: string;
  value: number | null;
  icon: ReactNode;
  /** A path the tile opens; a plain string so routes of other areas need no literal here. */
  to?: string;
  loading: boolean;
  /** Work in progress behind the number: a 4px bar, done out of total, under it. */
  progress?: { done: number; total: number } | undefined;
  /** One short line under the number. */
  hint?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="label-caps min-w-0 line-clamp-2">{label}</span>
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex [&_svg]:size-5">
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-20" />
      ) : (
        <span
          className="stat-number mt-3 block text-ink"
          title={value === null ? t("dashboard.statsUnread") : undefined}
        >
          {value === null ? (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">{t("dashboard.statsUnread")}</span>
            </>
          ) : (
            value.toLocaleString()
          )}
        </span>
      )}
      {!loading && hint ? (
        <span className="mt-1 block text-meta text-muted-foreground">{hint}</span>
      ) : null}
      {!loading && progress && progress.total > 0 ? (
        <ProgressBar
          className="mt-3"
          value={progress.done}
          max={progress.total}
          active={progress.done < progress.total}
          label={t("shell.stat.progress", { done: progress.done, total: progress.total })}
        />
      ) : null}
    </>
  );
  const base = cn("sheet rise-in block min-w-0 p-6", className);
  if (to) {
    return (
      <Link to={to} className={cn(base, "sheet-link")}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

/** Four tiles from `lg`, two on anything narrower; the tiles rise in one after the other. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("stagger grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}
