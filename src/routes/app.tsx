/**
 * The signed-in area. Without a session the sign-in page takes over;
 * without an organisation the onboarding form does. Every child page
 * renders inside the shell with the organisation context loaded; the
 * shell animates each page change.
 */
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { BrandMark } from "@/components/brand-mark";
import { Onboarding } from "@/components/onboarding";
import { useAuth } from "@/lib/auth/auth-context";
import { isSupabaseConfigured } from "@/lib/auth/supabase-client";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { OrgProvider } from "@/lib/org/org-provider";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: AppLayout,
});

/** The whole page while the session or the organisation loads: the brand and one sentence, never a bare spinner. */
function Splash({ text }: { text: string }) {
  return (
    <div className="fade-in flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4">
      <BrandMark size="md" />
      <p className="text-body text-muted-foreground" aria-live="polite">
        {text}
      </p>
    </div>
  );
}

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    if (!loading && !user) {
      void navigate({ to: "/sign-in", search: { next: window.location.pathname } });
    }
  }, [loading, navigate, user]);

  if (!isSupabaseConfigured) return <Splash text={t("auth.notConfigured")} />;
  if (loading || !user) return <Splash text={t("common.loading")} />;
  return (
    <OrgProvider>
      <OrgGate />
    </OrgProvider>
  );
}

function OrgGate() {
  const { org, loading } = useOrg();
  const t = useT();
  if (loading) return <Splash text={t("common.loading")} />;
  if (!org) return <Onboarding />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
