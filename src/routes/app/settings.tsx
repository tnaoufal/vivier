/**
 * The settings on the plane: one pane, the content in a column, three
 * sections under label-caps titles and no sheet. The space, for
 * administrators and owners (titled "Équipe" or "Espace personnel"):
 * the name, the working language, the retention of candidates (CNIL:
 * two years at most, the rule behind an info icon, an error line only
 * when the value is out of range) and the candidates' photos switch,
 * saved at once. My account, for everyone: the display name, the
 * language (saved at once), the theme (applied at once) and the
 * password behind a small dialog, which opens by itself after a reset
 * link. The header's one filled button saves the fields of both. The
 * danger zone: leaving the team (not a personal space, whose one member
 * is its owner), deleting the space (the owner, behind a typed
 * confirmation) and deleting the account, each behind a confirmation
 * that states its consequence.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, CircleAlert, KeyRound, LogOut, Moon, Sun, Trash2, UserRoundX } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { InfoTip } from "@/components/app-shell/info-tip";
import { LocaleChips } from "@/components/app-shell/locale-chips";
import { PHONE_ICON, Pane, Workspace } from "@/components/app-shell/workspace";
import { DeleteOrgDialog } from "@/components/team/delete-org-dialog";
import { PasswordDialog } from "@/components/team/password-dialog";
import { Switch } from "@/components/team/switch";
import { useTheme } from "@/components/theme-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import type { Locale } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import {
  isPersonal,
  memberName,
  readShowPhotos,
  useCurrentOrg,
  useOrg,
} from "@/lib/org/org-context";
import {
  deleteOrganization,
  errorSays,
  readProfile,
  removeMember,
  updateOrganization,
  updateProfile,
  updateShowPhotos,
} from "@/lib/team/team";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

const RETENTION_MIN = 1;
const RETENTION_MAX = 24;

/** The photos switch: saved the moment it is flipped, put back if the write fails. */
function PhotosRow({
  orgId,
  initial,
  onSaved,
}: {
  orgId: string;
  initial: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const labelId = useId();
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
    <div className="flex items-center justify-between gap-6">
      <div className="flex min-w-0 items-center gap-2">
        <span id={labelId} className="text-sm font-medium text-ink">
          {t("settings.photos")}
        </span>
        <InfoTip label={t("settings.photos")}>{t("settings.photos.help")}</InfoTip>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-meta text-muted-foreground" aria-live="polite">
          {shown ? t("settings.photos.on") : t("settings.photos.off")}
        </span>
        <Switch
          checked={shown}
          onCheckedChange={(next) => void toggle(next)}
          disabled={saving}
          aria-labelledby={labelId}
        />
      </div>
    </div>
  );
}

