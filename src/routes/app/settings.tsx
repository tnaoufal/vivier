/**
 * Organisation settings, for administrators and owners: the name, the
 * working language, the retention of candidates (CNIL: two years at
 * most), the read-only plan card, and for the owner the deletion of the
 * organisation behind a typed confirmation.
 */
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell/page-header";
import { DeleteOrgDialog } from "@/components/team/delete-org-dialog";
import { NotAllowed } from "@/components/team/not-allowed";
import { PlanCard } from "@/components/team/plan-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import type { Locale } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { deleteOrganization, readCvsProcessedThisMonth, readSeatsUsed, updateOrganization } from "@/lib/team/team";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

const RETENTION_MIN = 1;
const RETENTION_MAX = 24;

function SettingsPage() {
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { can, refresh } = useOrg();
  const navigate = useNavigate();
  const allowed = can("admin");
  const owner = can("owner");

  const [name, setName] = useState(org.name);
  const [orgLocale, setOrgLocale] = useState<Locale>(org.locale);
  const [retention, setRetention] = useState(String(org.retention_months));
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(org.name);
    setOrgLocale(org.locale);
    setRetention(String(org.retention_months));
  }, [org.id, org.locale, org.name, org.retention_months]);

  const usage = useQuery(
    `settings-usage:${org.id}`,
    async () => {
      const supabase = await requireSupabase();
      const read = (run: Promise<number>) =>
        run.catch((error: unknown) => {
          console.error(error);
          return null;
        });
      const [seatsUsed, cvsProcessed] = await Promise.all([
        read(readSeatsUsed(supabase, org.id)),
        read(readCvsProcessedThisMonth(supabase, org.id)),
      ]);
      return { seatsUsed, cvsProcessed };
    },
    allowed,
  );

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("nav.settings")} description={t("settings.subtitle")} />
        <NotAllowed text={t("settings.notAllowed")} />
      </>
    );
  }

  const months = Number.parseInt(retention, 10);
  const monthsValid = Number.isInteger(months) && months >= RETENTION_MIN && months <= RETENTION_MAX;

  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (saving || !trimmed || !monthsValid) return;
    setSaving(true);
    try {
      const supabase = await requireSupabase();
      await updateOrganization(supabase, org.id, { name: trimmed, locale: orgLocale, retention_months: months });
      toast.success(t("common.saved"));
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const supabase = await requireSupabase();
      await deleteOrganization(supabase, org.id);
      setDeleteOpen(false);
      toast.success(t("settings.deleted"));
      await refresh();
      void navigate({ to: "/app" });
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader title={t("nav.settings")} description={t("settings.subtitle")} />

      <div className="space-y-6">
        <form onSubmit={save} className="sheet p-4 sm:p-5">
          <h2 className="font-display text-lg text-ink">{t("settings.org")}</h2>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">{t("common.name")}</Label>
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("onboarding.locale")}</Label>
              <div className="flex gap-2">
                {(["fr", "en"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={orgLocale === value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setOrgLocale(value)}
                    className="uppercase"
                    disabled={saving}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-retention">{t("settings.retention")}</Label>
              <Input
                id="org-retention"
                type="number"
                inputMode="numeric"
                min={RETENTION_MIN}
                max={RETENTION_MAX}
                step={1}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                className="w-32"
                required
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.retention.help", { months: monthsValid ? months : org.retention_months })}
              </p>
            </div>
          </div>
          <Button type="submit" className="mt-5" disabled={saving || !name.trim() || !monthsValid}>
            {t("common.save")}
          </Button>
        </form>

        <PlanCard
          org={org}
          seatsUsed={usage.data?.seatsUsed ?? null}
          cvsProcessed={usage.data?.cvsProcessed ?? null}
          loading={usage.loading}
        />

        <section className="sheet border-negative/40 p-4 sm:p-5">
          <h2 className="font-display text-lg text-negative">{t("settings.danger")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.danger.text")}</p>
          {owner ? (
            <Button variant="destructive" className="mt-4" onClick={() => setDeleteOpen(true)} disabled={deleting}>
              {t("settings.delete")}
            </Button>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t("settings.danger.ownerOnly")}</p>
          )}
        </section>
      </div>

      <DeleteOrgDialog open={deleteOpen} onOpenChange={setDeleteOpen} orgName={org.name} busy={deleting} onConfirm={confirmDelete} />
    </>
  );
}
