/**
 * The criteria of a brief as rows (criterion-row.tsx), with the model's
 * proposals above them (criteria-proposals.tsx). Rows are edited
 * locally and saved together to briefs.criteria; a row without a label
 * or a value is not saved. The parent learns when there are unsaved
 * changes, because a search reads the saved brief.
 */
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { cleanCriteria, CRITERIA_MAX, emptyCriterion, hasSimilar, isComplete, sameCriteria } from "@/lib/briefs/criteria";
import { updateBrief } from "@/lib/briefs/queries";
import type { BriefCriterion, BriefRow } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";

import { CriteriaProposals, type ModelAvailability } from "./criteria-proposals";
import { CriterionRow } from "./criterion-row";

export function CriteriaEditor({
  brief,
  canEdit,
  modelAvailable,
  onSaved,
  onDirtyChange,
}: {
  brief: BriefRow;
  canEdit: boolean;
  modelAvailable: ModelAvailability;
  onSaved: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<BriefCriterion[]>(brief.criteria);
  const [busy, setBusy] = useState(false);

  const dirty = !sameCriteria(cleanCriteria(rows), brief.criteria);
  const incomplete = rows.some((row) => !isComplete(row));

  // A fresh row from the database (saved here or by a colleague) replaces
  // the rows only while they still equal what was last read: local edits stay.
  const seen = useRef(brief.criteria);
  useEffect(() => {
    const previous = seen.current;
    seen.current = brief.criteria;
    setRows((current) => (sameCriteria(cleanCriteria(current), previous) ? brief.criteria : current));
  }, [brief.criteria]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function update(next: BriefCriterion) {
    setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
  }

  function remove(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function addRow() {
    setRows((current) => (current.length >= CRITERIA_MAX ? current : [...current, emptyCriterion()]));
  }

  /** Appends the proposals not already there (same kind and value); answers how many were added. */
  function addProposals(proposals: BriefCriterion[]): number {
    const next = [...rows];
    let added = 0;
    for (const proposal of proposals) {
      if (next.length >= CRITERIA_MAX) break;
      if (hasSimilar(next, proposal)) continue;
      next.push(proposal);
      added += 1;
    }
    if (added > 0) setRows(next);
    return added;
  }

  async function save() {
    if (!canEdit || busy || !dirty) return;
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      const criteria = cleanCriteria(rows);
      await updateBrief(supabase, brief.org_id, brief.id, { criteria });
      setRows(criteria);
      toast.success(t("briefs.criteria.saved"));
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet space-y-6 p-6">
      <div>
        <h2 className="font-display text-xl text-ink">{t("briefs.criteria.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("briefs.criteria.help")}</p>
      </div>
      {canEdit ? (
        <CriteriaProposals orgId={brief.org_id} briefId={brief.id} modelAvailable={modelAvailable} disabled={busy} onAdd={addProposals} />
      ) : null}
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="py-4 first:pt-0 last:pb-0">
              <CriterionRow criterion={row} canEdit={canEdit} disabled={busy} onChange={update} onRemove={() => remove(row.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
          {t("briefs.criteria.empty")}
        </p>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={busy || rows.length >= CRITERIA_MAX} className="gap-1">
            <Plus />
            {t("briefs.criteria.add")}
          </Button>
          <div className="flex items-center gap-3">
            {incomplete ? <span className="text-[13px] text-muted-foreground">{t("briefs.criteria.incomplete")}</span> : null}
            <Button type="button" variant="outline" onClick={() => void save()} disabled={busy || !dirty}>
              {t("briefs.criteria.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
