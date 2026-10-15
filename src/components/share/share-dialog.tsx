/**
 * Sharing a shortlist in one step: a checklist of its candidates (the
 * retained ones ticked), the addresses the link goes to and a message
 * for them (both optional, and off when this deployment has no email
 * sender), one filled "Partager". Behind that click the server drafts
 * the sheets from the profiles and the reading the shortlist stores,
 * creates the share (its link shown this once), then emails it when
 * addresses were given. On success the dialog shows the link with a
 * copy button and says to how many it was sent; the link is also kept
 * for this browser session so the panel under the board can copy it
 * again. The state lives in a pure reducer (lib/shares/dialog-state.ts).
 */
import { useEffect, useReducer, useState } from "react";
import { Check, CircleAlert, Copy, Users } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { usePhotoUrl } from "@/lib/candidates/use-photo-url";
import { useQuery } from "@/lib/data/use-query";
import { formatDate, useI18n } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import {
  RECIPIENTS_MAX,
  canShare,
  dialogReducer,
  initialState,
  recipientsProblem,
  recipientsToSend,
  shareTitleOf,
  type DialogState,
} from "@/lib/shares/dialog-state";
import { cleanItems } from "@/lib/shares/draft";
import { MESSAGE_MAX } from "@/lib/shares/email";
import { rememberLink, sessionLinkStore } from "@/lib/shares/link-memory";
import { listShareableItems, type ShareableItem } from "@/lib/shares/queries";
import {
  createShare,
  draftShare,
  sendShare,
  shareCapabilities,
} from "@/lib/shares/shares.functions";
import { DEFAULT_EXPIRY_DAYS } from "@/lib/shares/state";
import { toast } from "@/lib/toast";

const CHECKBOX = "size-4 shrink-0 cursor-pointer accent-ink disabled:cursor-not-allowed";

/** True when a thrown error carries this code in its message ("SHARE:inactive"). */
function errorSays(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(code);
}

