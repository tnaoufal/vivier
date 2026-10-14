/**
 * The page change of the app: the outlet's content fades in and rises
 * 6px over 180ms whenever the pathname changes (the wrapper is keyed on
 * it, so the new page mounts fresh). A person who asked for less motion
 * gets the new page at once: the key stays and the animation class is
 * not set, on top of the global reduced-motion rule.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

import { prefersReducedMotion, subscribeReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

function serverSnapshot(): boolean {
  return false;
}

/** The live reduced-motion preference, false on the server. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, serverSnapshot);
}

export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const reduced = usePrefersReducedMotion();
  return (
    <div
      key={reduced ? "static" : pathname}
      className={cn("min-w-0", !reduced && "page-enter", className)}
    >
      {children}
    </div>
  );
}
