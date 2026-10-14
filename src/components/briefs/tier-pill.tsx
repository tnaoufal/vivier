/**
 * The tier the comparative pass gave a result, as a pill with a leading
 * icon shown before the decision: to present (A), to dig into (B), not
 * presented (C). The model ranks the group; the team retains, and the
 * pill never says more than that.
 */
import { CircleMinus, Eye, Star } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { AssessmentTier } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

const TIERS: Record<AssessmentTier, { tone: PillTone; icon: typeof Star }> = {
  A: { tone: "positive", icon: Star },
  B: { tone: "caution", icon: Eye },
  C: { tone: "neutral", icon: CircleMinus },
};

export function TierPill({ tier }: { tier: AssessmentTier }) {
  const t = useT();
  const { tone, icon: Icon } = TIERS[tier];
  const label = t(`briefs.tier.${tier}`);
  return (
    <Pill tone={tone} title={t("briefs.tier.label", { tier: label })}>
      <Icon aria-hidden="true" />
      {label}
    </Pill>
  );
}
