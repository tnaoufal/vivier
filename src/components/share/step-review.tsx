/**
 * Second step of the share dialog: every sheet of the dossier, with the
 * assessment the shortlist holds read only (the score, the reading, the
 * requirement table with its evidence) and the prose editable (headline,
 * synthesis, strengths, points of attention), after a sentence saying
 * where the words come from and that the person sending them answers
 * for them. "Create the link" stores the share; it sits in a footer of
 * its own that the dialog keeps below the scrolling sheets, so the
 * primary action never hides at the end of thirty of them.
 */
import { FileText, Trash2 } from "lucide-react";

import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ShareItem } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { canCreate, type DialogAction, type DialogState } from "@/lib/shares/dialog-state";
import { HEADLINE_MAX, SUMMARY_MAX } from "@/lib/shares/draft";

import { DecisionPill, factsLine, metLabel, metSentence, requirementRowsOf, scoreLabel, type Translate } from "./assessment-bits";
import { PointsEditor } from "./points-editor";
import { FIELD_LABEL } from "./field-label";

/** The read-only block of a sheet: the ring, the reading, the count, then the table. */
function AssessmentBlock({ item, t }: { item: ShareItem; t: Translate }) {
  const rows = requirementRowsOf(item);
  return (
    <section className="space-y-3 rounded-xl border border-border px-4 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={item.score} label={scoreLabel(t, item.score)} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={FIELD_LABEL}>{t("shares.review.assessment")}</span>
            <DecisionPill decision={item.decision} t={t} />
          </div>
          <p className="text-[13px] leading-5 text-muted-foreground">{t("shares.review.assessment.help")}</p>
          <p className="text-sm tabular-nums text-ink">{metSentence(t, item)}</p>
        </div>
      </div>
      {rows.length ? (
        <RequirementList rows={rows} markLabel={(met) => metLabel(t, met)} requiredLabel={t("shares.required")} compact />
      ) : (
        <p className="text-sm text-muted-foreground">{t("shares.review.noAssessment")}</p>
      )}
    </section>
  );
}

export function ReviewStep({ state, dispatch }: { state: DialogState; dispatch: (action: DialogAction) => void }) {
  const t = useT();
  const busy = state.busy;
  const brief = state.brief;
  return (
    <div className="space-y-6">
      <div className="space-y-1 rounded-xl bg-muted/50 px-4 py-3 text-sm text-ink">
        <p>{state.modelUsed ? t("shares.review.modelDrafted") : t("shares.review.fromProfiles")}</p>
        {state.modelFailed ? <p className="text-caution-foreground dark:text-caution">{t("shares.review.modelFailed")}</p> : null}
        <p className="text-muted-foreground">{t("shares.review.responsibility")}</p>
      </div>

      {brief ? (
        <div className="space-y-1">
          <p className={FIELD_LABEL}>{t("shares.review.brief")}</p>
          <p className="min-w-0 truncate text-sm text-ink">
            {brief.requirements.length
              ? t("shares.review.brief.line", { title: brief.title, count: brief.requirements.length })
              : brief.title}
          </p>
          {!brief.requirements.length ? <p className="text-[13px] text-muted-foreground">{t("shares.review.brief.none")}</p> : null}
        </div>
      ) : null}

      {state.items.length ? (
        <ol className="space-y-6">
          {state.items.map((item, index) => {
            const id = `share-item-${index}`;
            return (
              <li key={`${item.candidateId}-${index}`} className="sheet space-y-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-base text-ink">
                      <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                      {item.name}
                    </h3>
                    <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{factsLine(t, item)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
                      <FileText className="size-3.5" />
                      {item.documentId && state.includeCvs ? t("shares.review.cvIncluded") : t("shares.review.noCv")}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => dispatch({ type: "removeItem", index })}
                      aria-label={t("shares.review.removeItem")}
                      title={t("shares.review.removeItem")}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <AssessmentBlock item={item} t={t} />

                <div className="space-y-2">
                  <Label htmlFor={`${id}-headline`} className={FIELD_LABEL}>
                    {t("shares.review.headline")}
                  </Label>
                  <Input
                    id={`${id}-headline`}
                    value={item.headline ?? ""}
                    maxLength={HEADLINE_MAX}
                    disabled={busy}
                    onChange={(event) => dispatch({ type: "setItemHeadline", index, headline: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-summary`} className={FIELD_LABEL}>
                    {t("shares.review.summary")}
                  </Label>
                  <Textarea
                    id={`${id}-summary`}
                    value={item.summary}
                    maxLength={SUMMARY_MAX}
                    rows={4}
                    disabled={busy}
                    placeholder={t("shares.review.summary.placeholder")}
                    onChange={(event) => dispatch({ type: "setItemSummary", index, summary: event.target.value })}
                  />
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <PointsEditor
                    id={`${id}-strength`}
                    label={t("shares.review.strengths")}
                    points={item.strengths}
                    disabled={busy}
                    onChange={(at, value) => dispatch({ type: "setPoint", index, field: "strengths", at, value })}
                    onAdd={() => dispatch({ type: "addPoint", index, field: "strengths" })}
                    onRemove={(at) => dispatch({ type: "removePoint", index, field: "strengths", at })}
                  />
                  <PointsEditor
                    id={`${id}-attention`}
                    label={t("shares.review.attention")}
                    points={item.attention}
                    disabled={busy}
                    onChange={(at, value) => dispatch({ type: "setPoint", index, field: "attention", at, value })}
                    onAdd={() => dispatch({ type: "addPoint", index, field: "attention" })}
                    onRemove={(at) => dispatch({ type: "removePoint", index, field: "attention", at })}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t("shares.review.empty")}</p>
      )}
    </div>
  );
}

/** Back to the content, or create the link: rendered by the dialog under the scrolling box. */
export function ReviewFooter({ state, onBack, onCreate }: { state: DialogState; onBack: () => void; onCreate: () => void }) {
  const t = useT();
  return (
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" onClick={onBack} disabled={state.busy}>
        {t("common.back")}
      </Button>
      <Button type="button" onClick={onCreate} disabled={!canCreate(state)}>
        {state.busy ? t("common.loading") : t("shares.review.create")}
      </Button>
    </DialogFooter>
  );
}
