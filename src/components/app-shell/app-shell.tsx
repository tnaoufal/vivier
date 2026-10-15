/**
 * The frame of every signed-in page. From `lg` a grid of the 64px rail
 * and the content column, as tall as the viewport, so the rail is fixed
 * by construction and only a pane scrolls (`Workspace` lays the page
 * out as panes); below `lg` there is no rail: the Workspace header
 * carries the menu button that opens the rail's items in a sheet, and
 * the page scrolls. No transition on the whole page: a pane may fade
 * its own content in.
 */
import type { ReactNode } from "react";

import { Rail } from "./rail";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground lg:grid lg:h-dvh lg:grid-cols-[4rem_minmax(0,1fr)]">
      <Rail className="hidden lg:flex" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto">{children}</div>
    </div>
  );
}
