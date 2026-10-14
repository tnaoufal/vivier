/**
 * Second step of the share dialog: every sheet of the dossier, folded
 * to what tells sheets apart (the person, the score, the reading, how
 * many requirements are met, whether a CV goes with it, the first line
 * of the synthesis) and opened on demand to edit the prose (headline,
 * synthesis, strengths, points of attention, the points the interview
 * should verify) under the assessment read only (the requirement table
 * with its evidence). A sentence says where the words come from and
 * that the person sending them answers for them. "Create the link"
 * stores the share; it sits in a footer of its own that the dialog
 * keeps below the scrolling sheets.
 */
import { useState } from "react";
import { ChevronDown, FileText, Trash2 } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { RequirementList } from "@/components/app-shell/requirement-list";
import { ScoreRing } from "@/components/app-shell/score-ring";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ShareItem } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { canCreate, previewOf, type DialogAction, type DialogState } from "@/lib/shares/dialog-state";
import { HEADLINE_MAX, QUESTIONS_MAX, SUMMARY_MAX } from "@/lib/shares/draft";
import { cn } from "@/lib/utils";

import {
  DecisionPill,
  factsLine,
  metLabel,
  metSentence,
  requirementRowsOf,
  scoreLabel,
  type Translate,
} from "./assessment-bits";
import { PointsEditor } from "./points-editor";

/** The read-only block of a sheet: the table of requirements with its evidence, or the sentence that there is none. */
function AssessmentBlock({ item, t }: { item: ShareItem; t: Translate }) {
  const rows = requirementRowsOf(item);
  return (
    <section className="space-y-2">
      <div>
        <Label>{t("shares.review.assessment")}</Label>
        <p className="text-meta text-muted-foreground">{t("shares.review.assessment.help")}</p>
      </div>
      {rows.length ? (
        <RequirementList
          rows={rows}
          markLabel={(met) => metLabel(t, met)}
          requiredLabel={t("shares.required")}
          compact
          className="rounded-lg border border-border px-4"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("shares.review.noAssessment")}</p>
      )}
    </section>
  );
}

