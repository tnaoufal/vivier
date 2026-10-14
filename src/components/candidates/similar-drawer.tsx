/**
 * The profiles near this one, in a drawer from the right. The database
 * ranks them by the meaning of the career when both profiles carry a
 * vector, else by the words of the headline and the skills; every row
 * shows who (the photo when the organisation shows photos), the
 * position held today, the first skills, and the proximity as a meter
 * that names the measure that spoke; how it is measured sits behind an
 * info icon. The list loads when the drawer opens, its rows rising in
 * once. A proximity is a reading aid: the person opens the profiles and
 * compares, nothing is decided here.
 */
import { Link } from "@tanstack/react-router";
import { RefreshCw, Users } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { InfoTip } from "@/components/app-shell/info-tip";
import { Meter } from "@/components/app-shell/meter";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { candidatePath } from "@/lib/briefs/paths";
import { displayName, keySkills } from "@/lib/candidates/format";
import { listSimilar, percentOf, type SimilarProfile } from "@/lib/candidates/similar";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import { useT } from "@/lib/i18n";

/** Skeleton rows while the list loads, about what a drawer shows at once. */
const SKELETON_ROWS = 4;

export function SimilarDrawer({
  open,
  onOpenChange,
  orgId,
  candidateId,
  name,
  showPhotos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  candidateId: string;
  /** The name of the profile the neighbours are near, under the title. */
  name: string;
  showPhotos: boolean;
}) {
  const t = useT();
  const similar = useQuery(
    `similar:${orgId}:${candidateId}`,
    async () => listSimilar(await requireSupabase(), orgId, candidateId),
    open,
  );
  const rows = similar.data ?? [];
  // The loading flag only flips in an effect: on the render that opens the
  // sheet, nothing read yet is still a pending read, not an empty vivier.
  const pending = similar.loading || (similar.data === null && similar.error === null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="md" className="flex flex-col gap-6 overflow-y-hidden">
        <SheetHeader>
          <div className="flex items-center gap-2 pr-12">
            <SheetTitle>{t("similar.title")}</SheetTitle>
            <InfoTip label={t("similar.title")}>{t("similar.help")}</InfoTip>
          </div>
          <SheetDescription className="truncate">{t("similar.subtitle", { name })}</SheetDescription>
        </SheetHeader>

        <SheetBody>
          {pending ? (
            <>
              <p className="sr-only">{t("common.loading")}</p>
              <SkeletonRows rows={SKELETON_ROWS} className="[&>li]:px-0" />
            </>
          ) : similar.error !== null ? (
            <div className="space-y-3">
              <p className="text-sm text-negative">{t("similar.loadError")}</p>
              <Button type="button" variant="outline" icon={<RefreshCw />} onClick={() => void similar.refresh()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : rows.length ? (
            <ul className="stagger divide-y divide-border">
              {rows.map((profile) => (
                <li key={profile.id} className="rise-in">
                  <SimilarRow profile={profile} showPhotos={showPhotos} onOpen={() => onOpenChange(false)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={<Users />}
              title={t("similar.empty.title")}
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** One neighbour: who, how close and measured how; the name leads to the profile. */
function SimilarRow({
  profile,
  showPhotos,
  onOpen,
}: {
  profile: SimilarProfile;
  showPhotos: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const name = displayName(profile, t("candidates.noName"));
  const photoUrl = usePhotoUrl(profile.photo_path, showPhotos);
  const line = [profile.headline, profile.location]
    .filter((part) => part && part.trim())
    .join(" · ");
  const skills = keySkills(profile.skills);
  const percent = percentOf(profile.similarity);

  return (
    <div className="flex gap-3 py-4 first:pt-0">
      <Avatar name={name} photoUrl={photoUrl} className="mt-0.5" decorative />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={candidatePath(profile.id)}
            onClick={onOpen}
            title={t("similar.open")}
            className="min-w-0 truncate rounded-sm text-body font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </Link>
          {profile.status === "archived" ? (
            <Pill size="sm" dot>
              {t("candidates.status.archived")}
            </Pill>
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">{line || t("common.unknown")}</p>
        {skills.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <li key={skill} className="min-w-0">
                <Pill size="sm" className="max-w-48">
                  {skill}
                </Pill>
              </li>
            ))}
          </ul>
        ) : null}
        <Meter className="mt-3" label={t(`similar.method.${profile.method}`)} value={percent} />
      </div>
    </div>
  );
}
