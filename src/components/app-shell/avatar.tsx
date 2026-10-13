import { initialsOf } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

/** A person as a disc of initials: no photos, no third-party avatars. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = size === "lg" ? "size-10 text-sm" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/12 font-semibold text-primary",
        dim,
        className,
      )}
      title={name}
      aria-label={name}
    >
      {initialsOf(name)}
    </span>
  );
}
