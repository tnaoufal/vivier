/**
 * The team's own labels on a profile, in the aside: quiet chips, and for
 * a member a pencil that turns them into the chip editor in place (the
 * remove marks show only then). Tags are the team's, not the CV's, so an
 * empty list reads "none", never "not stated".
 */
import { useState } from "react";
import { Check, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

import { ChipEditor, Chip } from "./chip-editor";

export function TagsCard({
  tags,
  canEdit,
  onChange,
}: {
  tags: string[];
  canEdit: boolean;
  onChange: (values: string[]) => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <section className="sheet p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{t("candidates.field.tags")}</h2>
        {canEdit ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            icon={editing ? <Check /> : <Pencil />}
            onClick={() => setEditing((value) => !value)}
            aria-label={editing ? t("candidates.skills.done") : t("candidates.tags.edit")}
            aria-pressed={editing}
            className="-my-1 text-muted-foreground hover:text-ink"
          />
        ) : null}
      </div>
      {editing ? (
        <ChipEditor
          values={tags}
          canEdit
          placeholder={t("candidates.tags.placeholder")}
          tone="primary"
          onChange={onChange}
        />
      ) : tags.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag} className="min-w-0">
              <Chip tone="primary">{tag}</Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("common.none")}</p>
      )}
    </section>
  );
}
