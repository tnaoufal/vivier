import { createFileRoute } from "@tanstack/react-router";

import { Onboarding } from "@/components/onboarding";

export const Route = createFileRoute("/app/organizations/new")({
  component: () => <Onboarding standalone />,
});
