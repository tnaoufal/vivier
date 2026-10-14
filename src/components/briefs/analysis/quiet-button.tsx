/**
 * A quiet text button that shows or hides what sits right under it (the
 * near profiles of an analysis): muted until open, a chevron that turns,
 * the region it controls named while it is shown.
 */
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function QuietButton({
  id,
  label,
  expanded,
  controls,
  onClick,
}: {
  /** So the region it opens can be named by it. */
  id?: string | undefined;
  label: string;
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <Button
      id={id}
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      className={cn("px-3", expanded ? "text-ink" : "text-muted-foreground hover:text-ink")}
    >
      {label}
      <ChevronDown
        aria-hidden="true"
        className={cn("transition-transform duration-base ease-out-soft", expanded && "rotate-180")}
      />
    </Button>
  );
}
