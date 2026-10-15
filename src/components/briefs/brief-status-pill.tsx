/**
 * The status of a brief as a pill: open is an ink outline with a dot,
 * closed a grey outline, draft a grey fill. The shape tells them apart;
 * the word says it.
 */
import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { BriefStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

const TONES: Record<BriefStatus, PillTone> = {
  draft: "neutral",
  open: "caution",
  closed: "negative",
};

export function BriefStatusPill({
  status,
  size = "md",
}: {
  status: BriefStatus;
  size?: "sm" | "md";
}) {
  const t = useT();
  return (
    <Pill tone={TONES[status]} dot={status === "open"} size={size}>
      {t(`briefs.status.${status}`)}
    </Pill>
  );
}
