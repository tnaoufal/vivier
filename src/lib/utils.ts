/**
 * Small pure helpers every component may need: `cn` merges class names
 * (clsx, then tailwind-merge so a caller's class wins over a default),
 * `clamp` and `ratioPercent` keep a number inside the range a bar or a
 * ring can draw.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `value` held between `min` and `max`; NaN reads as `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * `done` out of `total` as a whole percentage from 0 to 100; 0 when the
 * total is not a positive number (nothing to measure is not a full bar).
 */
export function ratioPercent(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(done)) return 0;
  return Math.round(clamp((100 * done) / total, 0, 100));
}
