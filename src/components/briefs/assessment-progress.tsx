/**
 * The progress of an analysis the browser drives batch by batch, in
 * three stages (the reading of the profiles, the second opinion on the
 * retained ones, the tiering of the retained and borderline ones): the
 * stage's name with how far it is, the shared ProgressBar with its
 * sheen while the work runs, and the way to interrupt it (what is
 * already stored stays; "resume" picks up the missing stages).
 */
import { Square } from "lucide-react";

import { ProgressBar } from "@/components/app-shell/progress-bar";
import { Button } from "@/components/ui/button";
import type { AnalysisStage } from "@/lib/briefs/stages";
import { useT } from "@/lib/i18n";

export function AssessmentProgress({
  stage,
  done,
  total,
  onStop,
}: {
  stage: AnalysisStage;
  done: number;
  total: number;
  onStop: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-ink" aria-live="polite">
          <span className="font-medium">{t(`briefs.search.stage.${stage}`)}</span>
          <span className="ml-2 text-muted-foreground tabular-nums">
            {t("briefs.search.stage.count", { done, total })}
          </span>
        </p>
        <Button type="button" variant="outline" size="sm" icon={<Square />} onClick={onStop}>
          {t("briefs.search.stop")}
        </Button>
      </div>
      <ProgressBar
        value={done}
        max={total}
        size="md"
        active
        label={t(`briefs.search.progress.${stage}`, { done, total })}
      />
    </div>
  );
}
