/**
 * One result of a search: who, the score over what could be evaluated,
 * one chip per criterion coloured by its verdict with the evidence as
 * its title, the model's reading when one answered, and the way to the
 * shortlist. A missing required criterion is said, never hidden; a
 * criterion the CV says nothing about reads "not stated".
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ListPlus } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { evaluatedCount } from "@/lib/briefs/matching";
import { candidatePath, shortlistPath } from "@/lib/briefs/paths";
import type { ResultCandidate } from "@/lib/briefs/queries";
import type { BriefCriterion, CriterionVerdict, MatchResult } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

const VERDICT_TONES: Record<CriterionVerdict, PillTone> = {
  match: "positive",
  partial: "caution",
  missing: "negative",
  not_stated: "neutral",
};

const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ScoreRing({ score, label }: { score: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="relative size-14 shrink-0" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 48 48" className="size-14 -rotate-90">
        <circle cx="24" cy="24" r={RING_RADIUS} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="24"
          cy="24"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * RING_LENGTH} ${RING_LENGTH}`}
          className="stroke-primary"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-sm text-ink">{clamped}</span>
    </div>
  );
}

export function ResultCard({
  result,
  criteria,
  candidate,
  shortlistId,
  added,
  canEdit,
  onAdd,
}: {
  result: MatchResult;
  /** The criteria of the search, in the order its chips follow. */
  criteria: BriefCriterion[];
  /** Null when the candidate was erased since the search. */
  candidate: ResultCandidate | null;
  shortlistId: string | null;
  added: boolean;
  canEdit: boolean;
  onAdd: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const name = candidate ? candidate.full_name?.trim() || t("briefs.results.noName") : t("briefs.results.gone");
  const line = candidate ? [candidate.headline, candidate.location].filter((part) => part && part.trim()).join(" · ") : "";
  const verdicts = new Map(result.verdicts.map((verdict) => [verdict.criterionId, verdict] as const));
  const evaluated = evaluatedCount(result.verdicts);
  const scoreLabel = t("briefs.results.score", { score: result.score });

  async function add() {
    if (busy) return;
    setBusy(true);
    try {
      await onAdd();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="sheet space-y-3 p-4">
      <div className="flex gap-3">
        <Avatar name={name} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {candidate ? (
              <Link to={candidatePath(candidate.id)} className="truncate font-medium text-ink hover:underline">
                {name}
              </Link>
            ) : (
              <span className="truncate font-medium text-muted-foreground">{name}</span>
            )}
            {candidate?.status === "archived" ? <Pill>{t("briefs.results.archived")}</Pill> : null}
            {result.blocked ? <Pill tone="negative">{t("briefs.results.blocked")}</Pill> : null}
          </div>
          <p className="truncate text-sm text-muted-foreground">{line || (candidate ? t("common.unknown") : t("briefs.results.goneText"))}</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={result.score} label={scoreLabel} />
          <span className="text-center text-[11px] leading-tight text-muted-foreground">
            {t("briefs.results.coverage", { evaluated, total: criteria.length })}
          </span>
        </div>
      </div>

      {criteria.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {criteria.map((criterion) => {
            const verdict = verdicts.get(criterion.id);
            if (!verdict) return null;
            const title = verdict.evidence
              ? t("briefs.verdict.evidence", { evidence: verdict.evidence })
              : t(`briefs.verdict.${verdict.verdict}`);
            return (
              <li key={criterion.id}>
                <Pill tone={VERDICT_TONES[verdict.verdict]} title={title}>
                  {criterion.label}
                  {verdict.verdict === "not_stated" ? ` · ${t("briefs.verdict.not_stated")}` : ""}
                </Pill>
              </li>
            );
          })}
        </ul>
      ) : null}

      {result.why ? (
        <div className="rounded-2xl bg-muted/60 px-3 py-2">
          <span className="label-caps">{t("briefs.results.why")}</span>
          <p className="mt-1 text-sm text-ink">{result.why}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {added && shortlistId ? (
          <Button asChild variant="outline" size="sm">
            <Link to={shortlistPath(shortlistId)} className="gap-1.5">
              <ListPlus />
              {t("briefs.results.seeShortlist")}
            </Link>
          </Button>
        ) : canEdit && candidate ? (
          <Button type="button" size="sm" onClick={() => void add()} disabled={busy} className="gap-1.5">
            <ListPlus />
            {t("briefs.results.addToShortlist")}
          </Button>
        ) : null}
        {candidate ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={candidatePath(candidate.id)} className="gap-1.5">
              <ExternalLink />
              {t("briefs.results.openCandidate")}
            </Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
