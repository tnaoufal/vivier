/**
 * An on/off control for a setting that saves at once (the candidates'
 * photos), drawn like the criteria rows' switch: a 36 × 20 track inside
 * a 40px target, a thumb that slides over 120ms through the motion
 * tokens. On, the track is the ink and the thumb paper; off, the track
 * grey 300 and the thumb the ink, so both states stay AA on the card
 * and the thumb's side tells the state. It is a button with the
 * `switch` role, so a screen reader hears "on" or "off"; the caller
 * names it with `aria-labelledby` (the visible label) and may point at
 * the help sentence with `aria-describedby`.
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
        "press group inline-flex h-10 shrink-0 cursor-pointer items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-[background-color] duration-fast ease-out-soft",
          checked ? "bg-ink" : "bg-input group-hover:bg-neutral",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 size-4 rounded-full transition-[translate,background-color] duration-fast ease-out-soft",
            checked ? "translate-x-4 bg-background" : "bg-ink",
          )}
        />
      </span>
    </button>
  );
}
