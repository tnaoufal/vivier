/**
 * The page an invitation link opens, outside the app shell (no
 * organisation is loaded here): one centred card with the organisation
 * and the role (a pill and its few words), a sign-in button when signed
 * out, the accept button when signed in. Accepting runs accept_invitation() in the database,
 * which checks the token, its expiry and that the address matches the
 * account; a refusal is a sentence in the card, never a toast.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldAlert, UserPlus } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { BrandIcon } from "@/components/brand-mark";
import { PublicFrame } from "@/components/public-frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/auth-context";
import { isSupabaseConfigured, requireSupabase } from "@/lib/auth/supabase-client";
import type { OrgRole } from "@/lib/db/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { rememberOrgId } from "@/lib/org/org-context";
import { acceptErrorKey } from "@/lib/team/accept-error";
import { previewInvitation, type InvitationPreview } from "@/lib/team/team.functions";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: InvitePage,
});

type State = { status: "loading" } | { status: "error" } | { status: "ready"; preview: InvitationPreview };

/** The dictionary keys of a role's name and its one-line help. */
function roleKeys(role: OrgRole): { name: TranslationKey; help: TranslationKey } {
  return { name: `role.${role}`, help: `role.${role}.help` };
}

function InvitePage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    previewInvitation({ data: { token } })
      .then((preview) => {
        if (!cancelled) setState({ status: "ready", preview });
      })
      .catch((caught: unknown) => {
        console.error(caught);
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(orgName: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = await requireSupabase();
      const { data, error: rpcError } = await supabase.rpc("accept_invitation", { p_token: token });
      if (rpcError) {
        console.error(rpcError);
        setError(t(acceptErrorKey(rpcError.message)));
        return;
      }
      if (typeof data === "string") rememberOrgId(data);
      toast.success(t("invite.accepted", { org: orgName }));
      void navigate({ to: "/app" });
    } catch (caught) {
      console.error(caught);
      setError(t("invite.error"));
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
      void navigate({ to: "/sign-in", search: { next: `/invite/${token}` } });
    } finally {
      setBusy(false);
    }
  }

  const preview = state.status === "ready" ? state.preview : null;

  let content: ReactNode;
  if (!isSupabaseConfigured) {
    content = <Closed text={t("auth.notConfigured")} />;
  } else if (state.status === "loading" || authLoading) {
    content = (
      <div className="space-y-3" aria-busy="true">
        <p className="sr-only">{t("common.loading")}</p>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-6 h-10 w-full rounded-full" />
      </div>
    );
  } else if (state.status === "error" || !preview) {
    content = <Closed text={t("invite.error")} />;
  } else if (preview.notFound) {
    content = <Closed text={t("invite.notFound")} />;
  } else if (preview.used) {
    content = <Closed text={t("invite.used")} />;
  } else if (preview.expired) {
    content = <Closed text={t("invite.expired")} />;
  } else {
    const orgName = preview.orgName;
    const invitedEmail = preview.email;
    const role = roleKeys(preview.role);
    const wrongAccount = Boolean(user?.email && user.email.toLowerCase() !== invitedEmail.toLowerCase());
    content = (
      <>
        <h1 className="font-display text-2xl text-ink break-words">{t("invite.title", { org: orgName })}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Pill tone="primary" dot>
            {t(role.name)}
          </Pill>
          <span className="text-meta text-muted-foreground">{t(role.help)}</span>
        </div>
        {error ? (
          <p role="alert" className="fade-in mt-6 rounded-md border border-negative/30 bg-negative/8 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        ) : null}
        {!user ? (
          <>
            <p className="mt-8 text-sm text-ink break-words">{t("invite.signInFirst", { email: invitedEmail })}</p>
            <Button asChild className="mt-5 w-full">
              <Link to="/sign-in" search={{ next: `/invite/${token}` }}>
                {t("auth.signIn")}
              </Link>
            </Button>
          </>
        ) : wrongAccount ? (
          <>
            <p className="mt-8 rounded-md border border-caution/40 bg-caution/10 px-3 py-2 text-sm text-ink break-words">
              {t("team.invitePage.wrongAccount", { email: invitedEmail })}
            </p>
            <Button variant="outline" className="mt-5 w-full" onClick={() => void switchAccount()} disabled={busy}>
              {t("common.signOut")}
            </Button>
          </>
        ) : (
          <>
            <p className="mt-8 text-meta text-muted-foreground break-words">{t("team.invitePage.signedInAs", { email: user.email ?? "" })}</p>
            <Button className="mt-3 w-full" icon={<UserPlus />} onClick={() => void accept(orgName)} disabled={busy}>
              {t("invite.accept")}
            </Button>
          </>
        )}
      </>
    );
  }

  return (
    <PublicFrame width="sm" center>
      <div className="sheet rise-in p-6 sm:p-8">
        <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BrandIcon className="size-7" />
        </div>
        {content}
      </div>
    </PublicFrame>
  );
}

/** An invitation that cannot be accepted: the reason as the title and a way out. */
function Closed({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <>
      <ShieldAlert className="size-5 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-3 font-display text-2xl text-ink break-words">{text}</h1>
      <Button asChild variant="outline" className="mt-8 w-full">
        <Link to="/app">{t("team.invitePage.goToApp")}</Link>
      </Button>
    </>
  );
}
