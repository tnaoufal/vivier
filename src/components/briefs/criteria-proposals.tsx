/**
 * Criteria the model proposes from the brief's text, shown as chips the
 * person adds one by one or all at once: the model proposes, the person
 * validates, and nothing reaches the brief without their gesture.
 * Without a model, one sentence says so and the criteria are typed in.
 */
import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { extractCriteria } from "@/lib/briefs/briefs.functions";
import { kindKey } from "@/lib/briefs/criteria";
import type { BriefCriterion } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/server/call";
import { toast } from "@/lib/toast";

/** Null while unknown, then whether a model is set up on this deployment. */
export type ModelAvailability = boolean | null;

export function CriteriaProposals({
  orgId,
  briefId,
  modelAvailable,
  disabled = false,
  onAdd,
}: {
  orgId: string;
  briefId: string;
  /** Null while unknown, then whether a model is set up. */
  modelAvailable: ModelAvailability;
  disabled?: boolean;
  /** Called with the proposals the person accepted; answers how many were new. */
  onAdd: (criteria: BriefCriterion[]) => number;
}) {
  const { t, locale } = useI18n();
  const [proposals, setProposals] = useState<BriefCriterion[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dropped, setDropped] = useState(0);
  const [busy, setBusy] = useState(false);

  async function propose() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const answer = await extractCriteria({ data: { ...(await withToken()), orgId, briefId } });
      setProposals(answer.criteria);
      setWarnings(answer.warnings);
      setDropped(answer.dropped);
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setBusy(false);
    }
  }

  function accept(items: BriefCriterion[]) {
    const added = onAdd(items);
    const ids = new Set(items.map((item) => item.id));
    setProposals((current) => (current ?? []).filter((item) => !ids.has(item.id)));
    if (added === 0) toast(t("briefs.proposals.duplicate"));
  }

  if (modelAvailable === null) return null;
  if (modelAvailable === false) {
    return <p className="text-sm text-muted-foreground">{t("briefs.proposals.noModel")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void propose()} disabled={busy || disabled} className="gap-1.5">
          <Sparkles />
          {busy ? t("briefs.proposals.busy") : proposals ? t("briefs.proposals.again") : t("briefs.proposals.button")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("briefs.proposals.help")}</span>
      </div>
      {proposals ? (
        <div className="rounded-2xl border border-dashed border-border p-3">
          {proposals.length ? (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="label-caps">{t("briefs.proposals.title")}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => accept(proposals)} disabled={disabled}>
                  {t("briefs.proposals.addAll")}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {proposals.map((proposal) => (
                  <li key={proposal.id}>
                    <button
                      type="button"
                      onClick={() => accept([proposal])}
                      disabled={disabled}
                      title={`${t(kindKey(proposal.kind))} · ${proposal.value}`}
                      aria-label={t("briefs.proposals.add", { label: proposal.label })}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/12 pl-2.5 pr-2 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      <span>{proposal.label}</span>
                      {proposal.required ? <span className="text-[10px] uppercase opacity-70">{t("common.required")}</span> : null}
                      <Plus className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("briefs.proposals.none")}</p>
          )}
          {warnings.length || dropped > 0 ? (
            <div className="mt-3 space-y-1 text-xs text-caution-foreground dark:text-caution">
              {dropped > 0 ? <p>{t("briefs.proposals.dropped", { count: dropped })}</p> : null}
              {warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
