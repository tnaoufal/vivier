/**
 * The profiles near this one, in a drawer from the right, the closest
 * seniority first: the database and similar.ts order them the same way
 * (the distance between seniority bands, then the measure: the meaning
 * of the career when both profiles carry a vector, else the words of
 * the headline and the skills). Every row reads the seniority first
 * ("12 ans", or that the profile states none), then who (the photo
 * when the organisation shows photos), the position held today, and
 * the proximity as a meter named after the measure that spoke. The
 * list loads when the drawer opens, its rows rising in once. A
 * proximity is a reading aid: the person opens the profiles and
 * compares, nothing is decided here.
 */
import { Link } from "@tanstack/react-router";
import { RefreshCw, Users } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
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
import { displayName, yearsLabel } from "@/lib/candidates/format";
import { listSimilar, percentOf, type SimilarProfile } from "@/lib/candidates/similar";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";

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
  /** The name of the profile the neighbours are near: the drawer's accessible description, the page already shows it. */
  name: string;
  showPhotos: boolean;
}) {
  const { t } = useI18n();
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
          <SheetTitle className="pr-12">{t("similar.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("similar.subtitle", { name })}</SheetDescription>
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
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw />}
                onClick={() => void similar.refresh()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : rows.length ? (
            <ul className="stagger divide-y divide-border">
              {rows.map((profile) => (
                <li key={profile.id} className="rise-in">
                  <SimilarRow
                    profile={profile}
                    showPhotos={showPhotos}
                    onOpen={() => onOpenChange(false)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<Users />} title={t("similar.empty.title")} />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** One neighbour: the seniority first, then who, the position, and how close measured how; the name leads to the profile. */
function SimilarRow({
  profile,
  showPhotos,
  onOpen,
}: {
  profile: SimilarProfile;
  showPhotos: boolean;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const name = displayName(profile, t("candidates.noName"));
  const photoUrl = usePhotoUrl(profile.photo_path, showPhotos);
  const years = yearsLabel(locale, profile.years_experience) || t("similar.years.unknown");
  const headline = profile.headline?.trim() ?? "";
  const percent = percentOf(profile.similarity);

  return (
    <div className="flex gap-3 py-4 first:pt-0">
      <Avatar name={name} photoUrl={photoUrl} className="mt-0.5" decorative />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink tabular-nums">{years}</p>
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
        {headline ? <p className="truncate text-sm text-muted-foreground">{headline}</p> : null}
        <Meter className="mt-3" label={t(`similar.method.${profile.method}`)} value={percent} />
      </div>
    </div>
  );
}
