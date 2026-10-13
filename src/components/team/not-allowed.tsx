/** What a page shows a person whose role does not cover it: one sentence, no redirect. */
import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { useT } from "@/lib/i18n";

export function NotAllowed({ text }: { text: string }) {
  const t = useT();
  return <EmptyState icon={<ShieldAlert />} title={t("common.forbidden")} text={text} />;
}
