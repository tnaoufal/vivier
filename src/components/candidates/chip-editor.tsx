/**
 * Skills and tags as chips a member adds to and removes from in place;
 * each change is saved at once by the parent (one column). Typing
 * "a, b" adds two chips.
 */
import { useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addChips, removeChip } from "@/lib/candidates/draft";
import { useT } from "@/lib/i18n";

export function ChipEditor({
  values,
  canEdit,
  placeholder,
  tone = "primary",
  emptyKey = "common.none",
  onChange,
}: {
  values: string[];
  canEdit: boolean;
  placeholder: string;
  tone?: "primary" | "neutral";
  /** What an empty list says: "none" for the team's own tags, "not stated" for what a CV did not say. */
  emptyKey?: "common.none" | "common.unknown";
  onChange: (values: string[]) => Promise<void>;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(next: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const next = addChips(values, typed);
    if (next.length === values.length) {
      setTyped("");
      return;
    }
    await save(next);
    setTyped("");
  }

  const chipClass =
    tone === "primary"
      ? "bg-primary/12 text-primary"
      : "bg-muted text-muted-foreground";

  return (
    <div className="space-y-2">
      {values.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className={`inline-flex h-7 items-center gap-1 rounded-full pl-2.5 pr-1.5 text-xs font-medium ${chipClass}`}
            >
              <span>{value}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void save(removeChip(values, value))}
                  disabled={busy}
                  aria-label={t("candidates.chips.remove", { value })}
                  title={t("candidates.chips.remove", { value })}
                  className="rounded-full p-0.5 hover:bg-background/60 disabled:opacity-50"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>
      )}
      {canEdit ? (
        <form onSubmit={(event) => void add(event)} className="flex gap-2">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={placeholder}
            maxLength={200}
            disabled={busy}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !typed.trim()}>
            {t("common.add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
