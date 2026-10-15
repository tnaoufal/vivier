/**
 * A text field: 40px high, a pill like the buttons, paper on the card
 * with a 1px grey 300 border, 16px on phones (so iOS does not zoom) and
 * 15px from `md`. On focus the edge becomes 2px of ink (the border and a
 * 1px ring); the placeholder is grey 500.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full min-w-0 rounded-full border border-input bg-card px-4 text-base text-ink transition-[border-color,box-shadow] duration-fast ease-out-soft file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-neutral focus-visible:border-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:cursor-not-allowed disabled:opacity-60 md:text-body",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
