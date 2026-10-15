/**
 * A team for a person who already has a space: the team path of the
 * onboarding alone, on the plane, in one pane, titled "Nouvelle équipe".
 */
import { createFileRoute } from "@tanstack/react-router";

import { Pane, Workspace } from "@/components/app-shell/workspace";
import { Onboarding } from "@/components/onboarding";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/app/organizations/new")({
  component: NewTeamPage,
});

function NewTeamPage() {
  const t = useT();
  return (
    <Workspace title={t("nav.newOrg")}>
      <Pane label={t("nav.newOrg")} width="fill" bodyClassName="p-4 sm:p-6">
        <Onboarding standalone />
      </Pane>
    </Workspace>
  );
}
