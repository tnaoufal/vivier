/**
 * A yes/no control that reads as a switch: a 36 × 20 track, the ink
 * with a paper thumb when on, grey 300 with an ink thumb when off (the
 * thumb's side and its ink tell the state, both AA), a thumb that
 * slides across (120ms, through the motion tokens), and the word next
 * to it, so shape is never the only signal. It is a real button with
 * the "switch" role: a 40px target that takes the keyboard and tells
 * assistive technologies its state. Built for the criteria rows; the ui
 * library has no switch yet.
 */
import { cn } from "@/lib/utils";

export function ToggleSwitch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The word shown after the track; also what the control is called. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "press group inline-flex h-10 cursor-pointer items-center gap-2.5 rounded-full pr-2 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
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
      <span>{label}</span>
    </button>
  );
}
