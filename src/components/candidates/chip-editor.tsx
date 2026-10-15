/**
 * Skills and tags as chips. `Chip` is the quiet chip the sheet reads
 * (grey 100, ink text, no remove mark); `ChipEditor` adds the remove
 * mark on each and a line to type more, each change saved at once by
 * the parent (one column). Typing "a, b" adds two chips. One height
 * (28px) in both modes, so a skill does not grow when the sheet enters
 * edit mode: the editable chip only trades its right padding for the
 * remove mark.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addChips, removeChip } from "@/lib/candidates/draft";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The one content chip: 28px, 13px text, read on the sheet and in the editor alike. */
const CHIP_BASE =
  "inline-flex h-7 max-w-full items-center rounded-full bg-muted text-meta font-medium text-ink";

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn(CHIP_BASE, "px-2.5", className)}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function ChipEditor({
  values,
  canEdit,
  placeholder,
  emptyKey = "common.none",
  onChange,
}: {
  values: string[];
  canEdit: boolean;
  placeholder: string;
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

  return (
    <div className="space-y-3">
      {values.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className={cn(CHIP_BASE, "gap-0.5 pl-2.5", canEdit ? "pr-1" : "pr-2.5")}
            >
              <span className="min-w-0 truncate">{value}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void save(removeChip(values, value))}
                  disabled={busy}
                  aria-label={t("candidates.chips.remove", { value })}
                  title={t("candidates.chips.remove", { value })}
                  className="press inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
            aria-label={placeholder}
            className="min-w-0 flex-1 basis-48"
          />
          <Button type="submit" variant="outline" icon={<Plus />} disabled={busy || !typed.trim()}>
            {t("common.add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
