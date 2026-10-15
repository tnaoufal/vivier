/**
 * /app/candidates/:candidateId: one profile on the plane, the same
 * sheet as the pool's detail pane, full width, the team's thread beside
 * it. The header: the way back as its eyebrow, the name, one line that
 * reminds the position held today, the years and the place; the one
 * filled action, the CV read in place; the thread's toggle; a menu for
 * the rest (edit, the similar profiles, export, archive, erase). Then
 * the sheet (candidate-sheet.tsx, `compact`: the name and the actions
 * are the header's) in one pane and the thread pane. Live through
 * realtime on the documents of this candidate (use-candidate.ts); the
 * thread follows its own messages.
 */
import { useMemo } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { Pane, Workspace } from "@/components/app-shell/workspace";
import { CandidateActions } from "@/components/candidates/candidate-actions";
import { CandidateSheet } from "@/components/candidates/candidate-sheet";
import { ThreadPane, ThreadToggle, useThreadPane } from "@/components/thread/thread-pane";
import { useAuth } from "@/lib/auth/auth-context";
import { displayName, headerLine } from "@/lib/candidates/format";
import { useCandidate } from "@/lib/candidates/use-candidate";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { useTeamMembers } from "@/lib/shortlists/use-members";

export const Route = createFileRoute("/app/candidates/$candidateId")({
  component: CandidatePage,
  // The similar profiles link to this same route with another id: a fresh mount per candidate,
  // so no draft, open dialog or loaded profile of the previous one survives under the new URL.
  remountDeps: ({ params }) => params,
});

function CandidatePage() {
  const { candidateId } = Route.useParams();
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const { user } = useAuth();
  const members = useTeamMembers();
  const navigate = useNavigate();
  const canEdit = can("member");
  const state = useCandidate(org.id, candidateId);
  const thread = useThreadPane();
  const target = useMemo(() => ({ candidateId }), [candidateId]);

  const row = state.candidate;
  const name = row ? displayName(row, t("candidates.noName")) : null;
  const reminder = row ? headerLine(locale, row) : "";
  const leave = () => void navigate({ to: "/app/candidates" });

  // The way back is the header's eyebrow, as on a brief: one detail skeleton across the product.
  const eyebrow = (
    <Link
      to="/app/candidates"
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("nav.candidates")}
    </Link>
  );
  // The header stays in place while the profile loads and when it cannot be shown: the way back is where it always is.
  const title = state.loading ? (
    <span
      className="skeleton inline-block h-5 w-56 max-w-full rounded-sm align-middle"
      aria-hidden="true"
    />
  ) : (
    (name ?? (state.error ? t("common.errorPage") : t("candidates.notFound.title")))
  );

  return (
    <Workspace
      eyebrow={eyebrow}
      title={title}
      meta={
        reminder ? (
          <span className="min-w-0 max-w-xs truncate tabular-nums xl:max-w-sm">{reminder}</span>
        ) : undefined
      }
      actions={
        row && name ? (
          <CandidateActions
            candidate={row}
            documents={state.documents}
            name={name}
            onChanged={state.refreshCandidate}
            onErased={leave}
          >
            <ThreadToggle open={thread.open} onToggle={thread.toggle} target={target} />
          </CandidateActions>
        ) : undefined
      }
    >
      <Pane label={t("candidates.pane.sheet")} width="fill">
        <CandidateSheet compact state={state} onErased={leave} />
      </Pane>
      {row ? (
        <ThreadPane
          target={target}
          canPost={canEdit}
          members={members}
          currentUserId={user?.id ?? null}
          open={thread.open}
          onOpenChange={thread.setOpen}
        />
      ) : null}
    </Workspace>
  );
}
