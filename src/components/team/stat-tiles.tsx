/**
 * The dashboard's four numbers. A count that could not be read shows a
 * dash with the reason on hover, never a zero that would look like a
 * fact.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";

export function StatTile({
  label,
  value,
  icon,
  to,
  loading,
}: {
  label: string;
  value: number | null;
  icon: ReactNode;
  /** A path the tile opens; a plain string so routes of other areas need no literal here. */
  to?: string;
  loading: boolean;
}) {
  const t = useT();
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps">{label}</span>
        <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <span
          className="mt-1 block font-display text-3xl text-ink"
          title={value === null ? t("dashboard.statsUnread") : undefined}
        >
          {value === null ? "—" : value.toLocaleString()}
        </span>
      )}
    </>
  );
  const className = "sheet block p-4 transition-colors";
  if (to) {
    return (
      <Link to={to} className={`${className} hover:bg-accent/40`}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}
