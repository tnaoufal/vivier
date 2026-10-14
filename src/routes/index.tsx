/**
 * The landing page: the brand, one promise and two buttons in the hero,
 * three feature cards, how it works in three steps, and a footer with
 * the sentence that no decision is made by a machine. Each block rises
 * in once; signed-in visitors go straight to the app.
 */
import { useEffect, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FileSearch, Mail, Users } from "lucide-react";

import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { BRAND } from "@/lib/brand";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const FEATURES: { key: "read" | "team" | "send"; icon: ReactNode }[] = [
  { key: "read", icon: <FileSearch /> },
  { key: "team", icon: <Users /> },
  { key: "send", icon: <Mail /> },
];

const STEPS: readonly ("step1" | "step2" | "step3")[] = ["step1", "step2", "step3"];

function featureKey(key: "read" | "team" | "send", part: "title" | "text"): TranslationKey {
  return `landing.feature.${key}.${part}`;
}

function stepKey(step: "step1" | "step2" | "step3", part: "title" | "text"): TranslationKey {
  return `landing.how.${step}.${part}`;
}

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
          <Button asChild variant="ghost" className="ml-2 hidden sm:inline-flex">
            <Link to="/sign-in">{t("auth.signIn")}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 sm:px-8 lg:px-10">
        <section className="stagger py-16 text-center sm:py-24">
          <p className="rise-in inline-flex items-center rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-meta font-medium text-primary">
            {t("landing.eyebrow")}
          </p>
          <h1 className="rise-in mx-auto mt-6 max-w-3xl font-display text-4xl leading-[1.08] text-ink break-words sm:text-6xl">
            <span className="brand-text">{t("landing.hero")}</span>
          </h1>
          <p className="rise-in mx-auto mt-6 max-w-2xl text-lg leading-7 text-muted-foreground">{t("landing.lead")}</p>
          <div className="rise-in mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" icon={<ArrowRight />}>
              <Link to="/sign-in">{t("landing.cta")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/sign-in">{t("auth.signIn")}</Link>
            </Button>
          </div>
          <p className="rise-in mx-auto mt-8 max-w-xl text-meta text-muted-foreground">{BRAND.tagline[locale]}</p>
        </section>

        <section className="stagger grid gap-6 md:grid-cols-3" aria-label={t("landing.how.title")}>
          {FEATURES.map((feature) => (
            <article key={feature.key} className="sheet rise-in p-6">
              <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
                <span aria-hidden="true" className="inline-flex">
                  {feature.icon}
                </span>
              </div>
              <h2 className="text-base font-semibold leading-6 text-ink">{t(featureKey(feature.key, "title"))}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t(featureKey(feature.key, "text"))}</p>
            </article>
          ))}
        </section>

        <section className="mt-24 sm:mt-32" aria-labelledby="landing-how-title">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="landing-how-title" className="font-display text-2xl text-ink sm:text-3xl">
              {t("landing.how.title")}
            </h2>
            <p className="mt-3 text-body text-muted-foreground">{t("landing.how.text")}</p>
          </div>
          <ol className="stagger relative mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {/* The line the three steps sit on, from md. */}
            <span aria-hidden="true" className="absolute left-[calc(16.6667%+1.25rem)] right-[calc(16.6667%+1.25rem)] top-5 hidden h-px bg-border md:block" />
            {STEPS.map((step, index) => (
              <li key={step} className="rise-in relative flex flex-col items-start gap-4 md:items-center md:text-center">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-background font-display text-base text-primary tabular-nums shadow-hairline">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold leading-6 text-ink">{t(stepKey(step, "title"))}</h3>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t(stepKey(step, "text"))}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex justify-center">
            <Button asChild variant="outline" size="lg">
              <Link to="/sign-in">{t("landing.cta")}</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-meta text-muted-foreground sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="max-w-2xl space-y-1">
            <p className="text-ink">{t("landing.footer.human")}</p>
            <p>{t("landing.footer.gdpr")}</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label={t("landing.footer.links")}>
            <Link to="/privacy" className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("nav.privacy")}
            </Link>
            <Link to="/terms" className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("nav.terms")}
            </Link>
            <Link to="/status" className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("nav.status")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
