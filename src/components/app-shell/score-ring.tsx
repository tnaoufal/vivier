/**
 * The fit score 0..100 as a ring with the number inside: an ink arc on a
 * grey 200 track, the number in the ink, and a dash when there is no
 * score (no model assessed the profile). The figure is the signal; no
 * colour grades it. Sizes: sm (40px) in a dense row, md (56px) in a
 * list, lg (72px) on a dossier. The arc draws itself once on mount (the
 * public dossier passes `static` so print sees it at rest). The label is
 * read by screen readers and shown on hover. `ringTone` names the band
 * of a score for the words a page may say about it, never for a colour.
 */
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const RADIUS = 20;
const LENGTH = 2 * Math.PI * RADIUS;

const SIZES = {
  sm: "size-10 text-xs",
  md: "size-14 text-sm",
  lg: "size-18 text-base",
} as const;

/** The band of a score: strong from 80, middling from 60, weak below. For words, not colours. */
export function ringTone(score: number): "positive" | "caution" | "negative" {
  if (score >= 80) return "positive";
  if (score >= 60) return "caution";
  return "negative";
}

export function ScoreRing({
  score,
  label,
  size = "md",
  static: drawnAtRest = false,
  className,
}: {
  /** Null when no score exists: the ring is empty and shows a dash. */
  score: number | null;
  /** The sentence for assistive technologies and the hover. */
  label: string;
  size?: "sm" | "md" | "lg";
  /** Draw the arc at its value from the first paint (print, a page without motion). */
  static?: boolean;
  className?: string;
}) {
  const clamped = score === null ? 0 : Math.max(0, Math.min(100, Math.round(score)));
  // The arc starts empty and eases to its value after the first paint, once.
  const [drawn, setDrawn] = useState(drawnAtRest);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const length = drawn ? (clamped / 100) * LENGTH : 0;
  return (
    <div
      className={cn("relative shrink-0 tabular-nums", SIZES[size], className)}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 48 48" className="size-full -rotate-90">
        <circle cx="24" cy="24" r={RADIUS} fill="none" strokeWidth="4" className="stroke-track" />
        {score !== null ? (
          <circle
            cx="24"
            cy="24"
            r={RADIUS}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${length} ${LENGTH}`}
            className="stroke-ink transition-[stroke-dasharray] duration-slower ease-out-soft"
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-ink">
        {score === null ? "—" : clamped}
      </span>
    </div>
  );
}
