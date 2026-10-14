/**
 * The one explanation a screen keeps, on demand: a 16px info icon in a
 * 40px target that opens a small popover with the sentence. A popover
 * rather than a hover tooltip so a tap opens it on a phone and the
 * keyboard reaches it; the button is named "More information · {label}"
 * (`label` is what the sentence is about, so the name never reads like
 * an action), and the sentence is read when the popover opens. The rule
 * it serves (docs/DESIGN.md, content rules): no help line under a title,
 * a field or a button; the rare sentence that matters sits behind this.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function InfoTip({
  children,
  label,
  className,
}: {
  /** The sentence shown on demand. */
  children: ReactNode;
  /** What the sentence is about (a title, a field's label), added to the button's name. */
  label?: string | undefined;
  className?: string | undefined;
}) {
  const t = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `${t("common.info")} · ${label}` : t("common.info")}
          className={cn(
            // A 40px target drawn at the icon's size: the negative margin keeps the line's height.
            "press -mx-2 -my-3 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-muted-foreground hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-ink",
            className,
          )}
        >
          <Info aria-hidden="true" className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-meta text-ink">
        {children}
      </PopoverContent>
    </Popover>
  );
}
