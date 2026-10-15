/**
 * A multi-line field: the same border, focus edge and type as Input,
 * with 12px corners and room to breathe (16px horizontal, 12px
 * vertical).
 */
import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-24 w-full min-w-0 rounded-lg border border-input bg-card px-4 py-3 text-base leading-6 text-ink transition-[border-color,box-shadow] duration-fast ease-out-soft placeholder:text-muted-foreground hover:border-neutral focus-visible:border-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-60 md:text-body",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
