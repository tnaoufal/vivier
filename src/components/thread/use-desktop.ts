/**
 * Whether the viewport is at Tailwind's `lg` (64rem) or wider: the
 * thread panel is a column there and a drawer below. Read through
 * `useSyncExternalStore` so the server and the first client render
 * agree (a phone), then the real width takes over.
 */
import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 64rem)";

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DESKTOP_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return mediaQuery()?.matches ?? false;
}

function serverSnapshot(): boolean {
  return false;
}

export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
