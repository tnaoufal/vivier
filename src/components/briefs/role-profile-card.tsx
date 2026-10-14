/**
 * The role profile of a brief: the understanding of the job a senior
 * recruiter writes before reading a CV, as one card between the brief
 * and its criteria that reads like a document. Read mode shows each
 * field as a labelled block (first what the brief does not state and
 * the model assumed, for the team to confirm before a CV is read; then
 * the domain, the level and the years as three facts, the missions, the
 * equivalent titles, the adjacent profiles, the context in four short
 * values, the must-haves, the nice-to-haves, the success factors, the
 * interview points) and who wrote it; "Modifier" turns the blocks into
 * fields in place (one item per line for the lists) saved as one update
 * under RLS; "Régénérer" asks the model to write it again from the
 * brief, after a confirmation since the team's edits go with it. A brief
 * without a profile says so, and that the first analysis writes it.
 * Nothing here decides anything: the profile is what every screening
 * reads.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleHelp, Pencil, Sparkles } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { regenerateRoleProfile } from "@/lib/briefs/briefs.functions";
import { updateBrief } from "@/lib/briefs/queries";
import {
  cleanRoleProfile,
  emptyRoleProfile,
  guardRoleProfile,
  isSeniority,
  ROLE_PROFILE_ITEM_MAX,
  ROLE_PROFILE_LIST_MAX,
  ROLE_PROFILE_TEXT_MAX,
  ROLE_SENIORITIES,
  ROLE_YEARS_MAX,
  seniorityKey,
} from "@/lib/briefs/role-profile";
import type { BriefRow, RoleProfile, RoleSeniority } from "@/lib/db/types";
import { formatDate, useI18n, useT } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import type { ModelAvailability } from "./criteria-proposals";

/** The fields as the editor holds them: texts, and the lists as one item per line. */
interface Draft {
  assumptions: string;
  domain: string;
  seniority: RoleSeniority;
  yearsMin: string;
  yearsMax: string;
  missions: string;
  equivalentTitles: string;
  adjacentProfiles: string;
  sector: string;
  product: string;
  clients: string;
  scope: string;
  mustHaves: string;
  niceToHaves: string;
  successFactors: string;
  questions: string;
}

type ListField =
  | "assumptions"
  | "missions"
  | "equivalentTitles"
  | "adjacentProfiles"
  | "mustHaves"
  | "niceToHaves"
  | "successFactors"
  | "questions";
type ContextField = "sector" | "product" | "clients" | "scope";

const CONTEXT_FIELDS: readonly ContextField[] = ["sector", "product", "clients", "scope"];

