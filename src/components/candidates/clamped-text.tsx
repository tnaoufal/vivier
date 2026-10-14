/**
 * A text shown on a few lines at first, with "Voir plus" only when it is
 * actually longer: the clamp is measured after layout and again when the
 * width changes, so a short summary never carries a useless button. The
 * expanded text keeps the CV's line breaks.
 */
import { useLayoutEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LINE_CLAMP: Record<2 | 3, string> = { 2: "line-clamp-2", 3: "line-clamp-3" };

export function ClampedText({
  text,
  lines = 3,
  className,
}: {
  text: string;
  lines?: 2 | 3;
  /** Classes of the paragraph itself (its size, its tone). */
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    // Measured while clamped only: expanded, the text never overflows, and the button must stay.
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div className="min-w-0">
      <p
        ref={ref}
        className={cn("whitespace-pre-line text-body text-ink break-words", !expanded && LINE_CLAMP[lines], className)}
      >
        {text}
      </p>
      {overflows ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 cursor-pointer rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? t("candidates.showLess") : t("candidates.showMore")}
        </button>
      ) : null}
    </div>
  );
}
