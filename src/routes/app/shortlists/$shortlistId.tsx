/**
 * /app/shortlists/:shortlistId: a shortlist is a tab of its brief's page
 * now. A link that still names the shortlist (a mention, an activity
 * row, a bookmark) reads the brief it belongs to under RLS and goes
 * there, on the shortlist tab, in place of this address; a shortlist
 * that does not exist (or is not this organisation's) says so and
 * leads to the briefs.
 */
import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ListChecks, RefreshCw, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { readShortlistBriefId } from "@/lib/shortlists/queries";

export const Route = createFileRoute("/app/shortlists/$shortlistId")({
  component: ShortlistRedirect,
});

function ShortlistRedirect() {
  const { shortlistId } = Route.useParams();
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const navigate = useNavigate();

  const brief = useQuery(`shortlist-brief:${org.id}:${shortlistId}`, async () =>
    readShortlistBriefId(await requireSupabase(), org.id, shortlistId),
  );
  const briefId = brief.data;

  useEffect(() => {
    if (!briefId) return;
    void navigate({
      to: "/app/briefs/$briefId",
      params: { briefId },
      search: { tab: "shortlist" },
      replace: true,
    });
  }, [briefId, navigate]);

  if (brief.error) {
    return (
      <EmptyState
        icon={<TriangleAlert />}
        title={t("shortlists.boardError")}
        action={
          <Button
            type="button"
            variant="outline"
            icon={<RefreshCw />}
            onClick={() => void brief.refresh()}
          >
            {t("common.retry")}
          </Button>
        }
      />
    );
  }

  if (brief.loading || briefId) {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="sr-only">{t("common.loading")}</p>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  return (
    <EmptyState
      icon={<ListChecks />}
      title={t("shortlists.notFound.title")}
      action={
        <Button asChild variant="outline">
          <Link to="/app/briefs">{t("shortlists.notFound.action")}</Link>
        </Button>
      }
    />
  );
}
