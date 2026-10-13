/**
 * Third step of the share dialog: the link, shown this once with a copy
 * button; the recipients as chips, an optional message, and the send,
 * which is off with a sentence when this deployment has no email
 * sender. The outcome names what left and what did not.
 */
import { useState, type KeyboardEvent } from "react";
import { Check, Copy, X } from "lucide-react";

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
  onSend,
  onClose,
}: {
  state: DialogState;
  dispatch: (action: DialogAction) => void;
  emailReady: boolean;
  onSend: () => void;
  onClose: () => void;
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

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="share-link">{t("shares.send.link")}</Label>
        <div className="flex gap-2">
          <Input id="share-link" value={share.url} readOnly onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={() => void copy()} className="shrink-0 gap-1.5">
            {copied ? <Check /> : <Copy />}
            {t("common.copy")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("shares.send.linkOnce")}</p>
        <p className="text-xs text-muted-foreground">{t("shares.send.expires", { date: formatDate(locale, share.expiresAt) })}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="share-recipient">{t("shares.send.recipients")}</Label>
        {state.recipients.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {state.recipients.map((email) => (
              <li key={email}>
                <Pill tone="primary" className="gap-1 pr-1">
                  {email}
                  <button
                    type="button"
                    className="inline-flex size-4 items-center justify-center rounded-full hover:bg-primary/15"
                    disabled={busy}
                    onClick={() => dispatch({ type: "removeRecipient", email })}
                    aria-label={t("shares.send.removeRecipient", { email })}
                  >
                    <X className="size-3" />
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
        <p className="text-xs text-muted-foreground">{t("shares.send.recipients.help", { max: RECIPIENTS_MAX })}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="share-message">{t("shares.send.message")}</Label>
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

      {!emailReady ? <p className="text-sm text-caution-foreground dark:text-caution">{t("shares.send.emailOff")}</p> : null}

      {sentSentence ? (
        <div className="rounded-xl bg-muted px-4 py-3 text-sm text-ink">
          <p>{sentSentence}</p>
          {outcome && outcome.failed.length ? (
            <p className="mt-1 text-negative">{t("shares.send.failed", { list: outcome.failed.join(", ") })}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{t("shares.send.sentNote")}</p>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("common.close")}
        </Button>
        <Button type="button" onClick={onSend} disabled={!emailReady || !canSend(state)}>
          {busy ? t("common.loading") : t("shares.send.send")}
        </Button>
      </DialogFooter>
    </div>
  );
}
