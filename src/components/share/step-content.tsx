/**
 * First step of the share dialog: which candidates go into the dossier
 * (the retained ones are ticked), the title, an introduction, whether
 * the CVs are included, when the link expires and, when this deployment
 * has a model, whether it drafts the syntheses. Laid out per the design
 * charter: the list scrolls inside the dialog, labels at 13px, fields
 * spaced evenly. The buttons are a component of their own so the dialog
 * can keep them below the scrolling box, in view whatever the height.
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

import { FIELD_LABEL } from "./field-label";

const STATUS_TONE: Record<ShortlistItemStatus, PillTone> = {
  to_review: "neutral",
  retained: "positive",
  dismissed: "negative",
};

/** The shortlist items that still have a candidate: the ones the list offers and the footer counts. */
export function presentItems(items: readonly ShareableItem[] | null): ShareableItem[] {
  return (items ?? []).filter((item) => item.candidates !== null);
}

export function ContentStep({
  state,
  dispatch,
  items,
  loading,
  error,
  capabilities,
}: {
  state: DialogState;
  dispatch: (action: DialogAction) => void;
  items: ShareableItem[] | null;
  loading: boolean;
  error: string | null;
  capabilities: ShareCapabilities | null;
}) {
  const t = useT();
  const busy = state.busy;
  const present = presentItems(items);

  let list: ReactNode;
  if (error) {
    list = <p className="text-sm text-negative">{t("shares.content.loadError")}</p>;
  } else if (loading && !items) {
    list = (
      <div className="space-y-2" aria-busy="true">
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-10 w-full rounded-xl" />
      </div>
    );
  } else if (!present.length) {
    list = <EmptyState icon={<Users />} title={t("shares.content.empty.title")} text={t("shares.content.empty.text")} />;
  } else {
    list = (
      <ul className="sheet max-h-[40vh] divide-y divide-border overflow-y-auto">
        {present.map((item) => {
          const candidate = item.candidates;
          const checked = state.selected.includes(item.candidate_id);
          return (
            <li key={item.id}>
              <label className="flex min-h-10 cursor-pointer items-center gap-3 px-4 py-2.5">
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
                    <span className="block truncate text-[13px] text-muted-foreground">{candidate.headline}</span>
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
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label className={FIELD_LABEL}>{t("shares.content.candidates")}</Label>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {t("shares.content.selected", { count: state.selected.length })}
          </span>
        </div>
        <p className="text-[13px] text-muted-foreground">{t("shares.content.candidates.help", { max: SHARE_ITEMS_MAX })}</p>
        {list}
      </section>

      <div className="space-y-2">
        <Label htmlFor="share-title" className={FIELD_LABEL}>
          {t("shares.content.title")}
        </Label>
        <Input
          id="share-title"
          value={state.title}
          maxLength={TITLE_MAX}
          disabled={busy}
          onChange={(event) => dispatch({ type: "setTitle", title: event.target.value })}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="share-intro" className={FIELD_LABEL}>
          {t("shares.content.intro")} <span className="font-normal">({t("common.optional")})</span>
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

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="flex min-h-10 cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-primary"
            checked={state.includeCvs}
            disabled={busy}
            onChange={(event) => dispatch({ type: "setIncludeCvs", value: event.target.checked })}
          />
          <span className="leading-6">{t("shares.content.includeCvs")}</span>
        </label>
        <div className="space-y-2">
          <Label htmlFor="share-expiry" className={FIELD_LABEL}>
            {t("shares.content.expiry")}
          </Label>
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
            className="mt-1 size-4 shrink-0 accent-primary"
            checked={state.useModel}
            disabled={busy}
            onChange={(event) => dispatch({ type: "setUseModel", value: event.target.checked })}
          />
          <span className="leading-6">
            {t("shares.content.useModel")}
            <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{t("shares.content.useModel.help")}</span>
          </span>
        </label>
      ) : capabilities ? (
        <p className="text-[13px] leading-5 text-muted-foreground">{t("shares.content.noModel")}</p>
      ) : null}
    </div>
  );
}

/** The one button of the first step, rendered by the dialog under the scrolling box. */
export function ContentFooter({
  state,
  items,
  loading,
  onPrepare,
}: {
  state: DialogState;
  items: ShareableItem[] | null;
  loading: boolean;
  onPrepare: () => void;
}) {
  const t = useT();
  return (
    <DialogFooter className="gap-2">
      <Button type="button" onClick={onPrepare} disabled={!canPrepare(state) || loading || !presentItems(items).length}>
        {state.busy ? t("common.loading") : t("shares.content.prepare")}
      </Button>
    </DialogFooter>
  );
}
