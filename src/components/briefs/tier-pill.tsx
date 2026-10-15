/**
 * The tier the comparative pass gave a result, as a monogram: the letter
 * alone in a small disc whose shape says the rank (A the ink filled, B
 * an ink outline, C a grey outline), with the readable name for screen
 * readers and on hover. `compact` is the 20px disc of a dense row, the
 * default the 24px one. The model ranks the group; the team retains, and
 * the pill never says more than that.
 */
import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { AssessmentTier } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

const TONES: Record<AssessmentTier, PillTone> = {
  A: "positive",
  B: "caution",
  C: "negative",
};

export function TierPill({
  tier,
  compact = false,
}: {
  tier: AssessmentTier;
  /** The smaller disc, for a dense row. */
  compact?: boolean | undefined;
}) {
  const t = useT();
  const label = t(`briefs.tier.${tier}`);
  const title = t("briefs.tier.label", { tier: label });
  return (
    <Pill
      tone={TONES[tier]}
      dot={false}
      size={compact ? "sm" : "md"}
      title={title}
      className={
        compact
          ? "size-5 justify-center px-0 font-semibold"
          : "size-6 justify-center px-0 font-semibold"
      }
    >
      <span aria-hidden="true">{tier}</span>
      <span className="sr-only">{label}</span>
    </Pill>
  );
}
