/**
 * What a page shows a person whose role does not cover it: the refusal
 * as the title, nothing under it, no redirect.
 */
import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { useT } from "@/lib/i18n";

export function NotAllowed() {
  const t = useT();
  return <EmptyState icon={<ShieldAlert />} title={t("common.forbidden")} />;
}
