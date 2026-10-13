/** The status of a brief as a pill: draft, open, closed. */
import { Pill, type PillTone } from "@/components/app-shell/pill";
import type { BriefStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";

const TONES: Record<BriefStatus, PillTone> = { draft: "neutral", open: "positive", closed: "caution" };

export function BriefStatusPill({ status }: { status: BriefStatus }) {
  const t = useT();
  return <Pill tone={TONES[status]}>{t(`briefs.status.${status}`)}</Pill>;
}
