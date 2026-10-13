/** The live setup of this deployment and the processor's health; no secret is ever shown. */
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { getStatus } from "@/lib/platform/status.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/status")({
  loader: () => getStatus(),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: StatusPage,
});

function Row({ label, ok, note }: { label: string; ok: boolean | null; note?: string | null }) {
  const Icon = ok === null ? CircleDashed : ok ? CheckCircle2 : XCircle;
  const tone = ok === null ? "text-muted-foreground" : ok ? "text-positive" : "text-negative";
  return (
    <li className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-sm text-ink">{label}</span>
      <span className={`flex items-center gap-2 text-sm ${tone}`}>
        {note ? <span className="font-mono text-xs text-muted-foreground">{note}</span> : null}
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </li>
  );
}

function StatusPage() {
  const report = Route.useLoaderData();
  const { locale } = useI18n();
  const fr = locale === "fr";
  const { setup, processor } = report;
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <BrandMark size="md" className="mb-8" />
        <h1 className="font-display text-2xl text-ink">{fr ? "État du service" : "Service status"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fr ? "Ce que ce déploiement a de configuré. Aucune valeur n'est affichée." : "What this deployment has set up. No value is shown."}
        </p>
        <section className="sheet mt-6 px-5">
          <ul>
            <Row label={fr ? "Site (SITE_URL)" : "Site (SITE_URL)"} ok={setup.site} />
            <Row label={fr ? "Comptes (Supabase)" : "Accounts (Supabase)"} ok={setup.accounts} />
            <Row label={fr ? "Clé de service" : "Service key"} ok={setup.serviceKey} />
            <Row label={fr ? "Modèle" : "Model"} ok={setup.model.configured} note={setup.model.model} />
            <Row label={fr ? "Embeddings" : "Embeddings"} ok={setup.model.configured} note={setup.model.embeddingModel} />
            <Row label={fr ? "Email (Resend)" : "Email (Resend)"} ok={setup.email} />
            <Row label={fr ? "Limitation de débit" : "Rate limiting"} ok={setup.rateLimit} />
          </ul>
        </section>
        <h2 className="mt-8 font-display text-lg text-ink">{fr ? "Traitement des CV" : "CV processing"}</h2>
        <section className="sheet mt-3 px-5">
          <ul>
            <Row label={fr ? "Service configuré" : "Service configured"} ok={setup.processor} />
            <Row label={fr ? "Joignable" : "Reachable"} ok={processor.reachable} note={processor.version} />
            <Row label={fr ? "En bonne santé" : "Healthy"} ok={processor.reachable ? processor.ok : null} />
            <Row label={fr ? "Base de données" : "Database"} ok={processor.supabase} />
            <Row label={fr ? "Modèle" : "Model"} ok={processor.model} />
            <Row label="OCR" ok={processor.ocr} />
            <Row label={fr ? "File d'attente lue" : "Queue polled"} ok={processor.polling} />
          </ul>
        </section>
        <p className="mt-6 text-xs text-muted-foreground">
          {fr ? "Vérifié le" : "Checked at"} {new Date(report.checkedAt).toLocaleString(fr ? "fr-FR" : "en-GB")}
        </p>
      </div>
    </div>
  );
}
