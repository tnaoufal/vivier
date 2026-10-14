/**
 * Third step of the share dialog: the link, shown this once with a copy
 * button and the date it expires; the recipients as chips, an optional
 * message, and the send, which is off with a sentence when this
 * deployment has no email sender. The outcome names what left and what
 * did not, and is announced to assistive technologies. The buttons are a
 * component of their own that the dialog keeps below the scrolling box.
 */
import { useState, type KeyboardEvent } from "react";
import { Check, Copy, X } from "lucide-react";

import { InfoTip } from "@/components/app-shell/info-tip";
import { Pill } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, useI18n } from "@/lib/i18n";
import { canSend, RECIPIENTS_MAX, type DialogAction, type DialogState } from "@/lib/shares/dialog-state";
import { MESSAGE_MAX } from "@/lib/shares/email";
import { toast } from "@/lib/toast";

export function SendStep({
  state,
  dispatch,
  emailReady,
}: {
  state: DialogState;
  dispatch: (action: DialogAction) => void;
  emailReady: boolean;
}) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const busy = state.busy;
  const share = state.share;
  if (!share) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(share?.url ?? "");
      setCopied(true);
      toast(t("common.copied"));
    } catch (error) {
      console.error(error);
      toast.error(t("shares.send.copyFailed"));
    }
  }

  function onRecipientKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      dispatch({ type: "commitRecipients" });
    }
  }

  const outcome = state.outcome;
  const sentSentence =
    outcome === null
      ? null
      : outcome.sent === 0
        ? t("shares.send.sent.none")
        : outcome.sent === 1
          ? t("shares.send.sent.one")
          : t("shares.send.sent.many", { count: outcome.sent });
  const failedSentence =
    outcome && outcome.failed.length ? t("shares.send.failed", { list: outcome.failed.join(", ") }) : null;

  return (
    <div className="space-y-6">
      {/* Mounted with the step (and out of the flow), so the outcome of a send is announced when it arrives. */}
      <p className="sr-only" role="status">
        {[sentSentence, failedSentence].filter(Boolean).join(" ")}
      </p>
      <div className="space-y-2">
        <Label htmlFor="share-link">{t("shares.send.link")}</Label>
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
        <p className="text-meta text-muted-foreground">{t("shares.send.linkOnce")}</p>
        <p className="text-meta text-muted-foreground">
          {t("shares.send.expires", { date: formatDate(locale, share.expiresAt) })}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="share-recipient">{t("shares.send.recipients")}</Label>
          <InfoTip label={t("shares.send.recipients")}>
            {t("shares.send.recipients.help", { max: RECIPIENTS_MAX })}
          </InfoTip>
        </div>
        {state.recipients.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {state.recipients.map((email) => (
              <li key={email}>
                <Pill tone="primary" className="gap-1 pr-1">
                  {email}
                  <button
                    type="button"
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={busy}
                    onClick={() => dispatch({ type: "removeRecipient", email })}
                    aria-label={t("shares.send.removeRecipient", { email })}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Pill>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          id="share-recipient"
          type="text"
          inputMode="email"
          autoComplete="off"
          value={state.recipientDraft}
          disabled={busy || !emailReady || state.recipients.length >= RECIPIENTS_MAX}
          placeholder={t("shares.send.recipients.placeholder")}
          onChange={(event) => dispatch({ type: "setRecipientDraft", value: event.target.value })}
          onKeyDown={onRecipientKey}
          onBlur={() => dispatch({ type: "commitRecipients" })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="share-message">
          {t("shares.send.message")} <span className="font-normal">({t("common.optional")})</span>
        </Label>
        <Textarea
          id="share-message"
          value={state.message}
          maxLength={MESSAGE_MAX}
          rows={3}
          disabled={busy || !emailReady}
          placeholder={t("shares.send.message.placeholder")}
          onChange={(event) => dispatch({ type: "setMessage", value: event.target.value })}
        />
      </div>

      {!emailReady ? (
        <p className="rounded-lg bg-caution/10 px-4 py-3 text-sm text-caution-foreground dark:text-caution">
          {t("shares.send.emailOff")}
        </p>
      ) : null}

      {sentSentence ? (
        <div className="fade-in rounded-lg bg-muted/50 px-4 py-3 text-sm text-ink">
          <p className="font-medium">{sentSentence}</p>
          {failedSentence ? <p className="mt-1 text-negative">{failedSentence}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Close, or send the emails: rendered by the dialog under the scrolling box; nothing before the link exists. */
export function SendFooter({
  state,
  emailReady,
  onSend,
  onClose,
}: {
  state: DialogState;
  emailReady: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!state.share) return null;
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={state.busy}>
        {t("common.close")}
      </Button>
      <Button type="button" onClick={onSend} disabled={!emailReady || !canSend(state)}>
        {state.busy ? t("common.loading") : t("shares.send.send")}
      </Button>
    </DialogFooter>
  );
}
