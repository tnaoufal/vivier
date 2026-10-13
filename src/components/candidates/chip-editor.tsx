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
import { cn } from "@/lib/utils";

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

  const chipClass = tone === "primary" ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground";

  return (
    <div className="space-y-3">
      {values.length ? (
        <ul className="flex flex-wrap gap-2">
          {values.map((value) => (
            <li
              key={value}
              className={cn("inline-flex h-8 max-w-full items-center gap-1 rounded-full pl-3 text-[13px] font-medium", canEdit ? "pr-1.5" : "pr-3", chipClass)}
            >
              <span className="truncate">{value}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void save(removeChip(values, value))}
                  disabled={busy}
                  aria-label={t("candidates.chips.remove", { value })}
                  title={t("candidates.chips.remove", { value })}
                  className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-card/70 disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>
      )}
      {canEdit ? (
        <form onSubmit={(event) => void add(event)} className="flex flex-wrap gap-2">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={placeholder}
            maxLength={200}
            disabled={busy}
            className="min-w-0 flex-1 basis-48"
          />
          <Button type="submit" variant="outline" disabled={busy || !typed.trim()}>
            {t("common.add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
