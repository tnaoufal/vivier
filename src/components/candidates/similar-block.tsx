/**
 * The five profiles nearest this one, the closest seniority first (the
 * drawer's order, similar.ts): each row the photo or the initials, the
 * years first in their own column, "name · position" truncated, the
 * whole row a link to the profile; "Tout voir" opens the drawer with
 * the ten and how close each one is. Read when the sheet shows (the
 * RPC under RLS); the rows rise in once. A proximity is a reading aid:
 * nothing is decided here.
 */
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleAlert, RefreshCw } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { candidatePath } from "@/lib/briefs/paths";
import { displayName, yearsLabel } from "@/lib/candidates/format";
import { listSimilar, type SimilarProfile } from "@/lib/candidates/similar";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";

import { Block, type BlockHeading } from "./block";
import { SimilarDrawer } from "./similar-drawer";

/** How many neighbours the sheet shows; the drawer holds the rest. */
const SHEET_SIMILAR = 5;

export function SimilarBlock({
  orgId,
  candidateId,
  name,
  showPhotos,
  as,
}: {
  orgId: string;
  candidateId: string;
  /** The profile's name as shown, for the drawer's description. */
  name: string;
  showPhotos: boolean;
  as: BlockHeading;
}) {
  const t = useI18n().t;
  const [open, setOpen] = useState(false);
  const similar = useQuery(`similar:${orgId}:${candidateId}`, async () =>
    listSimilar(await requireSupabase(), orgId, candidateId),
  );
  const rows = (similar.data ?? []).slice(0, SHEET_SIMILAR);

  return (
    <Block
      as={as}
      title={t("similar.title")}
      action={
        (similar.data?.length ?? 0) > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {t("common.seeAll")}
          </Button>
        ) : null
      }
    >
      {similar.loading && !similar.data ? (
        <>
          <p className="sr-only">{t("common.loading")}</p>
          <SkeletonRows rows={3} avatarSize="sm" className="divide-y-0 [&>li]:px-0 [&>li]:py-1" />
        </>
      ) : similar.error !== null ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p role="alert" className="flex min-w-0 items-start gap-1.5 text-sm text-ink">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{t("similar.loadError")}</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<RefreshCw />}
            onClick={() => void similar.refresh()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : rows.length ? (
        <ul className="stagger flex flex-col gap-1">
          {rows.map((profile) => (
            <Fragment key={profile.id}>
              <SimilarRow profile={profile} showPhotos={showPhotos} />
            </Fragment>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("similar.empty.title")}</p>
      )}
      <SimilarDrawer
        open={open}
        onOpenChange={setOpen}
        orgId={orgId}
        candidateId={candidateId}
        name={name}
        showPhotos={showPhotos}
      />
    </Block>
  );
}

/** One neighbour: who (the photo when the organisation shows photos), the years first, then the name and the position; the row leads to the profile. */
function SimilarRow({ profile, showPhotos }: { profile: SimilarProfile; showPhotos: boolean }) {
  const { t, locale } = useI18n();
  const name = displayName(profile, t("candidates.noName"));
  const photoUrl = usePhotoUrl(profile.photo_path, showPhotos);
  const years = yearsLabel(locale, profile.years_experience) || t("similar.years.unknown");
  const headline = profile.headline?.trim() ?? "";
  return (
    <li className="rise-in">
      <Link
        to={candidatePath(profile.id)}
        className="flex min-h-9 items-center gap-2.5 rounded-sm text-meta text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar name={name} size="sm" photoUrl={photoUrl} decorative />
        <span className="min-w-11 shrink-0 font-medium tabular-nums">{years}</span>
        <span className="min-w-0 flex-1 truncate">
          {name}
          {headline ? <span className="text-muted-foreground"> · {headline}</span> : null}
        </span>
      </Link>
    </li>
  );
}
