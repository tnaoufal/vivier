/**
 * The decision of the analysis on a result as a pill with its one
 * leading icon, so colour is never the only signal: matches, to check,
 * does not match, or not analysed when no model read the profile. The
 * analysis proposes; the pill never says more than that.
 */
import { CircleAlert, CircleCheck, CircleDashed, CircleX } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { ResultDecision } from "@/lib/briefs/assessment";
import { useT } from "@/lib/i18n";

const DECISIONS: Record<ResultDecision, { tone: PillTone; icon: typeof CircleCheck }> = {
  fit: { tone: "positive", icon: CircleCheck },
  borderline: { tone: "caution", icon: CircleAlert },
  no_fit: { tone: "negative", icon: CircleX },
  unassessed: { tone: "neutral", icon: CircleDashed },
};

export function DecisionPill({ decision }: { decision: ResultDecision }) {
  const t = useT();
  const { tone, icon: Icon } = DECISIONS[decision];
  return (
    <Pill tone={tone} icon={<Icon />}>
      {t(`briefs.decision.${decision}`)}
    </Pill>
  );
}
