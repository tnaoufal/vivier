/**
 * The first screen of a person with no space yet: one centred card
 * under the brand, the title, the working language, then two ways in.
 * "Je travaille seul" makes a personal space in one click, named after
 * the person (the profile's display name, else the email's local part
 * with a capital), and opens the dashboard; "Je crée une équipe"
 * reveals the team's name and its one button. A person who was invited
 * follows the link in their email instead. `standalone` is
 * /app/organizations/new, inside the plane: the team path alone, as one
 * column the route lays out, without the card.
 */
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, UserRound, UsersRound } from "lucide-react";

import { LocaleChips } from "@/components/app-shell/locale-chips";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import type { Locale, OrgKind } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
import { readProfile } from "@/lib/team/team";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** organizations.name takes 120 characters at most. */
const NAME_MAX = 120;

/** "Groupe Lumière RH" -> "groupe-lumiere-rh"; a short random tail keeps it unique. */
export function slugOf(
  name: string,
  salt: string = Math.random().toString(36).slice(2, 6),
): string {
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

/**
 * The name of a personal space: the person's display name, else the
 * local part of their email with a capital ("ana.lu@x.fr" -> "Ana.lu"),
 * else `fallback`; never longer than the database allows.
 */
export function personalSpaceName(
  displayName: string | null | undefined,
  email: string | null | undefined,
  fallback: string,
): string {
  const name = displayName?.trim();
  if (name) return name.slice(0, NAME_MAX);
  const local = email?.split("@")[0]?.trim() ?? "";
  if (!local) return fallback;
  return (local.charAt(0).toLocaleUpperCase() + local.slice(1)).slice(0, NAME_MAX);
}

type Busy = "personal" | "team" | null;

export function Onboarding({ standalone = false }: { standalone?: boolean }) {
  const { t, locale } = useI18n();
  const { refresh, switchOrg } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"choose" | "team">(standalone ? "team" : "choose");
  const [name, setName] = useState("");
  const [orgLocale, setOrgLocale] = useState<Locale>(locale);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const localeLabelId = useId();
  const nameId = useId();
  const errorId = useId();

  /** Writes the space; the id when it exists, the Postgres code (or null) when it was refused. */
  async function createSpace(
    spaceName: string,
    kind: OrgKind,
  ): Promise<{ orgId: string } | { refused: string | null }> {
    const supabase = await requireSupabase();
    const { data, error: rpcError } = await supabase.rpc("create_organization", {
      p_name: spaceName,
      p_slug: slugOf(spaceName),
      p_locale: orgLocale,
      p_kind: kind,
    });
    if (rpcError) {
      console.error(rpcError);
      return { refused: rpcError.code ?? null };
    }
    return { orgId: data as string };
  }

  /** The new space becomes the current one and the dashboard opens. */
  async function enter(orgId: string) {
    await refresh();
    switchOrg(orgId);
    toast.success(t("common.saved"));
    void navigate({ to: "/app" });
  }

  async function createPersonal() {
    if (busy) return;
    setBusy("personal");
    try {
      const supabase = await requireSupabase();
      // The profile may not be readable yet: the email alone still names the space.
      const profile = user
        ? await readProfile(supabase, user.id).catch((caught: unknown) => {
            console.error(caught);
            return null;
          })
        : null;
      const result = await createSpace(
        personalSpaceName(profile?.display_name, user?.email, t("nav.personalSpace")),
        "personal",
      );
      if ("refused" in result) {
        toast.error(t("common.error"));
        return;
      }
      await enter(result.orgId);
    } finally {
      setBusy(null);
    }
  }

  async function submitTeam(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy("team");
    setError(null);
    try {
      const result = await createSpace(trimmed, "team");
      if ("refused" in result) {
        setError(result.refused === "23505" ? t("onboarding.slugTaken") : t("common.error"));
        return;
      }
      await enter(result.orgId);
    } finally {
      setBusy(null);
    }
  }

  const localeField = (
    <div className="space-y-2">
      <Label id={localeLabelId}>{t("onboarding.locale")}</Label>
      <div role="group" aria-labelledby={localeLabelId}>
        <LocaleChips value={orgLocale} onChange={setOrgLocale} disabled={busy !== null} />
      </div>
    </div>
  );

  const nameField = (
    <div className="space-y-2">
      <Label htmlFor={nameId}>{t("onboarding.orgName")}</Label>
      <Input
        id={nameId}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError(null);
        }}
        placeholder={t("onboarding.orgName.placeholder")}
        maxLength={NAME_MAX}
        autoFocus
        required
        disabled={busy !== null}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-meta text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );

  const createTeam = (
    <Button
      type="submit"
      icon={<UsersRound />}
      className={cn(!standalone && "w-full")}
      disabled={busy !== null || !name.trim()}
    >
      {busy === "team" ? t("common.loading") : t("common.create")}
    </Button>
  );

  if (standalone) {
    return (
      <form onSubmit={submitTeam} className="w-full max-w-md space-y-6">
        {nameField}
        {localeField}
        <div>{createTeam}</div>
      </form>
    );
  }

  const alone = (
    <Button
      type="button"
      variant={mode === "team" ? "outline" : "primary"}
      icon={<UserRound />}
      className="w-full"
      onClick={() => void createPersonal()}
      disabled={busy !== null}
    >
      {busy === "personal" ? t("common.loading") : t("onboarding.alone")}
    </Button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="rise-in w-full max-w-md">
        <BrandMark size="md" className="mb-8 justify-center" to="/" />
        <form onSubmit={submitTeam} className="sheet p-6" aria-labelledby="onboarding-title">
          <h1 id="onboarding-title" className="font-display text-2xl text-ink">
            {t("onboarding.title")}
          </h1>
          <div className="mt-8 space-y-6">
            {localeField}
            {mode === "team" ? nameField : null}
          </div>
          {/* One filled button: the path the person is on; the other stays reachable in outline. */}
          <div className="mt-8 flex flex-col gap-3">
            {mode === "team" ? (
              <>
                {createTeam}
                {alone}
              </>
            ) : (
              <>
                {alone}
                <Button
                  type="button"
                  variant="outline"
                  icon={<UsersRound />}
                  className="w-full"
                  onClick={() => setMode("team")}
                  disabled={busy !== null}
                >
                  {t("onboarding.team")}
                </Button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
