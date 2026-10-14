/**
 * The first screen of a person with no organisation: create one (they
 * become its owner) or follow an invitation link. Also used by
 * /app/organizations/new. One centred card under the brand, the name
 * first, the working language, the one button.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

import { LocaleChips } from "@/components/app-shell/locale-chips";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSupabase } from "@/lib/auth/supabase-client";
import type { Locale } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { toast } from "@/lib/toast";

/** "Groupe Lumière RH" -> "groupe-lumiere-rh"; a short random tail keeps it unique. */
export function slugOf(name: string, salt: string = Math.random().toString(36).slice(2, 6)): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return `${base || "org"}-${salt}`;
}

export function Onboarding({ standalone = false }: { standalone?: boolean }) {
  const { t, locale } = useI18n();
  const { refresh, switchOrg } = useOrg();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [orgLocale, setOrgLocale] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = await requireSupabase();
      const { data, error: rpcError } = await supabase.rpc("create_organization", {
        p_name: trimmed,
        p_slug: slugOf(trimmed),
        p_locale: orgLocale,
      });
      if (rpcError) {
        console.error(rpcError);
        setError(rpcError.code === "23505" ? t("onboarding.slugTaken") : t("common.error"));
        return;
      }
      const orgId = data as string;
      await refresh();
      switchOrg(orgId);
      toast.success(t("common.saved"));
      void navigate({ to: "/app" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="rise-in w-full max-w-md">
        <BrandMark size="md" className="mb-8 justify-center" to={standalone ? "/app" : "/"} />
        <form onSubmit={submit} className="sheet p-6 sm:p-8" aria-labelledby="onboarding-title">
          <h1 id="onboarding-title" className="font-display text-2xl text-ink">
            {t("onboarding.title")}
          </h1>
          <p className="mt-2 text-body text-muted-foreground">{t("onboarding.text")}</p>
          <div className="mt-8 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="org-name">{t("onboarding.orgName")}</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={t("onboarding.orgName.placeholder")}
                maxLength={120}
                autoFocus
                required
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "org-name-error" : undefined}
              />
              {error ? (
                <p id="org-name-error" role="alert" className="text-meta text-negative">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>{t("onboarding.locale")}</Label>
              <LocaleChips value={orgLocale} onChange={setOrgLocale} disabled={busy} />
            </div>
          </div>
          <Button type="submit" className="mt-8 w-full" disabled={busy || !name.trim()}>
            {t("onboarding.create")}
          </Button>
        </form>
        {!standalone ? (
          <p className="mt-6 text-center text-meta text-muted-foreground">
            <span className="font-medium text-ink">{t("onboarding.pending")}</span> {t("onboarding.pending.help")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
