/**
 * A number of the dashboard (and of the team page): a muted label, the
 * count in the display face with digits that line up, the icon in a
 * tinted disc. A tile that links to a page tints on hover. A count that
 * could not be read shows a dash with the reason on hover, never a zero
 * that would look like a fact. A tile that follows work in progress may
 * draw a thin bar under its number (`progress`: done out of total).
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  icon,
  to,
  loading,
  progress,
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
  className?: string;
}) {
  const t = useT();
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.max(0, Math.round((100 * progress.done) / progress.total)))
      : 0;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="label-caps min-w-0 truncate">{label}</span>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-20" />
      ) : (
        <span className="stat-number mt-3 block text-ink" title={value === null ? t("dashboard.statsUnread") : undefined}>
          {value === null ? "—" : value.toLocaleString()}
        </span>
      )}
      {!loading && progress && progress.total > 0 ? (
        <div
          role="progressbar"
          aria-label={t("shell.stat.progress", { done: progress.done, total: progress.total })}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out-soft"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </>
  );
  const base = cn("sheet block min-w-0 p-6", className);
  if (to) {
    return (
      <Link to={to} className={cn(base, "sheet-link")}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

/** Four tiles from `lg`, two on anything narrower. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4", className)}>{children}</div>;
}
