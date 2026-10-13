/**
 * The profiles near this one, in a sheet from the right. The database
 * ranks them by the meaning of the career when both profiles carry a
 * vector, else by the words of the headline and the skills, and every
 * row says which measure spoke and how close it found the two. The
 * list loads when the sheet opens. A proximity is a reading aid: the
 * person opens the profiles and compares, nothing is decided here.
 */
import { Link } from "@tanstack/react-router";
import { RefreshCw, Users } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { candidatePath } from "@/lib/briefs/paths";
import { displayName, topSkills } from "@/lib/candidates/format";
import { listSimilar, percentOf, type SimilarProfile } from "@/lib/candidates/similar";
import { useQuery } from "@/lib/data/use-query";
import { useT } from "@/lib/i18n";

/** How many skills a row shows; the profile itself lists them all. */
const SKILLS_SHOWN = 3;
/** Skeleton rows while the list loads, about what a drawer shows at once. */
const SKELETON_ROWS = 4;

export function SimilarDrawer({
  open,
  onOpenChange,
  orgId,
  candidateId,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  candidateId: string;
  /** The name of the profile the neighbours are near, for the help sentence. */
  name: string;
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
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <div className="space-y-6">
          <SheetHeader className="pr-8 text-left">
            <SheetTitle className="font-display text-xl text-ink">{t("similar.title")}</SheetTitle>
            <SheetDescription>{t("similar.help", { name })}</SheetDescription>
          </SheetHeader>

          {pending ? (
            <ul className="divide-y divide-border" aria-busy="true">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <li key={index} className="flex gap-3 py-4">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-2 pt-1">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <Skeleton className="h-3 w-10" />
                </li>
              ))}
            </ul>
          ) : similar.error !== null ? (
            <div className="space-y-3">
              <p className="text-sm text-negative">{t("similar.loadError")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void similar.refresh()}
                className="gap-1.5"
              >
                <RefreshCw />
                {t("common.retry")}
              </Button>
            </div>
          ) : rows.length ? (
            <ul className="divide-y divide-border">
              {rows.map((profile) => (
                <li key={profile.id}>
                  <SimilarRow profile={profile} onOpen={() => onOpenChange(false)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Users />}
              title={t("similar.empty.title")}
              text={t("similar.empty.text")}
              className="py-10"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One neighbour: who, how close, measured how; the name leads to the profile. */
function SimilarRow({ profile, onOpen }: { profile: SimilarProfile; onOpen: () => void }) {
  const t = useT();
  const name = displayName(profile, t("candidates.noName"));
  const line = [profile.headline, profile.location]
    .filter((part) => part && part.trim())
    .join(" · ");
  const skills = topSkills(profile.skills, SKILLS_SHOWN);
  const percent = percentOf(profile.similarity);

  return (
    <div className="flex gap-3 py-4">
      <Avatar name={name} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={candidatePath(profile.id)}
              onClick={onOpen}
              title={t("similar.open")}
              className="block truncate text-[15px] font-medium leading-6 text-ink hover:underline"
            >
              {name}
            </Link>
            <p className="truncate text-sm text-muted-foreground">{line || t("common.unknown")}</p>
          </div>
          <span
            className="shrink-0 text-sm font-medium text-ink tabular-nums"
            title={t(`similar.similarity.${profile.method}`, { percent })}
          >
            {t("similar.percent", { percent })}
          </span>
        </div>
        <ul className="mt-2 flex flex-wrap items-center gap-1.5">
          {skills.map((skill) => (
            <li key={skill} className="min-w-0">
              <Pill className="max-w-48">
                <span className="min-w-0 truncate">{skill}</span>
              </Pill>
            </li>
          ))}
          <li>
            <Pill dot title={t(`similar.method.${profile.method}.help`)}>
              {t(`similar.method.${profile.method}`)}
            </Pill>
          </li>
          {profile.status === "archived" ? (
            <li>
              <Pill dot>{t("candidates.status.archived")}</Pill>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
