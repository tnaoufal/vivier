/** A person as a disc of initials: no photos, no third-party avatars. */
import { initialsOf } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/12 font-semibold text-primary",
        SIZES[size],
        className,
      )}
      title={name}
      aria-label={name}
    >
      {initialsOf(name)}
    </span>
  );
}