function SheetCard({
  item,
  index,
  open,
  onToggle,
  busy,
  includeCvs,
  dispatch,
}: {
  item: ShareItem;
  index: number;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  includeCvs: boolean;
  dispatch: (action: DialogAction) => void;
}) {
  const t = useT();
  const id = `share-item-${index}`;
  const preview = previewOf(item.summary);
  return (
    <div className="sheet">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <Avatar name={item.name} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-ink">
            <span className="mr-1.5 text-muted-foreground tabular-nums">{index + 1}.</span>
            {item.name}
          </h3>
          <p className="truncate text-meta text-muted-foreground">{item.headline?.trim() || factsLine(t, item)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <DecisionPill decision={item.decision} t={t} />
            <span className="text-meta text-muted-foreground tabular-nums">{metSentence(t, item)}</span>
            <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
              <FileText className="size-3.5" aria-hidden="true" />
              {item.documentId && includeCvs ? t("shares.review.cvIncluded") : t("shares.review.noCv")}
            </span>
          </div>
          {!open ? (
            <p className={cn("mt-2 line-clamp-2 text-sm", preview ? "text-ink/85" : "text-muted-foreground")}>
              {preview || t("shares.review.summary.empty")}
            </p>
          ) : null}
        </div>
        <ScoreRing score={item.score} label={scoreLabel(t, item.score)} size="sm" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => dispatch({ type: "removeItem", index })}
          aria-label={t("shares.review.removeItem")}
          title={t("shares.review.removeItem")}
          className="-mr-2 -mt-1 text-muted-foreground hover:text-negative"
        >
          <Trash2 />
        </Button>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-fields`}
        className="press flex h-10 w-full cursor-pointer items-center gap-2 border-t border-border px-4 text-meta font-medium text-primary hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
      >
        <ChevronDown
          className={cn("size-4 transition-transform duration-base ease-out-soft", open ? "rotate-180" : "")}
          aria-hidden="true"
        />
        {open ? t("shares.review.collapse") : t("shares.review.edit")}
      </button>

      {open ? (
        <div id={`${id}-fields`} className="fade-in space-y-5 border-t border-border p-4 sm:p-5">
          <AssessmentBlock item={item} t={t} />
          <div className="space-y-2">
            <Label htmlFor={`${id}-headline`}>{t("shares.review.headline")}</Label>
            <Input
              id={`${id}-headline`}
              value={item.headline ?? ""}
              maxLength={HEADLINE_MAX}
              disabled={busy}
              onChange={(event) => dispatch({ type: "setItemHeadline", index, headline: event.target.value })}
            />
          </div>
          <div className="space-y-2">
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
          <div className="grid gap-5 sm:grid-cols-2">
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
          <PointsEditor
            id={`${id}-question`}
            label={t("shares.review.questions")}
            help={t("shares.review.questions.help")}
            points={item.questions}
            max={QUESTIONS_MAX}
            disabled={busy}
            onChange={(at, value) => dispatch({ type: "setPoint", index, field: "questions", at, value })}
            onAdd={() => dispatch({ type: "addPoint", index, field: "questions" })}
            onRemove={(at) => dispatch({ type: "removePoint", index, field: "questions", at })}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ReviewStep({ state, dispatch }: { state: DialogState; dispatch: (action: DialogAction) => void }) {
  const t = useT();
  const brief = state.brief;
  // Sheets are folded until opened; the keys are candidate ids so a removal above does not open the wrong one.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (candidateId: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  const count = state.items.length;
  return (
    <div className="space-y-6">
      <div className="space-y-1 rounded-lg bg-muted/50 px-4 py-3 text-sm text-ink">
        <p>{state.modelUsed ? t("shares.review.modelDrafted") : t("shares.review.fromProfiles")}</p>
        {state.modelFailed ? (
          <p className="text-caution-foreground dark:text-caution">{t("shares.review.modelFailed")}</p>
        ) : null}
        <p className="text-muted-foreground">{t("shares.review.responsibility")}</p>
      </div>

      {brief ? (
        <div className="space-y-1">
          <Label>{t("shares.review.brief")}</Label>
          <p className="min-w-0 truncate text-sm text-ink">
            {brief.requirements.length
              ? t("shares.review.brief.line", { title: brief.title, count: brief.requirements.length })
              : brief.title}
          </p>
          {!brief.requirements.length ? (
            <p className="text-meta text-muted-foreground">{t("shares.review.brief.none")}</p>
          ) : null}
        </div>
      ) : null}

      {count ? (
        <section className="space-y-3">
          <Label>{count === 1 ? t("shares.panel.items.one") : t("shares.panel.items.many", { count })}</Label>
          <ol className="stagger space-y-4">
            {state.items.map((item, index) => (
              <li key={item.candidateId} className="rise-in">
                <SheetCard
                  item={item}
                  index={index}
                  open={opened.has(item.candidateId)}
                  onToggle={() => toggle(item.candidateId)}
                  busy={state.busy}
                  includeCvs={state.includeCvs}
                  dispatch={dispatch}
                />
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t("shares.review.empty")}</p>
      )}
    </div>
  );
}

/** Back to the content, or create the link: rendered by the dialog under the scrolling box. */
export function ReviewFooter({
  state,
  onBack,
  onCreate,
}: {
  state: DialogState;
  onBack: () => void;
  onCreate: () => void;
}) {
  const t = useT();
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onBack} disabled={state.busy}>
        {t("common.back")}
      </Button>
      <Button type="button" onClick={onCreate} disabled={!canCreate(state)}>
        {state.busy ? t("common.loading") : t("shares.review.create")}
      </Button>
    </DialogFooter>
  );
}
