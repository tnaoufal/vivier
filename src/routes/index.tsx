/**
 * The landing page: the brand, one promise and one button in the hero,
 * three feature lines (a title, one short line), and a footer with the
 * one honesty line and the GDPR facts. Each block rises in once;
 * signed-in visitors go straight to the app.
 */
import { useEffect, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FileSearch, Mail, Users } from "lucide-react";

import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const FEATURES: { key: "read" | "team" | "send"; icon: ReactNode }[] = [
  { key: "read", icon: <FileSearch /> },
  { key: "team", icon: <Users /> },
  { key: "send", icon: <Mail /> },
];

function featureKey(key: "read" | "team" | "send", part: "title" | "text"): TranslationKey {
  return `landing.feature.${key}.${part}`;
}

function LandingPage() {
  const { t } = useI18n();
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
          <Button asChild variant="ghost" className="ml-2 hidden sm:inline-flex">
            <Link to="/sign-in">{t("auth.signIn")}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-8 lg:px-10">
        <section className="stagger py-16 text-center sm:py-24">
          <h1 className="rise-in mx-auto max-w-3xl font-display text-4xl leading-10 text-ink break-words sm:text-6xl sm:leading-16">
            {t("landing.hero")}
          </h1>
          <div className="rise-in mt-10 flex justify-center">
            <Button asChild size="lg" icon={<ArrowRight />}>
              <Link to="/sign-in">{t("auth.signIn")}</Link>
            </Button>
          </div>
        </section>

        <ul className="stagger mx-auto max-w-3xl divide-y divide-border border-y border-border">
          {FEATURES.map((feature) => (
            <li key={feature.key} className="rise-in flex items-start gap-4 py-5">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-ink [&_svg]:size-5"
              >
                {feature.icon}
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-6 text-ink">
                  {t(featureKey(feature.key, "title"))}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(featureKey(feature.key, "text"))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-meta text-muted-foreground sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="max-w-2xl space-y-1">
            <p className="text-ink">{t("auth.footer.human")}</p>
            <p>{t("landing.footer.gdpr")}</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label={t("landing.footer.links")}>
            <Link
              to="/privacy"
              className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("nav.privacy")}
            </Link>
            <Link
              to="/terms"
              className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("nav.terms")}
            </Link>
            <Link
              to="/status"
              className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("nav.status")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
