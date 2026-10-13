/**
 * The hint next to a field the structuring read: nothing when it was
 * sure (or when the field was typed by a person and has no confidence
 * at all), "to check" in between, "uncertain" below. Never a verdict on
 * the candidate, only on the reading. The leading icon says it before
 * the colour does.
 */
import { CircleAlert, CircleHelp } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { confidenceTone } from "@/lib/candidates/format";
import { useT } from "@/lib/i18n";

export function ConfidenceHint({ value }: { value: number | null | undefined }) {
  const t = useT();
  const tone = confidenceTone(value);
  if (tone === "none") return null;
  const caution = tone === "caution";
  return (
    <Pill
      tone={tone}
      title={caution ? t("candidates.confidence.help.check") : t("candidates.confidence.help.unsure")}
    >
      {caution ? <CircleHelp aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      {caution ? t("candidates.review") : t("candidates.confidence.unsure")}
    </Pill>
  );
}
