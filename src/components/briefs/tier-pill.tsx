/**
 * The tier the comparative pass gave a result, as a pill with its one
 * leading icon shown before the decision: to present (A), to dig into
 * (B), behind the others (C). `compact` keeps the icon and the letter
 * for a dense row (the name stays for assistive technologies). The model
 * ranks the group; the team retains, and the pill never says more than
 * that.
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

export function TierPill({
  tier,
  compact = false,
}: {
  tier: AssessmentTier;
  /** The letter alone on screen, for a dense row. */
  compact?: boolean | undefined;
}) {
  const t = useT();
  const { tone, icon: Icon } = TIERS[tier];
  const label = t(`briefs.tier.${tier}`);
  const title = t("briefs.tier.label", { tier: label });
  if (compact) {
    return (
      <Pill tone={tone} icon={<Icon />} size="sm" title={title}>
        <span aria-hidden="true">{tier}</span>
        <span className="sr-only">{label}</span>
      </Pill>
    );
  }
  return (
    <Pill tone={tone} icon={<Icon />} title={title}>
      {label}
    </Pill>
  );
}
