/**
 * The fit score 0..100 as a ring with the number inside: green from 80,
 * amber from 60, red below, and a dash when there is no score (no model
 * assessed the profile). Sizes: md (56px) in a list, lg (72px) on a
 * dossier. The label is read by screen readers and shown on hover.
 */
import { cn } from "@/lib/utils";

const RADIUS = 20;
const LENGTH = 2 * Math.PI * RADIUS;

const SIZES = { md: "size-14 text-sm", lg: "size-[4.5rem] text-base" } as const;

export function ringTone(score: number): "positive" | "caution" | "negative" {
  if (score >= 80) return "positive";
  if (score >= 60) return "caution";
  return "negative";
}

const STROKES = {
  positive: "stroke-positive",
  caution: "stroke-caution",
  negative: "stroke-negative",
} as const;

export function ScoreRing({
  score,
  label,
  size = "md",
  className,
}: {
  /** Null when no score exists: the ring is empty and shows a dash. */
  score: number | null;
  /** The sentence for assistive technologies and the hover. */
  label: string;
  size?: "md" | "lg";
  className?: string;
}) {
  const clamped = score === null ? 0 : Math.max(0, Math.min(100, Math.round(score)));
  const tone = score === null ? null : ringTone(clamped);
  return (
    <div className={cn("relative shrink-0 tabular-nums", SIZES[size], className)} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 48 48" className="size-full -rotate-90">
        <circle cx="24" cy="24" r={RADIUS} fill="none" strokeWidth="4" className="stroke-muted" />
        {tone ? (
          <circle
            cx="24"
            cy="24"
            r={RADIUS}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * LENGTH} ${LENGTH}`}
            className={cn("transition-[stroke-dasharray] duration-200", STROKES[tone])}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-ink">
        {score === null ? "—" : clamped}
      </span>
    </div>
  );
}
