/**
 * An on/off control for a setting that saves at once (the candidates'
 * photos): a 44 × 24 track, a thumb that slides over 180ms through the
 * motion tokens, the accent when on. It is a button with the `switch`
 * role, so a screen reader hears "on" or "off"; the caller names it
 * with `aria-labelledby` (the visible label) and may point at the help
 * sentence with `aria-describedby`.
 */
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className,
  ...aria
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string | undefined;
  className?: string;
  "aria-labelledby"?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-label"?: string | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={aria["aria-labelledby"]}
      aria-describedby={aria["aria-describedby"]}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "press relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-base ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-ink/20",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-card shadow-raised transition-transform duration-base ease-out-soft",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
