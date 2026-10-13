/**
 * The landing page: what Vivier does, in the person's language, with the
 * promise that no decision is made by a machine. Signed-in visitors go
 * straight to the app.
 */
import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileSearch, Mail, Shield, Users } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const COPY = {
  fr: {
    hero: "Trouvez, en équipe, les bons profils dans votre vivier.",
    lead: "Importez vos CV, décrivez le poste, obtenez une liste classée et expliquée, décidez ensemble, puis envoyez une présentation soignée au manager. Rien n'est décidé par une machine.",
    cta: "Commencer",
    signIn: "Se connecter",
    features: [
      { icon: <FileSearch />, title: "Des CV lus pour de bon", text: "Chaque PDF devient une fiche structurée : poste, compétences, langues, expériences, avec un niveau de confiance par champ. Ce qui n'est pas écrit reste non renseigné." },
      { icon: <Users />, title: "Une shortlist à plusieurs", text: "Commentaires, votes, statuts, attribution à un collègue : tout se passe en direct, et l'historique dit qui a décidé quoi." },
      { icon: <Mail />, title: "Un dossier prêt à envoyer", text: "Une page de présentation professionnelle, les CV retenus en pièces consultables, un lien qui expire. Envoyée par email en un clic." },
      { icon: <Shield />, title: "RGPD par défaut", text: "Durée de conservation réglée par organisation, purge automatique, export et effacement d'un candidat à la demande, journal d'audit complet." },
    ],
    footer: "Le modèle de langage structure et explique ; chaque décision reste humaine et tracée.",
  },
  en: {
    hero: "Find the right profiles in your talent pool, as a team.",
    lead: "Upload your CVs, describe the role, get a ranked and explained list, decide together, then send a polished presentation to the hiring manager. Nothing is decided by a machine.",
    cta: "Get started",
    signIn: "Sign in",
    features: [
      { icon: <FileSearch />, title: "CVs read for real", text: "Every PDF becomes a structured profile: role, skills, languages, experience, with a confidence level per field. What is not written stays not stated." },
      { icon: <Users />, title: "A shortlist built together", text: "Comments, votes, statuses, assignment to a colleague: everything happens live, and the history says who decided what." },
      { icon: <Mail />, title: "A file ready to send", text: "A professional presentation page, the retained CVs viewable inline, a link that expires. Sent by email in one click." },
      { icon: <Shield />, title: "GDPR by default", text: "Retention period set per organisation, automatic purge, export and erasure of a candidate on request, a complete audit log." },
    ],
    footer: "The language model structures and explains; every decision stays human and traceable.",
  },
} as const;

function LandingPage() {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const copy = COPY[locale];

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/app", replace: true });
  }, [loading, navigate, user]);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <BrandMark size="md" />
        <div className="flex items-center gap-1">
          <LocaleToggle />
          <ThemeToggle />
          <Button asChild variant="outline" size="sm" className="ml-2">
            <Link to="/sign-in">{copy.signIn}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <section className="py-16 sm:py-24">
          <p className="label-caps">{BRAND.tagline[locale]}</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight text-ink sm:text-6xl">
            <span className="brand-text">{copy.hero}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{copy.lead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/sign-in">{copy.cta}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/status">{t("nav.status")}</Link>
            </Button>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          {copy.features.map((feature) => (
            <article key={feature.title} className="sheet p-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-5">
                {feature.icon}
              </div>
              <h2 className="font-display text-lg text-ink">{feature.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{feature.text}</p>
            </article>
          ))}
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span>{copy.footer}</span>
          <span className="flex gap-4">
            <Link to="/privacy" className="hover:underline">{locale === "fr" ? "Confidentialité" : "Privacy"}</Link>
            <Link to="/terms" className="hover:underline">{locale === "fr" ? "Conditions" : "Terms"}</Link>
            <Link to="/status" className="hover:underline">{t("nav.status")}</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
