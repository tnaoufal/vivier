/**
 * A number of the dashboard (and of the team page): a muted label, the
 * count in the display face with digits that line up, the icon in a
 * tinted disc. A tile that links to a page tints on hover. A count that
 * could not be read shows a dash with the reason on hover, never a zero
 * that would look like a fact.
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
  className,
}: {
  label: string;
  value: number | null;
  icon: ReactNode;
  /** A path the tile opens; a plain string so routes of other areas need no literal here. */
  to?: string;
  loading: boolean;
  className?: string;
}) {
  const t = useT();
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
