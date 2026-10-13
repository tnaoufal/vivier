/**
 * Second step of the share dialog: every sheet of the presentation,
 * editable (headline, summary, strengths, points of attention), with a
 * sentence saying where the words come from and that the person sending
 * them answers for them. "Create the link" stores the share.
 */
import { FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { canCreate, type DialogAction, type DialogState } from "@/lib/shares/dialog-state";
import { HEADLINE_MAX, SUMMARY_MAX } from "@/lib/shares/draft";

import { PointsEditor } from "./points-editor";

export function ReviewStep({
  state,
  dispatch,
  onBack,
  onCreate,
}: {
  state: DialogState;
  dispatch: (action: DialogAction) => void;
  onBack: () => void;
  onCreate: () => void;
}) {
  const t = useT();
  const busy = state.busy;
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-muted px-4 py-3 text-sm text-ink">
        <p>{state.modelUsed ? t("shares.review.modelDrafted") : t("shares.review.fromProfiles")}</p>
        {state.modelFailed ? <p className="mt-1 text-caution-foreground dark:text-caution">{t("shares.review.modelFailed")}</p> : null}
        <p className="mt-1 text-muted-foreground">{t("shares.review.responsibility")}</p>
      </div>

      {state.items.length ? (
        <ol className="space-y-4">
          {state.items.map((item, index) => {
            const id = `share-item-${index}`;
            return (
              <li key={`${item.candidateId}-${index}`} className="sheet space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base text-ink">
                    <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                    {item.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
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
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-headline`}>{t("shares.review.headline")}</Label>
                  <Input
                    id={`${id}-headline`}
                    value={item.headline ?? ""}
                    maxLength={HEADLINE_MAX}
                    disabled={busy}
                    onChange={(event) => dispatch({ type: "setItemHeadline", index, headline: event.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-summary`}>{t("shares.review.summary")}</Label>
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
                <div className="grid gap-4 sm:grid-cols-2">
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          {t("common.back")}
        </Button>
        <Button type="button" onClick={onCreate} disabled={!canCreate(state)}>
          {busy ? t("common.loading") : t("shares.review.create")}
        </Button>
      </DialogFooter>
    </div>
  );
}
