/**
 * The hint next to a field the structuring read: nothing when it was
 * sure (or when the field was typed by a person and has no confidence
 * at all), "to check" in between, "uncertain" below. Never a verdict on
 * the candidate, only on the reading. A small pill with the icon in its
 * leading slot: the mark says it before the colour does, and the pill
 * stays under the text it qualifies, never a second title. What it
 * means is said once per page, behind the info icon of the profile's
 * head (profile-header.tsx), never in a hover title.
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
    <Pill tone={tone} size="sm" icon={caution ? <CircleHelp /> : <CircleAlert />}>
      {caution ? t("candidates.review") : t("candidates.confidence.unsure")}
    </Pill>
  );
}
