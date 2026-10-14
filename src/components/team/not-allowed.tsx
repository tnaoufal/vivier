/**
 * What a page shows a person whose role does not cover it: the refusal
 * as the title and who can help in a few words, no redirect.
 */
import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { useT } from "@/lib/i18n";

export function NotAllowed({ text }: { text?: string | undefined }) {
  const t = useT();
  return (
    <EmptyState
      icon={<ShieldAlert />}
      title={t("common.forbidden")}
      text={text ?? t("team.askAdmin")}
    />
  );
}