/** One candidate to tick, with their photo or initials, their name and their position. */
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
  const { t } = useI18n();
  const { showPhotos } = useOrg();
  const candidate = item.candidates;
  const name = candidate?.full_name?.trim() || t("shares.item.noName");
  const photoUrl = usePhotoUrl(candidate?.photo_path ?? null, showPhotos);
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 transition-colors duration-fast ease-out-soft hover:bg-muted/50">
      <input
        type="checkbox"
        className={CHECKBOX}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <Avatar name={name} size="sm" photoUrl={photoUrl} decorative />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{name}</span>
        {candidate?.headline ? (
          <span className="block truncate text-meta text-muted-foreground">
            {candidate.headline}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** The link, shown this once, and what left by email. */
function Done({ state }: { state: DialogState }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const share = state.share;
  if (!share) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(share?.url ?? "");
      setCopied(true);
      toast(t("common.copied"));
    } catch (error) {
      console.error(error);
      toast.error(t("shares.dialog.copyFailed"));
    }
  }

  const outcome = state.outcome;
  const sentSentence =
    outcome === null
      ? null
      : outcome.sent === 0
        ? t("shares.dialog.sent.none")
        : outcome.sent === 1
          ? t("shares.dialog.sent.one")
          : t("shares.dialog.sent.many", { count: outcome.sent });
  const failedSentence =
    outcome && outcome.failed.length
      ? t("shares.dialog.failed", { list: outcome.failed.join(", ") })
      : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="share-link">{t("shares.dialog.link")}</Label>
        <div className="flex gap-2">
          <Input
            id="share-link"
            value={share.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs md:text-xs"
          />
          <Button
            type="button"
            variant="outline"
            icon={copied ? <Check /> : <Copy />}
            onClick={() => void copy()}
            className="shrink-0"
          >
            {t("common.copy")}
          </Button>
        </div>
        <p className="text-meta text-muted-foreground">
          {t("shares.dialog.expires", { date: formatDate(locale, share.expiresAt) })}
        </p>
      </div>
      {/* Announced when it arrives: the outcome of a send is the one thing the person waits for. */}
      {sentSentence ? (
        <div role="status" className="fade-in space-y-1 text-sm text-ink">
          <p className="font-medium">{sentSentence}</p>
          {failedSentence ? (
            <p className="flex items-start gap-1.5">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{failedSentence}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ShareDialog({
  shortlistId,
  briefTitle,
  open,
  onOpenChange,
}: {
  shortlistId: string;
  /** The dossier's title. */
  briefTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const [state, dispatch] = useReducer(dialogReducer, undefined, initialState);
  const [emailReady, setEmailReady] = useState(false);
  const [session, setSession] = useState(0);

  // Each opening starts over: fresh items, fresh capabilities.
  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset" });
    setSession((value) => value + 1);
    let cancelled = false;
    void (async () => {
      try {
        const answer = await shareCapabilities({ data: { ...(await withToken()), orgId: org.id } });
        if (!cancelled) setEmailReady(answer.email);
      } catch (error) {
        // Without an answer the dialog offers no email: the link still works.
        console.error(error);
        if (!cancelled) setEmailReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, org.id]);

  const shareable = useQuery(
    `shareable:${org.id}:${shortlistId}:${session}`,
    async () => listShareableItems(await requireSupabase(), org.id, shortlistId),
    open && session > 0,
  );
  const present = (shareable.data ?? []).filter((item) => item.candidates !== null);

  // The retained candidates are ticked once the items arrive.
  useEffect(() => {
    if (!shareable.data) return;
    dispatch({
      type: "setSelected",
      candidateIds: shareable.data
        .filter((item) => item.status === "retained" && item.candidates)
        .map((item) => item.candidate_id),
    });
  }, [shareable.data]);

  async function share() {
    if (!canShare(state, emailReady)) return;
    dispatch({ type: "setBusy", value: true });
    const recipients = recipientsToSend(state, emailReady);
    try {
      // The sheets as the shortlist stores them: the profiles and the reading, nothing to review.
      const drafted = await draftShare({
        data: {
          ...(await withToken()),
          orgId: org.id,
          shortlistId,
          candidateIds: state.selected,
          useModel: false,
        },
      });
      const created = await createShare({
        data: {
          ...(await withToken()),
          orgId: org.id,
          shortlistId,
          title: shareTitleOf(briefTitle, t("shares.dialog.title")),
          intro: "",
          items: cleanItems(drafted.items),
          includeCvs: true,
          expiresInDays: DEFAULT_EXPIRY_DAYS,
        },
      });
      rememberLink(sessionLinkStore(), created.shareId, created.url);
      dispatch({ type: "created", share: created });
      toast.success(t("shares.created"));
      if (!recipients.length) {
        dispatch({ type: "setBusy", value: false });
        return;
      }
      const outcome = await sendShare({
        data: {
          ...(await withToken()),
          orgId: org.id,
          shareId: created.shareId,
          url: created.url,
          recipients,
          message: state.message.trim(),
        },
      });
      dispatch({ type: "sent", outcome });
    } catch (error) {
      console.error(error);
      if (errorSays(error, "SHARE:inactive")) toast.error(t("shares.dialog.inactive"));
      else toast.error(errorMessage(locale, error));
      dispatch({ type: "failed" });
    }
  }

  const problem = emailReady ? recipientsProblem(state.recipients) : null;
  const count = state.selected.length;
  const busy = state.busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex flex-col gap-5" aria-describedby={undefined}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("shares.dialog.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="py-1">
          {state.share ? (
            <Done state={state} />
          ) : (
            <div className="space-y-6">
              <section className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Label>{t("shares.dialog.candidates")}</Label>
                  <span role="status" className="text-meta text-muted-foreground tabular-nums">
                    {count === 1
                      ? t("shares.dialog.selected.one")
                      : t("shares.dialog.selected.many", { count })}
                  </span>
                </div>
                {shareable.error ? (
                  <p className="flex items-start gap-1.5 text-sm text-ink" role="alert">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {t("shares.dialog.loadError")}
                  </p>
                ) : shareable.loading && !shareable.data ? (
                  <div className="sheet overflow-hidden">
                    <SkeletonRows rows={2} avatarSize="sm" />
                  </div>
                ) : !present.length ? (
                  <EmptyState compact icon={<Users />} title={t("shares.dialog.empty")} />
                ) : (
                  <ul className="sheet stagger max-h-[40vh] divide-y divide-border overflow-y-auto">
                    {present.map((item) => (
                      <li key={item.id} className="rise-in">
                        <CandidateChoice
                          item={item}
                          checked={state.selected.includes(item.candidate_id)}
                          disabled={busy}
                          onToggle={() =>
                            dispatch({ type: "toggleCandidate", candidateId: item.candidate_id })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {emailReady ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="share-recipients">
                      {t("shares.dialog.recipients")}{" "}
                      <span className="font-normal">({t("common.optional")})</span>
                    </Label>
                    <Input
                      id="share-recipients"
                      type="text"
                      inputMode="email"
                      autoComplete="off"
                      value={state.recipients}
                      disabled={busy}
                      placeholder={t("shares.dialog.recipients.placeholder")}
                      aria-invalid={problem !== null}
                      aria-describedby={problem ? "share-recipients-problem" : undefined}
                      onChange={(event) =>
                        dispatch({ type: "setRecipients", value: event.target.value })
                      }
                    />
                    {problem ? (
                      <p
                        id="share-recipients-problem"
                        className="flex items-start gap-1.5 text-meta text-ink"
                      >
                        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        {problem === "invalid"
                          ? t("shares.dialog.recipients.invalid")
                          : t("shares.dialog.recipients.max", { max: RECIPIENTS_MAX })}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="share-message">
                      {t("shares.dialog.message")}{" "}
                      <span className="font-normal">({t("common.optional")})</span>
                    </Label>
                    <Textarea
                      id="share-message"
                      value={state.message}
                      maxLength={MESSAGE_MAX}
                      rows={3}
                      disabled={busy}
                      placeholder={t("shares.dialog.message.placeholder")}
                      onChange={(event) =>
                        dispatch({ type: "setMessage", value: event.target.value })
                      }
                    />
                  </div>
                </>
              ) : (
                <p className="text-meta text-muted-foreground">{t("shares.dialog.emailOff")}</p>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="shrink-0">
          {state.share ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("common.close")}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void share()}
              disabled={!canShare(state, emailReady) || shareable.loading || !present.length}
            >
              {busy ? t("common.loading") : t("shares.dialog.share")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
