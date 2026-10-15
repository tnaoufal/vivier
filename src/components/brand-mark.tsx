/**
 * The product's mark: a sprout in a circle (a vivier is where talent
 * grows) next to the wordmark, the ink on paper (paper on ink in dark).
 * Drawn inline so it takes the current colour on either theme; the
 * `gradient` prop is kept for the landing page and draws the same ink.
 * The mark is a link, so it gets the press feedback of every control.
 */
import { Link } from "@tanstack/react-router";

import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("size-7 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="16" cy="16" r="14" className="opacity-25" />
      <path d="M16 25V14" />
      <path d="M16 18c0-4 3-7 8-7-0 4-3 7-8 7Z" />
      <path d="M16 15c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6Z" />
    </svg>
  );
}

export function BrandMark({
  size = "md",
  className,
  to = "/",
  gradient = false,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  to?: "/" | "/app";
  gradient?: boolean;
}) {
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  const icon = size === "lg" ? "size-9" : size === "sm" ? "size-6" : "size-7";
  return (
    <Link
      to={to}
      className={cn(
        "press inline-flex items-center gap-2 rounded-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      aria-label={BRAND.name}
    >
      <BrandIcon className={cn(icon, "text-ink")} />
      <span className={cn("font-display leading-none", text, gradient && "brand-text")}>
        {BRAND.name}
      </span>
    </Link>
  );
}
