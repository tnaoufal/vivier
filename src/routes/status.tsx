/**
 * The live setup of this deployment and the processor's health, as two
 * cards of rows under the public frame: each row a name, an optional
 * public note (a model's name, a version) and a pill that says
 * operational, missing or not checked in words and an icon, never a
 * colour alone. One line sums it up; no secret is ever shown.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, CircleDashed, RefreshCw, X } from "lucide-react";

import { Pill } from "@/components/app-shell/pill";
import { Section } from "@/components/app-shell/section";
import { PublicFrame } from "@/components/public-frame";
import { Button } from "@/components/ui/button";
import { formatDateTime, useI18n, type TranslationKey } from "@/lib/i18n";
import { getStatus } from "@/lib/platform/status.functions";

export const Route = createFileRoute("/status")({
  loader: () => getStatus(),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: StatusPage,
});

interface Probe {
  label: TranslationKey;
  ok: boolean | null;
  note?: string | null | undefined;
}

function StatePill({ ok }: { ok: boolean | null }) {
  const { t } = useI18n();
  if (ok === null) {
    return (
      <Pill tone="neutral" icon={<CircleDashed />}>
        {t("status.unknown")}
      </Pill>
    );
  }
  return ok ? (
    <Pill tone="positive" icon={<Check />}>
      {t("status.ok")}
    </Pill>
  ) : (
    <Pill tone="negative" icon={<X />}>
      {t("status.missing")}
    </Pill>
  );
}

function Rows({ checks }: { checks: Probe[] }) {
  const { t } = useI18n();
  return (
    <ul className="sheet stagger overflow-hidden">
      {checks.map((check) => (
        <li key={check.label} className="sheet-row rise-in">
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{t(check.label)}</span>
          {check.note ? <span className="hidden max-w-48 truncate font-mono text-xs text-muted-foreground sm:block">{check.note}</span> : null}
          <StatePill ok={check.ok} />
        </li>
      ))}
    </ul>
  );
}

function StatusPage() {
  const report = Route.useLoaderData();
  const router = useRouter();
  const { locale, t } = useI18n();
  const { setup, processor } = report;

  const setupChecks: Probe[] = [
    { label: "status.row.site", ok: setup.site },
    { label: "status.row.accounts", ok: setup.accounts },
    { label: "status.row.serviceKey", ok: setup.serviceKey },
    { label: "status.row.model", ok: setup.model.configured, note: setup.model.model },
    { label: "status.row.embeddings", ok: setup.model.configured, note: setup.model.embeddingModel },
    { label: "status.row.email", ok: setup.email },
    { label: "status.row.rateLimit", ok: setup.rateLimit },
  ];
  const processorChecks: Probe[] = [
    { label: "status.row.processor", ok: setup.processor },
    { label: "status.row.reachable", ok: processor.reachable, note: processor.version },
    { label: "status.row.healthy", ok: processor.reachable ? processor.ok : null },
    { label: "status.row.database", ok: processor.supabase },
    { label: "status.row.model", ok: processor.model },
    { label: "status.row.ocr", ok: processor.ocr },
    { label: "status.row.polling", ok: processor.polling },
  ];
  const issues = [...setupChecks, ...processorChecks].filter((check) => check.ok === false).length;
  const summary =
    issues === 0 ? t("status.summary.ok") : issues === 1 ? t("status.summary.issues.one") : t("status.summary.issues.many", { count: issues });

  return (
    <PublicFrame width="md">
      <div className="rise-in">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-2xl text-ink sm:text-3xl">{t("status.title")}</h1>
            <p className="mt-2 max-w-2xl text-body text-muted-foreground">{t("status.subtitle")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill tone={issues === 0 ? "positive" : "negative"} icon={issues === 0 ? <Check /> : <X />}>
                {summary}
              </Pill>
              <span className="text-meta text-muted-foreground tabular-nums">
                {t("status.checkedAt", { date: formatDateTime(locale, report.checkedAt) })}
              </span>
            </div>
          </div>
          <Button variant="outline" icon={<RefreshCw />} onClick={() => void router.invalidate()} className="shrink-0">
            {t("status.refresh")}
          </Button>
        </header>
        <div className="mt-10 space-y-10">
          <Section title={t("status.setup")}>
            <Rows checks={setupChecks} />
          </Section>
          <Section title={t("status.processing")}>
            <Rows checks={processorChecks} />
          </Section>
        </div>
      </div>
    </PublicFrame>
  );
}
