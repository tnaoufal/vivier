/**
 * Shimmering placeholders while a read runs: `Skeleton` is one block the
 * size of the text or shape it stands for; `SkeletonRows` is the list
 * every page shows before its rows arrive (an avatar disc, two lines,
 * a short value on the right), so loading looks the same everywhere.
 * Never a spinner alone on a blank page.
 */
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-sm", className)} {...props} />;
}

function SkeletonRows({
  rows = 4,
  avatar = true,
  className,
}: {
  rows?: number;
  /** A disc at the start of each row (a person, a document); off for plain rows. */
  avatar?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border", className)} aria-busy="true" aria-hidden="true">
      {Array.from({ length: Math.max(1, rows) }, (_, index) => (
        <li key={index} className="flex items-center gap-4 px-4 py-4 sm:px-6">
          {avatar ? <Skeleton className="size-10 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3 max-w-48" />
            <Skeleton className="h-3 w-2/3 max-w-80" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export { Skeleton, SkeletonRows };
