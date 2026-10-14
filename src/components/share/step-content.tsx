/**
 * First step of the share dialog: which candidates go into the dossier
 * (the retained ones are ticked, each row with the person's photo or
 * initials), the title, an introduction, then the options as rows of
 * one sheet: the CVs, when the link expires and, when this deployment
 * has a model, whether it drafts the syntheses. One sentence says the
 * dossier shows no photo. The buttons are a component of their own so
 * the dialog can keep them below the scrolling box.
 */
import type { ReactNode } from "react";
import { Users } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import type { ShortlistItemStatus } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org/org-context";
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

const CHECKBOX = "size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed";

/** The shortlist items that still have a candidate: the ones the list offers and the footer counts. */
export function presentItems(items: readonly ShareableItem[] | null): ShareableItem[] {
  return (items ?? []).filter((item) => item.candidates !== null);
}

/** One candidate to tick, with their photo or initials and their status on the shortlist. */
function CandidateChoice({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: ShareableItem;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const { showPhotos } = useOrg();
  const candidate = item.candidates;
  const name = candidate?.full_name?.trim() || t("shares.item.noName");
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos);
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 transition-colors duration-fast ease-out-soft hover:bg-muted/50">
      <input type="checkbox" className={CHECKBOX} checked={checked} disabled={disabled} onChange={onToggle} />
      <Avatar name={name} size="sm" photoUrl={photoUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{name}</span>
        {candidate?.headline ? (
          <span className="block truncate text-meta text-muted-foreground">{candidate.headline}</span>
        ) : null}
      </span>
      <Pill tone={STATUS_TONE[item.status]} dot size="sm">
        {t(`shares.item.status.${item.status}`)}
      </Pill>
    </label>
  );
}

/** A row of the options sheet: a control on the left, its help under it, a value on the right when it has one. */
function OptionRow({ children, control }: { children: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      {control ? <div className="shrink-0">{control}</div> : null}
    </div>
  );
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
      <div className="sheet overflow-hidden">
        <SkeletonRows rows={2} avatar={false} />
      </div>
    );
  } else if (!present.length) {
    list = (
      <EmptyState
        compact
        icon={<Users />}
        title={t("shares.content.empty.title")}
        text={t("shares.content.empty.text")}
      />
    );
  } else {
    list = (
      <ul className="sheet max-h-[40vh] divide-y divide-border overflow-y-auto">
        {present.map((item) => (
          <li key={item.id}>
            <CandidateChoice
              item={item}
              checked={state.selected.includes(item.candidate_id)}
              disabled={busy}
              onToggle={() => dispatch({ type: "toggleCandidate", candidateId: item.candidate_id })}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>{t("shares.content.candidates")}</Label>
          <span className="text-meta text-muted-foreground tabular-nums">
            {t("shares.content.selected", { count: state.selected.length })}
          </span>
        </div>
        <p className="text-meta text-muted-foreground">
          {t("shares.content.candidates.help", { max: SHARE_ITEMS_MAX })}
        </p>
        {list}
      </section>

      <div className="space-y-2">
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

      <div className="space-y-2">
        <Label htmlFor="share-intro">
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

      <section className="space-y-2">
        <Label>{t("shares.content.options")}</Label>
        <div className="sheet divide-y divide-border">
          <OptionRow>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                className={`${CHECKBOX} mt-1`}
                checked={state.includeCvs}
                disabled={busy}
                onChange={(event) => dispatch({ type: "setIncludeCvs", value: event.target.checked })}
              />
              <span>
                <span className="block font-medium leading-6">{t("shares.content.includeCvs")}</span>
                <span className="block text-meta text-muted-foreground">{t("shares.content.includeCvs.help")}</span>
              </span>
            </label>
          </OptionRow>
          <OptionRow
            control={
              <Select
                value={String(state.expiresInDays)}
                disabled={busy}
                onValueChange={(value) => {
                  const days = Number(value);
                  if (isExpiryDays(days)) dispatch({ type: "setExpiresInDays", days });
                }}
              >
                <SelectTrigger id="share-expiry" className="w-36" aria-label={t("shares.content.expiry")}>
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
            }
          >
            <Label htmlFor="share-expiry" className="font-medium text-ink">
              {t("shares.content.expiry")}
            </Label>
          </OptionRow>
          {capabilities?.model ? (
            <OptionRow>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  className={`${CHECKBOX} mt-1`}
                  checked={state.useModel}
                  disabled={busy}
                  onChange={(event) => dispatch({ type: "setUseModel", value: event.target.checked })}
                />
                <span>
                  <span className="block font-medium leading-6">{t("shares.content.useModel")}</span>
                  <span className="block text-meta text-muted-foreground">{t("shares.content.useModel.help")}</span>
                </span>
              </label>
            </OptionRow>
          ) : capabilities ? (
            <OptionRow>
              <p className="text-meta text-muted-foreground">{t("shares.content.noModel")}</p>
            </OptionRow>
          ) : null}
        </div>
        <p className="text-meta text-muted-foreground">{t("shares.content.noPhotos")}</p>
      </section>
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
    <DialogFooter>
      <Button
        type="button"
        onClick={onPrepare}
        disabled={!canPrepare(state) || loading || !presentItems(items).length}
      >
        {state.busy ? t("common.loading") : t("shares.content.prepare")}
      </Button>
    </DialogFooter>
  );
}
