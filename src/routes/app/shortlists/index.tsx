/**
 * /app/shortlists: the shortlists have no list of their own any more (a
 * shortlist is a tab of its brief's page), so a bookmark to the old list
 * goes to the briefs instead of falling on a page not found outside the
 * shell.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/shortlists/")({
  beforeLoad: () => {
    throw redirect({ to: "/app/briefs", replace: true });
  },
});