function draftOf(profile: RoleProfile): Draft {
  return {
    assumptions: profile.assumptions.join("\n"),
    domain: profile.domain,
    seniority: profile.seniority,
    yearsMin: profile.yearsMin === null ? "" : String(profile.yearsMin),
    yearsMax: profile.yearsMax === null ? "" : String(profile.yearsMax),
    missions: profile.missions.join("\n"),
    equivalentTitles: profile.equivalentTitles.join("\n"),
    adjacentProfiles: profile.adjacentProfiles.join("\n"),
    sector: profile.context.sector ?? "",
    product: profile.context.product ?? "",
    clients: profile.context.clients ?? "",
    scope: profile.context.scope ?? "",
    mustHaves: profile.mustHaves.join("\n"),
    niceToHaves: profile.niceToHaves.join("\n"),
    successFactors: profile.successFactors.join("\n"),
    questions: profile.questions.join("\n"),
  };
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function years(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The profile a draft saves: cleaned like any other, with the title, the author and the date of the one it edits. */
function profileOf(draft: Draft, base: RoleProfile): RoleProfile {
  return cleanRoleProfile(
    {
      title: base.title,
      assumptions: lines(draft.assumptions),
      domain: draft.domain,
      seniority: draft.seniority,
      yearsMin: years(draft.yearsMin),
      yearsMax: years(draft.yearsMax),
      missions: lines(draft.missions),
      equivalentTitles: lines(draft.equivalentTitles),
      adjacentProfiles: lines(draft.adjacentProfiles),
      context: {
        sector: draft.sector,
        product: draft.product,
        clients: draft.clients,
        scope: draft.scope,
      },
      mustHaves: lines(draft.mustHaves),
      niceToHaves: lines(draft.niceToHaves),
      successFactors: lines(draft.successFactors),
      questions: lines(draft.questions),
      model: base.model,
      createdAt: base.createdAt,
    },
    { title: base.title, model: base.model, createdAt: base.createdAt },
  );
}

/** One labelled block of the document. */
function Block({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="label-caps">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** A text the profile holds, or "not stated" in muted text: a blank field is never shown as a dash. */
function Text({ value }: { value: string | null }) {
  const t = useT();
  return value ? (
    <p className="text-body text-ink break-words">{value}</p>
  ) : (
    <p className="text-body text-muted-foreground">{t("common.unknown")}</p>
  );
}

function List({ items }: { items: readonly string[] }) {
  if (!items.length) return <Text value={null} />;
  return (
    <ul className="space-y-1 text-body text-ink">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="mt-[11px] size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
          />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function RoleProfileCard({
  brief,
  canEdit,
  modelAvailable,
  onSaved,
}: {
  brief: BriefRow;
  canEdit: boolean;
  modelAvailable: ModelAvailability;
  onSaved: () => Promise<void> | void;
}) {
  const { t, locale } = useI18n();
  const profile = brief.role_profile;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A fresh row (a colleague's edit, the first analysis) closes an editor
  // that was not touched yet; typed changes stay until saved or cancelled.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setDraft(null);
  }, [brief.id, brief.updated_at]);

  const editing = draft !== null;
  const locked = !canEdit || busy || regenerating;

  function startEditing() {
    touched.current = false;
    setDraft(draftOf(profile ?? emptyRoleProfile(brief.title)));
  }

  function closeEditor() {
    touched.current = false;
    setDraft(null);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    touched.current = true;
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!draft || locked) return;
    setBusy(true);
    try {
      const base = profile ?? emptyRoleProfile(brief.title);
      const { profile: next, dropped } = guardRoleProfile(profileOf(draft, base));
      await updateBrief(await requireSupabase(), brief.org_id, brief.id, { role_profile: next });
      if (dropped > 0) toast(t("briefs.profile.protected", { count: dropped }));
      toast.success(t("briefs.profile.saved"));
      closeEditor();
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (locked) return;
    setRegenerating(true);
    try {
      await regenerateRoleProfile({
        data: { ...(await withToken()), orgId: brief.org_id, briefId: brief.id },
      });
      setConfirmOpen(false);
      closeEditor();
      toast(t("briefs.profile.regenerated"));
      await onSaved();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setRegenerating(false);
    }
  }

  const regenerateButton =
    canEdit && modelAvailable === true ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={<Sparkles />}
        onClick={() => (profile ? setConfirmOpen(true) : void regenerate())}
        disabled={locked || editing}
      >
        {regenerating
          ? t("briefs.profile.regenerate.busy")
          : profile
            ? t("briefs.profile.regenerate")
            : t("briefs.profile.generate")}
      </Button>
    ) : null;

  function yearsText(current: RoleProfile): string | null {
    if (current.yearsMin !== null && current.yearsMax !== null)
      return t("briefs.profile.years.range", { min: current.yearsMin, max: current.yearsMax });
    if (current.yearsMin !== null) return t("briefs.profile.years.from", { min: current.yearsMin });
    if (current.yearsMax !== null) return t("briefs.profile.years.upTo", { max: current.yearsMax });
    return null;
  }

  function readView(current: RoleProfile) {
    return (
      <div className="fade-in space-y-6">
        {current.assumptions.length ? (
          <div className="border-l-2 border-caution/60 pl-4">
            <p className="label-caps flex items-center gap-1.5">
              <CircleHelp aria-hidden="true" className="size-3.5 shrink-0" />
              {t("briefs.profile.assumptions")}
            </p>
            <p className="mt-0.5 text-meta text-muted-foreground">
              {t("briefs.profile.assumptions.help")}
            </p>
            <div className="mt-2">
              <List items={current.assumptions} />
            </div>
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="label-caps">{t("briefs.profile.domain")}</dt>
            <dd className="mt-1">
              <Text value={current.domain || null} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label-caps">{t("briefs.profile.seniority")}</dt>
            <dd className="mt-1">
              <Text value={t(seniorityKey(current.seniority))} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label-caps">{t("briefs.profile.years")}</dt>
            <dd className="mt-1">
              <Text value={yearsText(current)} />
            </dd>
          </div>
        </dl>
        <Block label={t("briefs.profile.missions")}>
          <List items={current.missions} />
        </Block>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
          <Block label={t("briefs.profile.equivalentTitles")}>
            <List items={current.equivalentTitles} />
          </Block>
          <Block label={t("briefs.profile.adjacentProfiles")}>
            <List items={current.adjacentProfiles} />
          </Block>
        </div>
        <Block label={t("briefs.profile.context")}>
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-1">
            {CONTEXT_FIELDS.map((field) => (
              <div key={field} className="flex min-w-0 gap-2 text-body">
                <dt className="w-24 shrink-0 text-muted-foreground">
                  {t(`briefs.profile.context.${field}`)}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 break-words",
                    current.context[field] ? "text-ink" : "text-muted-foreground",
                  )}
                >
                  {current.context[field] ?? t("common.unknown")}
                </dd>
              </div>
            ))}
          </dl>
        </Block>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
          <Block label={t("briefs.profile.mustHaves")}>
            <List items={current.mustHaves} />
          </Block>
          <Block label={t("briefs.profile.niceToHaves")}>
            <List items={current.niceToHaves} />
          </Block>
        </div>
        <Block label={t("briefs.profile.successFactors")}>
          <List items={current.successFactors} />
        </Block>
        <Block label={t("briefs.profile.questions")}>
          <List items={current.questions} />
        </Block>
        <p className="text-meta text-muted-foreground">
          {current.model
            ? t("briefs.profile.by.model", { date: formatDate(locale, current.createdAt) })
            : t("briefs.profile.by.team")}
        </p>
      </div>
    );
  }

  function listField(field: ListField, current: Draft) {
    return (
      <div key={field} className="space-y-2">
        <Label htmlFor={`role-profile-${field}`}>{t(`briefs.profile.${field}`)}</Label>
        <Textarea
          id={`role-profile-${field}`}
          value={current[field]}
          onChange={(event) => set(field, event.target.value)}
          rows={field === "missions" ? 5 : 3}
          maxLength={ROLE_PROFILE_LIST_MAX * (ROLE_PROFILE_ITEM_MAX + 1) * 2}
          disabled={locked}
          className="min-h-0"
        />
      </div>
    );
  }

  function editView(current: Draft) {
    return (
      <div className="fade-in space-y-5">
        <p className="text-meta text-muted-foreground">{t("briefs.profile.list.help")}</p>
        {listField("assumptions", current)}
        <div className="space-y-2">
          <Label htmlFor="role-profile-domain">{t("briefs.profile.domain")}</Label>
          <Input
            id="role-profile-domain"
            value={current.domain}
            onChange={(event) => set("domain", event.target.value)}
            maxLength={ROLE_PROFILE_TEXT_MAX}
            disabled={locked}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-profile-seniority">{t("briefs.profile.seniority")}</Label>
            <Select
              value={current.seniority}
              onValueChange={(value) => {
                if (isSeniority(value)) set("seniority", value);
              }}
              disabled={locked}
            >
              <SelectTrigger id="role-profile-seniority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_SENIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(seniorityKey(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-profile-years-min">{t("briefs.profile.years")}</Label>
            <div className="flex gap-3">
              <Input
                id="role-profile-years-min"
                type="number"
                inputMode="numeric"
                min={0}
                max={ROLE_YEARS_MAX}
                value={current.yearsMin}
                onChange={(event) => set("yearsMin", event.target.value)}
                placeholder={t("briefs.profile.years.min")}
                aria-label={t("briefs.profile.years.min")}
                disabled={locked}
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={ROLE_YEARS_MAX}
                value={current.yearsMax}
                onChange={(event) => set("yearsMax", event.target.value)}
                placeholder={t("briefs.profile.years.max")}
                aria-label={t("briefs.profile.years.max")}
                disabled={locked}
              />
            </div>
          </div>
        </div>
        {listField("missions", current)}
        {listField("equivalentTitles", current)}
        {listField("adjacentProfiles", current)}
        <div className="space-y-2">
          <span className="label-caps">{t("briefs.profile.context")}</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {CONTEXT_FIELDS.map((field) => (
              <Input
                key={field}
                value={current[field]}
                onChange={(event) => set(field, event.target.value)}
                placeholder={t(`briefs.profile.context.${field}`)}
                aria-label={t(`briefs.profile.context.${field}`)}
                maxLength={ROLE_PROFILE_TEXT_MAX}
                disabled={locked}
              />
            ))}
          </div>
          <p className="text-meta text-muted-foreground">{t("briefs.profile.context.help")}</p>
        </div>
        {listField("mustHaves", current)}
        {listField("niceToHaves", current)}
        {listField("successFactors", current)}
        {listField("questions", current)}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={closeEditor} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void save()} disabled={locked}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="sheet space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{t("briefs.profile.title")}</h2>
          <p className="mt-1 text-meta text-muted-foreground">{t("briefs.profile.help")}</p>
        </div>
        {canEdit && !editing ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<Pencil />}
              onClick={startEditing}
              disabled={locked}
            >
              {t("common.edit")}
            </Button>
            {regenerateButton}
          </div>
        ) : null}
      </div>
      {draft ? (
        editView(draft)
      ) : profile ? (
        readView(profile)
      ) : (
        <div className="space-y-1">
          <p className="text-body text-muted-foreground">{t("briefs.profile.none")}</p>
          <p className="text-meta text-muted-foreground">
            {modelAvailable === false
              ? t("briefs.profile.none.noModel")
              : t("briefs.profile.none.text")}
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("briefs.profile.regenerate.title")}
        text={t("briefs.profile.regenerate.text")}
        confirmLabel={t("briefs.profile.regenerate")}
        busy={regenerating}
        onConfirm={regenerate}
      />
    </section>
  );
}
