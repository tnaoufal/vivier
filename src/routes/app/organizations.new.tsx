/** A second (or third) organisation for a person who already belongs to one: the onboarding form as one centred card inside the shell. */
import { createFileRoute } from "@tanstack/react-router";

import { Onboarding } from "@/components/onboarding";

export const Route = createFileRoute("/app/organizations/new")({
  component: () => <Onboarding standalone />,
});
