/**
 * The progress of an analysis the browser drives batch by batch: one
 * line with the count, a thin bar, and the way to interrupt it (what is
 * already assessed stays stored; "resume" picks up the rest).
 */
import { Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function AssessmentProgress({ done, total, onStop }: { done: number; total: number; onStop: () => void }) {
  const t = useT();
  const percent = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {t("briefs.search.progress", { done, total })}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onStop} className="gap-1.5">
          <Square />
          {t("briefs.search.stop")}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label={t("briefs.search.progress.label")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
