/**
 * First step of the share dialog: which candidates go into the
 * presentation (the retained ones are ticked), the title, an
 * introduction, whether the CVs are included, when the link expires and,
 * when this deployment has a model, whether it drafts the summaries.
 */
import type { ReactNode } from "react";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { canPrepare, INTRO_MAX, TITLE_MAX, type DialogAction, type DialogState } from "@/lib/shares/dialog-state";
import { SHARE_ITEMS_MAX } from "@/lib/shares/draft";
import type { ShareableItem } from "@/lib/shares/queries";
import type { ShareCapabilities } from "@/lib/shares/shares.functions";
import { EXPIRY_CHOICES, isExpiryDays } from "@/lib/shares/state";

const STATUS_TONE: Record<ShortlistItemStatus, PillTone> = {
  to_review: "neutral",
  retained: "positive",
  dismissed: "negative",
};

export function ContentStep({
  state,
  dispatch,
  items,
  loading,
  error,
  capabilities,
  onPrepare,
}: {
  state: DialogState;
  dispatch: (action: DialogAction) => void;
  items: ShareableItem[] | null;
  loading: boolean;
  error: string | null;
  capabilities: ShareCapabilities | null;
  onPrepare: () => void;
}) {
  const t = useT();
  const busy = state.busy;
  const present = (items ?? []).filter((item) => item.candidates !== null);

  let list: ReactNode;
  if (error) {
    list = <p className="text-sm text-negative">{t("shares.content.loadError")}</p>;
  } else if (loading && !items) {
    list = (
      <div className="space-y-2" aria-busy="true">
        <div className="skeleton h-9 w-full rounded-xl" />
        <div className="skeleton h-9 w-full rounded-xl" />
      </div>
    );
  } else if (!present.length) {
    list = <EmptyState icon={<Users />} title={t("shares.content.empty.title")} text={t("shares.content.empty.text")} />;
  } else {
    list = (
      <ul className="sheet divide-y divide-border">
        {present.map((item) => {
          const candidate = item.candidates;
          const checked = state.selected.includes(item.candidate_id);
          return (
            <li key={item.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={checked}
                  disabled={busy}
                  onChange={() => dispatch({ type: "toggleCandidate", candidateId: item.candidate_id })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {candidate?.full_name?.trim() || t("shares.item.noName")}
                  </span>
                  {candidate?.headline ? (
                    <span className="block truncate text-xs text-muted-foreground">{candidate.headline}</span>
                  ) : null}
                </span>
                <Pill tone={STATUS_TONE[item.status]}>{t(`shares.item.status.${item.status}`)}</Pill>
              </label>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>{t("shares.content.candidates")}</Label>
          <span className="text-xs text-muted-foreground">{t("shares.content.selected", { count: state.selected.length })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t("shares.content.candidates.help", { max: SHARE_ITEMS_MAX })}</p>
        {list}
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="share-title">{t("shares.content.title")}</Label>
        <Input
          id="share-title"
          value={state.title}
          maxLength={TITLE_MAX}
          disabled={busy}
          onChange={(event) => dispatch({ type: "setTitle", title: event.target.value })}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="share-intro">
          {t("shares.content.intro")} <span className="font-normal text-muted-foreground">({t("common.optional")})</span>
        </Label>
        <Textarea
          id="share-intro"
          value={state.intro}
          maxLength={INTRO_MAX}
          rows={3}
          disabled={busy}
          placeholder={t("shares.content.intro.placeholder")}
          onChange={(event) => dispatch({ type: "setIntro", intro: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={state.includeCvs}
            disabled={busy}
            onChange={(event) => dispatch({ type: "setIncludeCvs", value: event.target.checked })}
          />
          <span>{t("shares.content.includeCvs")}</span>
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="share-expiry">{t("shares.content.expiry")}</Label>
          <Select
            value={String(state.expiresInDays)}
            disabled={busy}
            onValueChange={(value) => {
              const days = Number(value);
              if (isExpiryDays(days)) dispatch({ type: "setExpiresInDays", days });
            }}
          >
            <SelectTrigger id="share-expiry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_CHOICES.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {t("shares.content.expiry.days", { days })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {capabilities?.model ? (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={state.useModel}
            disabled={busy}
            onChange={(event) => dispatch({ type: "setUseModel", value: event.target.checked })}
          />
          <span>
            {t("shares.content.useModel")}
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("shares.content.useModel.help")}</span>
          </span>
        </label>
      ) : capabilities ? (
        <p className="text-xs text-muted-foreground">{t("shares.content.noModel")}</p>
      ) : null}

      <DialogFooter>
        <Button type="button" onClick={onPrepare} disabled={!canPrepare(state) || loading || !present.length}>
          {busy ? t("common.loading") : t("shares.content.prepare")}
        </Button>
      </DialogFooter>
    </div>
  );
}