function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { org } = useCurrentOrg();
  const { can, refresh } = useOrg();
  const { user, passwordRecovery, clearPasswordRecovery, updatePassword, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const formId = useId();
  const orgLocaleLabelId = useId();
  const myLocaleLabelId = useId();
  const admin = can("admin");
  const owner = can("owner");
  const personal = isPersonal(org);
  const userId = user?.id ?? "";
  const email = user?.email ?? "";

  const profile = useQuery(
    `profile:${userId}`,
    async () => readProfile(await requireSupabase(), userId),
    Boolean(userId),
  );

  const [name, setName] = useState(org.name);
  const [orgLocale, setOrgLocale] = useState<Locale>(org.locale);
  const [retention, setRetention] = useState(String(org.retention_months));
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingLocale, setSavingLocale] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleteOrgOpen, setDeleteOrgOpen] = useState(false);
  const [deletingOrg, setDeletingOrg] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // One field per effect: the row is live, so a value changed elsewhere replaces that field
  // alone, never another one being edited here; another space replaces them all.
  useEffect(() => {
    setName(org.name);
  }, [org.id, org.name]);
  useEffect(() => {
    setOrgLocale(org.locale);
  }, [org.id, org.locale]);
  useEffect(() => {
    setRetention(String(org.retention_months));
  }, [org.id, org.retention_months]);

  useEffect(() => {
    if (profile.data) setDisplayName(profile.data.display_name ?? "");
  }, [profile.data]);

  // After a reset link the password is what the person came for: the dialog opens by itself.
  useEffect(() => {
    if (passwordRecovery) setPasswordOpen(true);
  }, [passwordRecovery]);

  const months = Number.parseInt(retention, 10);
  const monthsValid =
    Number.isInteger(months) && months >= RETENTION_MIN && months <= RETENTION_MAX;
  const savedLocale: Locale = profile.data?.locale ?? locale;
  const shownName = memberName(profile.data ?? undefined, email.split("@")[0] ?? "");
  const canSave = !saving && !profile.loading && (!admin || (name.trim() !== "" && monthsValid));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !userId) return;
    setSaving(true);
    try {
      const supabase = await requireSupabase();
      if (admin) {
        await updateOrganization(supabase, org.id, {
          name: name.trim(),
          locale: orgLocale,
          retention_months: months,
        });
      }
      await updateProfile(supabase, userId, { display_name: displayName.trim() || null });
      toast.success(t("common.saved"));
      await Promise.all([profile.refresh(), refresh()]);
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function chooseLocale(next: Locale) {
    if (savingLocale || !userId || next === savedLocale) return;
    setSavingLocale(true);
    try {
      const supabase = await requireSupabase();
      await updateProfile(supabase, userId, { locale: next });
      setLocale(next);
      await profile.refresh();
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setSavingLocale(false);
    }
  }

  async function confirmLeave() {
    if (leaving || !userId) return;
    setLeaving(true);
    try {
      const supabase = await requireSupabase();
      await removeMember(supabase, org.id, userId);
      setLeaveOpen(false);
      toast.success(t("members.left"));
      await refresh();
      void navigate({ to: "/app" });
    } catch (caught) {
      console.error(caught);
      toast.error(errorSays(caught, "ORG:last_owner") ? t("members.lastOwner") : t("common.error"));
    } finally {
      setLeaving(false);
    }
  }

  async function confirmDeleteOrg() {
    if (deletingOrg) return;
    setDeletingOrg(true);
    try {
      const supabase = await requireSupabase();
      await deleteOrganization(supabase, org.id);
      setDeleteOrgOpen(false);
      toast.success(t("settings.deleted"));
      await refresh();
      void navigate({ to: "/app" });
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setDeletingOrg(false);
    }
  }

  async function confirmDeleteAccount() {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      const supabase = await requireSupabase();
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
      setDeleteAccountOpen(false);
      toast.success(t("account.deleted"));
      try {
        await signOut();
      } catch (caught) {
        // The account is gone: a refused sign-out changes nothing.
        console.error(caught);
      }
      void navigate({ to: "/" });
    } catch (caught) {
      console.error(caught);
      toast.error(t("common.error"));
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <Workspace
      title={t("nav.settings")}
      actions={
        <Button
          type="submit"
          form={formId}
          icon={<Check />}
          disabled={!canSave}
          aria-label={t("common.save")}
          className={PHONE_ICON}
        >
          <span className="max-sm:sr-only">{t("common.save")}</span>
        </Button>
      }
    >
      <Pane label={t("nav.settings")} width="fill" bodyClassName="p-4 sm:p-6">
        <div className="max-w-3xl space-y-8">
          <form id={formId} onSubmit={save} className="space-y-8">
            {admin ? (
              <section aria-labelledby="settings-org-title" className="space-y-6">
                <h2 id="settings-org-title" className="label-caps">
                  {personal ? t("nav.personalSpace") : t("nav.members")}
                </h2>
                <div className="space-y-2">
                  <Label htmlFor="org-name">{t("common.name")}</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                    disabled={saving}
                    className="max-w-md"
                  />
                </div>
                <div className="space-y-2">
                  <Label id={orgLocaleLabelId}>{t("onboarding.locale")}</Label>
                  <div role="group" aria-labelledby={orgLocaleLabelId}>
                    <LocaleChips value={orgLocale} onChange={setOrgLocale} disabled={saving} />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="org-retention">{t("settings.retention")}</Label>
                    <InfoTip label={t("settings.retention")}>
                      {t("settings.retention.help", {
                        months: monthsValid ? months : org.retention_months,
                      })}
                    </InfoTip>
                  </div>
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
                    aria-describedby={monthsValid ? undefined : "org-retention-error"}
                  />
                  {monthsValid ? null : (
                    <p
                      id="org-retention-error"
                      role="alert"
                      className="fade-in flex items-start gap-1.5 text-meta text-ink"
                    >
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {t("settings.retention.range", { min: RETENTION_MIN, max: RETENTION_MAX })}
                    </p>
                  )}
                </div>
                <PhotosRow orgId={org.id} initial={readShowPhotos(org)} onSaved={refresh} />
              </section>
            ) : null}

            <section aria-labelledby="settings-account-title" className="space-y-6">
              <div className="flex items-center gap-4">
                {/* The name is in the field below: the avatar is not read a second time. */}
                <Avatar name={shownName} size="lg" decorative />
                <div className="min-w-0">
                  <h2 id="settings-account-title" className="label-caps">
                    {t("settings.account")}
                  </h2>
                  <p className="truncate text-meta text-muted-foreground">{email}</p>
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="account-name">{t("account.displayName")}</Label>
                  <Input
                    id="account-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={120}
                    autoComplete="name"
                    disabled={saving || profile.loading}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label id={myLocaleLabelId}>{t("account.locale")}</Label>
                  <div role="group" aria-labelledby={myLocaleLabelId}>
                    <LocaleChips
                      value={savedLocale}
                      onChange={(next) => void chooseLocale(next)}
                      disabled={savingLocale || profile.loading}
                    />
                  </div>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label>{t("common.theme")}</Label>
                  <Segmented
                    value={theme}
                    onChange={setTheme}
                    aria-label={t("common.theme")}
                    options={[
                      { value: "light", label: t("common.theme.light"), icon: <Sun /> },
                      { value: "dark", label: t("common.theme.dark"), icon: <Moon /> },
                    ]}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label>{t("auth.password")}</Label>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<KeyRound />}
                      onClick={() => setPasswordOpen(true)}
                    >
                      {t("account.password.change")}
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </form>

          <section aria-labelledby="settings-danger-title" className="space-y-6">
            <h2 id="settings-danger-title" className="label-caps">
              {t("settings.danger")}
            </h2>
            <div className="flex flex-wrap gap-3">
              {/* The one member of a personal space is its owner: the database would refuse their leaving. */}
              {personal ? null : (
                <Button
                  type="button"
                  variant="outline"
                  icon={<LogOut />}
                  onClick={() => setLeaveOpen(true)}
                  disabled={leaving}
                >
                  {t("members.leave")}
                </Button>
              )}
              {owner ? (
                <Button
                  type="button"
                  variant="outline"
                  icon={<Trash2 />}
                  onClick={() => setDeleteOrgOpen(true)}
                  disabled={deletingOrg}
                >
                  {t("settings.delete")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                icon={<UserRoundX />}
                onClick={() => setDeleteAccountOpen(true)}
                disabled={deletingAccount}
              >
                {t("account.danger")}
              </Button>
            </div>
          </section>
        </div>
      </Pane>

      <PasswordDialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open && passwordRecovery) clearPasswordRecovery();
        }}
        lead={passwordRecovery}
        onSubmit={async (password) => {
          const result = await updatePassword(password);
          if (result.error) {
            toast.error(result.error);
            return false;
          }
          toast.success(t("auth.newPassword.set"));
          clearPasswordRecovery();
          return true;
        }}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t("members.leave.title", { org: org.name })}
        text={t("members.leave.text")}
        confirmLabel={t("members.leave")}
        destructive
        busy={leaving}
        onConfirm={confirmLeave}
      />

      <DeleteOrgDialog
        open={deleteOrgOpen}
        onOpenChange={setDeleteOrgOpen}
        orgName={org.name}
        busy={deletingOrg}
        onConfirm={confirmDeleteOrg}
      />

      <ConfirmDialog
        open={deleteAccountOpen}
        onOpenChange={setDeleteAccountOpen}
        title={t("account.delete.title")}
        text={t("account.delete.text")}
        confirmLabel={t("common.delete")}
        destructive
        busy={deletingAccount}
        onConfirm={confirmDeleteAccount}
      />
    </Workspace>
  );
}
