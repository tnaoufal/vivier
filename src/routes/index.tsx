/**
 * The landing page: the brand, one sentence on what Vivier does, two
 * buttons, three feature cards, and the promise that no decision is
 * made by a machine. Signed-in visitors go straight to the app.
 */
import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileSearch, Mail, Users } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/app", replace: true });
  }, [loading, navigate, user]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8 lg:px-10">
        <BrandMark size="md" />
        <div className="flex items-center gap-1">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-8 lg:px-10">
        <section className="py-16 text-center sm:py-24">
          <p className="label-caps">{BRAND.tagline[locale]}</p>
          <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl leading-[1.1] text-ink break-words sm:text-6xl">
            <span className="brand-text">{t("landing.hero")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-7 text-muted-foreground">{t("landing.lead")}</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/sign-in">{t("landing.cta")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/sign-in">{t("auth.signIn")}</Link>
            </Button>
          </div>
        </section>
        <section className="grid gap-6 md:grid-cols-3">
          <article className="sheet p-6">
            <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
              <FileSearch aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold leading-6 text-ink">{t("landing.feature.read.title")}</h2>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{t("landing.feature.read.text")}</p>
          </article>
          <article className="sheet p-6">
            <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
              <Users aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold leading-6 text-ink">{t("landing.feature.team.title")}</h2>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{t("landing.feature.team.text")}</p>
          </article>
          <article className="sheet p-6">
            <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
              <Mail aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold leading-6 text-ink">{t("landing.feature.send.title")}</h2>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{t("landing.feature.send.text")}</p>
          </article>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13px] leading-5 text-muted-foreground sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="max-w-2xl space-y-1">
            <p>{t("landing.footer.human")}</p>
            <p>{t("landing.footer.gdpr")}</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label={t("nav.terms")}>
            <Link to="/privacy" className="hover:text-ink hover:underline">
              {t("nav.privacy")}
            </Link>
            <Link to="/terms" className="hover:text-ink hover:underline">
              {t("nav.terms")}
            </Link>
            <Link to="/status" className="hover:text-ink hover:underline">
              {t("nav.status")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
