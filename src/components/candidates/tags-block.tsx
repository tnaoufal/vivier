/**
 * The team's own labels on a profile: quiet chips, and for a member a
 * pencil that turns them into the chip editor in place (the remove
 * marks show only then). Tags are the team's, not the CV's, so an empty
 * list reads "none", never "not stated".
 */
import { useState } from "react";
import { Check, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

import { Block, type BlockHeading } from "./block";
import { Chip, ChipEditor } from "./chip-editor";

export function TagsBlock({
  tags,
  canEdit,
  as,
  onChange,
}: {
  tags: string[];
  canEdit: boolean;
  as: BlockHeading;
  onChange: (values: string[]) => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <Block
      as={as}
      title={t("candidates.field.tags")}
      action={
        canEdit ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            icon={editing ? <Check /> : <Pencil />}
            onClick={() => setEditing((value) => !value)}
            aria-label={editing ? t("candidates.skills.done") : t("candidates.tags.edit")}
            aria-pressed={editing}
            className="text-muted-foreground hover:text-ink"
          />
        ) : null
      }
    >
      {editing ? (
        <ChipEditor
          values={tags}
          canEdit
          placeholder={t("candidates.tags.placeholder")}
          onChange={onChange}
        />
      ) : tags.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag} className="min-w-0">
              <Chip>{tag}</Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("common.none")}</p>
      )}
    </Block>
  );
}
