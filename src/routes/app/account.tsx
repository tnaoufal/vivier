/**
 * The person's account now lives in the settings ("Mon compte"): this
 * route only sends there, so the links that led here (a password reset
 * among them) keep working.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/account")({
  beforeLoad: () => {
    throw redirect({ to: "/app/settings", replace: true });
  },
});
