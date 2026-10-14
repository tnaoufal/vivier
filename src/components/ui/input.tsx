/**
 * A text field: 40px high, a pill like the buttons, white on the card,
 * 16px on phones (so iOS does not zoom) and 15px from `md`. The focus
 * ring is the accent, as everywhere; the border eases to it.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full min-w-0 rounded-full border border-input bg-card px-4 text-base text-ink shadow-hairline transition-[border-color,box-shadow] duration-fast ease-out-soft file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-ink/25 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 md:text-body",
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
