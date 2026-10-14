/**
 * Organisation settings, for administrators and owners: the name, the
 * working language and the retention of candidates (CNIL: two years at
 * most) in one form; the candidates' photos switch, saved at once, with
 * the sentence that says why a team may turn it off; and for the owner
 * the deletion of the organisation behind a typed confirmation. The
 * plan and its meters live on the team page.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";

import { LocaleChips } from "@/components/app-shell/locale-chips";
import { PageHeader } from "@/components/app-shell/page-header";
import { Pill } from "@/components/app-shell/pill";
import { DeleteOrgDialog } from "@/components/team/delete-org-dialog";
import { NotAllowed } from "@/components/team/not-allowed";
import { Switch } from "@/components/team/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSupabase } from "@/lib/auth/supabase-client";
import type { Locale } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { readShowPhotos, useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { deleteOrganization, updateOrganization, updateShowPhotos } from "@/lib/team/team";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

const RETENTION_MIN = 1;
const RETENTION_MAX = 24;

/** The photos switch: saved the moment it is flipped, put back if the write fails. */
function PhotosCard({ orgId, initial, onSaved }: { orgId: string; initial: boolean; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const labelId = useId();
  const helpId = useId();
  const [shown, setShown] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setShown(initial);
  }, [initial, orgId]);

  async function toggle(next: boolean) {
    if (saving) return;
    setShown(next);
    setSaving(true);
    try {
      const supabase = await requireSupabase();
      await updateShowPhotos(supabase, orgId, next);
      toast.success(t("common.saved"));
      await onSaved();
    } catch (caught) {
      console.error(caught);
      setShown(!next);
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="sheet p-6 sm:p-8" aria-labelledby={labelId}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="font-display text-xl text-ink">{t("settings.photos")}</h2>
          <p id={labelId} className="mt-3 text-sm font-medium text-ink">
            {t("settings.photos.toggle")}
          </p>
          <p id={helpId} className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("settings.photos.help")}
          </p>
        </div>
        <div className="-mt-1.5 flex shrink-0 flex-col items-end gap-1">
          <Switch checked={shown} onCheckedChange={(next) => void toggle(next)} disabled={saving} aria-labelledby={labelId} aria-describedby={helpId} />
          <span className="text-meta text-muted-foreground" aria-live="polite">
            {shown ? t("settings.photos.on") : t("settings.photos.off")}
          </span>
        </div>
      </div>
    </section>
  );
}

function SettingsPage() {
  const { t } = useI18n();
  const { org } = useCurrentOrg();
  const { can, refresh } = useOrg();
  const navigate = useNavigate();
  const localeLabelId = useId();
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

  if (!allowed) {
    return (
      <>
        <PageHeader eyebrow={org.name} title={t("nav.settings")} description={t("settings.subtitle")} />
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
    } catch (caught) {
      console.error(caught);
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
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={t("nav.settings")}
        description={t("settings.subtitle")}
        meta={
          <Pill tone="primary" dot>
            {t(`shell.org.plan.${org.plan}`)}
          </Pill>
        }
        actions={
          <Button asChild variant="ghost">
            <Link to="/app/members">{t("members.plan.manage")}</Link>
          </Button>
        }
      />

      <div className="space-y-8">
        <form onSubmit={save} className="sheet p-6 sm:p-8" aria-labelledby="settings-org-title">
          <h2 id="settings-org-title" className="font-display text-xl text-ink">
            {t("settings.org")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.org.help")}</p>
          <div className="mt-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="org-name">{t("common.name")}</Label>
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required disabled={saving} className="max-w-md" />
            </div>
            <div className="space-y-2">
              <Label id={localeLabelId}>{t("onboarding.locale")}</Label>
              <div role="group" aria-labelledby={localeLabelId}>
                <LocaleChips value={orgLocale} onChange={setOrgLocale} disabled={saving} />
              </div>
            </div>
            <div className="space-y-2">
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
                aria-invalid={monthsValid ? undefined : true}
                aria-describedby="org-retention-help"
              />
              <p id="org-retention-help" className="max-w-2xl text-meta text-muted-foreground">
                {t("settings.retention.help", { months: monthsValid ? months : org.retention_months })}
              </p>
            </div>
          </div>
          <div className="mt-8">
            <Button type="submit" disabled={saving || !name.trim() || !monthsValid}>
              {t("common.save")}
            </Button>
          </div>
        </form>

        <PhotosCard orgId={org.id} initial={readShowPhotos(org)} onSaved={refresh} />

        <section className="sheet border-negative/40 p-6 sm:p-8" aria-labelledby="settings-danger-title">
          <h2 id="settings-danger-title" className="font-display text-xl text-negative">
            {t("settings.danger")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("settings.danger.text")}</p>
          {owner ? (
            <Button
              variant="outline"
              icon={<Trash2 />}
              className="mt-6 border-negative/40 text-negative hover:bg-negative/10 hover:text-negative"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              {t("settings.delete")}
            </Button>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{t("settings.danger.ownerOnly")}</p>
          )}
        </section>
      </div>

      <DeleteOrgDialog open={deleteOpen} onOpenChange={setDeleteOpen} orgName={org.name} busy={deleting} onConfirm={confirmDelete} />
    </>
  );
}
