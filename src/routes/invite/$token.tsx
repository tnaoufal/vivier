/**
 * The page an invitation link opens, outside the app shell (no
 * organisation is loaded here): the organisation and the role, a sign-in
 * button when signed out, the accept button when signed in. Accepting
 * runs accept_invitation() in the database, which checks the token, its
 * expiry and that the address matches the account.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { isSupabaseConfigured, requireSupabase } from "@/lib/auth/supabase-client";
import { useI18n } from "@/lib/i18n";
import { rememberOrgId } from "@/lib/org/org-context";
import { acceptErrorKey } from "@/lib/team/accept-error";
import { previewInvitation, type InvitationPreview } from "@/lib/team/team.functions";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: InvitePage,
});

type State = { status: "loading" } | { status: "error" } | { status: "ready"; preview: InvitationPreview };

function InvitePage() {
  const { token } = Route.useParams();
  const { t } = useI18n();
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    previewInvitation({ data: { token } })
      .then((preview) => {
        if (!cancelled) setState({ status: "ready", preview });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(orgName: string) {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
      if (error) {
        console.error(error);
        toast.error(t(acceptErrorKey(error.message)));
        return;
      }
      if (typeof data === "string") rememberOrgId(data);
      toast.success(t("invite.accepted", { org: orgName }));
      void navigate({ to: "/app" });
    } catch (error) {
      console.error(error);
      toast.error(t("invite.error"));
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
    content = <p className="text-sm text-muted-foreground">{t("auth.notConfigured")}</p>;
  } else if (state.status === "loading" || authLoading) {
    content = <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
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
    const wrongAccount = Boolean(user?.email && user.email.toLowerCase() !== invitedEmail.toLowerCase());
    content = (
      <>
        <h1 className="font-display text-2xl text-ink">{t("invite.title", { org: orgName })}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("invite.text", { role: t(`role.${preview.role}`) })}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(`role.${preview.role}.help`)}</p>
        {!user ? (
          <>
            <p className="mt-6 text-sm text-ink">{t("invite.signInFirst", { email: invitedEmail })}</p>
            <Button asChild className="mt-4 w-full">
              <Link to="/sign-in" search={{ next: `/invite/${token}` }}>
                {t("auth.signIn")}
              </Link>
            </Button>
          </>
        ) : wrongAccount ? (
          <>
            <p className="mt-6 text-sm text-ink">{t("team.invitePage.wrongAccount", { email: invitedEmail })}</p>
            <Button variant="outline" className="mt-4 w-full" onClick={() => void switchAccount()} disabled={busy}>
              {t("common.signOut")}
            </Button>
          </>
        ) : (
          <>
            <p className="mt-6 text-sm text-muted-foreground">{t("team.invitePage.signedInAs", { email: user.email ?? "" })}</p>
            <Button className="mt-4 w-full" onClick={() => void accept(orgName)} disabled={busy}>
              {t("invite.accept")}
            </Button>
          </>
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-3 sm:px-6">
        <BrandMark size="sm" />
        <div className="flex items-center">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="sheet w-full max-w-md p-6 sm:p-8">{content}</div>
      </div>
    </div>
  );
}

/** An invitation that cannot be accepted: the reason and a way out. */
function Closed({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <>
      <h1 className="font-display text-2xl text-ink">{t("invite.accept")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      <Button asChild variant="outline" className="mt-6 w-full">
        <Link to="/app">{t("team.invitePage.goToApp")}</Link>
      </Button>
    </>
  );
}
