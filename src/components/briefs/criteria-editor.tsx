/**
 * The criteria of a brief as rows (criterion-row.tsx), with the model's
 * proposals above them (criteria-proposals.tsx). Rows are edited
 * locally and saved together to briefs.criteria; a row without a label
 * or a value is not saved, nor is a second role (a brief is one job:
 * the row says so under itself). When the brief has a role profile, the
 * role's definition is the profile's (shown read-only, written into the
 * row on save): one source of truth, the one the team edits. The parent
 * learns when there are unsaved changes, because a search reads the
 * saved brief.
 */
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import {
  cleanCriteria,
  CRITERIA_MAX,
  emptyCriterion,
  hasSimilar,
  isComplete,
  roleCriterion,
  sameCriteria,
} from "@/lib/briefs/criteria";
import { updateBrief } from "@/lib/briefs/queries";
import { roleDefinitionOf } from "@/lib/briefs/role-profile";
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
  // The first role row is the brief's job; another one would not be saved.
  const roleId = roleCriterion(rows)?.id ?? null;
  // The role's definition follows the profile when the brief has one that names something.
  const roleDefinition = (brief.role_profile && roleDefinitionOf(brief.role_profile)) || null;

  // A fresh row from the database (saved here or by a colleague) replaces
  // the rows only while they still equal what was last read: local edits stay.
  const seen = useRef(brief.criteria);
  useEffect(() => {
    const previous = seen.current;
    seen.current = brief.criteria;
    setRows((current) =>
      sameCriteria(cleanCriteria(current), previous) ? brief.criteria : current,
    );
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
    setRows((current) =>
      current.length >= CRITERIA_MAX ? current : [...current, emptyCriterion()],
    );
  }

  /**
   * Appends the proposals not already there (same kind and value; a
   * role when the brief already has one, whatever its wording); answers
   * how many were added. A proposed role goes first, as the analysis
   * reads it.
   */
  function addProposals(proposals: BriefCriterion[]): number {
    const next = [...rows];
    let added = 0;
    for (const proposal of proposals) {
      if (next.length >= CRITERIA_MAX) break;
      if (hasSimilar(next, proposal)) continue;
      if (proposal.kind === "role") {
        if (roleCriterion(next)) continue;
        next.unshift(proposal);
      } else {
        next.push(proposal);
      }
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
      const criteria = cleanCriteria(rows).map((row) =>
        row.kind === "role" && roleDefinition ? { ...row, value: roleDefinition } : row,
      );
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
    <section className="sheet space-y-5 p-6">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">
          {t("briefs.criteria.title")}
          {rows.length ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {rows.length}
            </span>
          ) : null}
        </h2>
        <p className="mt-1 text-meta text-muted-foreground">{t("briefs.criteria.help")}</p>
      </div>
      {canEdit ? (
        <CriteriaProposals
          orgId={brief.org_id}
          briefId={brief.id}
          modelAvailable={modelAvailable}
          disabled={busy}
          onAdd={addProposals}
        />
      ) : null}
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
              <CriterionRow
                criterion={row}
                canEdit={canEdit}
                disabled={busy}
                roleDefinition={row.id === roleId ? roleDefinition : null}
                onChange={update}
                onRemove={() => remove(row.id)}
              />
              {row.kind === "role" && row.id !== roleId ? (
                <p className="text-meta text-caution-foreground dark:text-caution">
                  {t("briefs.criteria.role.duplicate")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">{t("briefs.criteria.empty")}</p>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Plus />}
            onClick={addRow}
            disabled={busy || rows.length >= CRITERIA_MAX}
          >
            {t("briefs.criteria.add")}
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {incomplete ? (
              <span className="text-meta text-muted-foreground">
                {t("briefs.criteria.incomplete")}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void save()}
              disabled={busy || !dirty}
            >
              {t("briefs.criteria.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
