/**
 * The decision of the analysis on a result as a pill whose shape and
 * icon say it: matches is the ink filled with a check, to check an ink
 * outline with an alert, does not match a grey outline with a cross,
 * and not analysed a grey disc with a dashed circle when no model read
 * the profile. The analysis proposes; the pill never says more than that.
 */
import { CircleAlert, CircleCheck, CircleDashed, CircleX } from "lucide-react";

import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { ResultDecision } from "@/lib/briefs/assessment";
import { useT } from "@/lib/i18n";

/** The tone and the icon of each decision, exported so every pill that shows a decision reads one map. */
export const DECISION_LOOK: Record<ResultDecision, { tone: PillTone; icon: typeof CircleCheck }> = {
  fit: { tone: "positive", icon: CircleCheck },
  borderline: { tone: "caution", icon: CircleAlert },
  no_fit: { tone: "negative", icon: CircleX },
  unassessed: { tone: "neutral", icon: CircleDashed },
};

export function DecisionPill({ decision }: { decision: ResultDecision }) {
  const t = useT();
  const { tone, icon: Icon } = DECISION_LOOK[decision];
  return (
    <Pill tone={tone} icon={<Icon />}>
      {t(`briefs.decision.${decision}`)}
    </Pill>
  );
}
