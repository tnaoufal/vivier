/**
 * Sharing a shortlist in one dialog and three steps, marked by a
 * stepper: the content (which candidates, title, intro, CVs, expiry,
 * the model or not), the review of every sheet (the assessment read
 * only, the prose editable, each sheet folded until opened), then the
 * link and the emails. The state lives in a pure reducer
 * (lib/shares/dialog-state.ts); the server functions do the reading of
 * profiles and of the shortlist's analysis, the model call, the share
 * row and the emails. Opened from the shortlist board by members. The
 * header and the stepper stay in place; the step scrolls; the step's
 * buttons sit under it so the main action never scrolls away.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { Check } from "lucide-react";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { dialogReducer, initialState, STEPS, stepStatus, type Step } from "@/lib/shares/dialog-state";
import { cleanItems } from "@/lib/shares/draft";
import { listShareableItems } from "@/lib/shares/queries";
import {
  createShare,
  draftShare,
  sendShare,
  shareCapabilities,
  type ShareCapabilities,
} from "@/lib/shares/shares.functions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { ContentFooter, ContentStep } from "./step-content";
import { ReviewFooter, ReviewStep } from "./step-review";
import { SendFooter, SendStep } from "./step-send";

const STEP_KEYS: Record<Step, "shares.step.content" | "shares.step.review" | "shares.step.send"> = {
  content: "shares.step.content",
  review: "shares.step.review",
  send: "shares.step.send",
};

/** True when a thrown error carries this code in its message ("SHARE:inactive"). */
function errorSays(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(code);
}

/** Three discs joined by a line: the current one filled, the done ones ticked, the rest muted. */
function Stepper({ step }: { step: Step }) {
  const { t } = useI18n();
  return (
    <ol className="flex items-center gap-2" aria-label={t("shares.dialog.title")}>
      {STEPS.map((name, index) => {
        const status = stepStatus(name, step);
        const last = index === STEPS.length - 1;
        return (
          <li
            key={name}
            aria-current={status === "current" ? "step" : undefined}
            className={cn("flex min-w-0 items-center gap-2", !last && "flex-1")}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-base ease-out-soft",
                status === "current"
                  ? "bg-primary text-primary-foreground shadow-raised"
                  : status === "done"
                    ? "bg-primary/12 text-primary"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {status === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "truncate text-meta font-medium",
                status === "current" ? "text-ink" : status === "done" ? "text-primary" : "text-muted-foreground",
              )}
            >
              {t(STEP_KEYS[name])}
              <span className="sr-only">
                {` · ${t("shares.step.of", { index: index + 1, count: STEPS.length })}`}
                {status === "done" ? ` · ${t("shares.step.done")}` : ""}
              </span>
            </span>
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px min-w-4 flex-1 transition-colors duration-base ease-out-soft",
                  status === "done" ? "bg-primary/40" : "bg-border",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ShareDialog({
  shortlistId,
  briefTitle,
  open,
  onOpenChange,
}: {
  shortlistId: string;
  briefTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const [state, dispatch] = useReducer(dialogReducer, briefTitle, initialState);
  const [capabilities, setCapabilities] = useState<ShareCapabilities | null>(null);
  const [session, setSession] = useState(0);
  const titleRef = useRef(briefTitle);
  titleRef.current = briefTitle;

  // Each opening starts over: fresh items, fresh capabilities, the brief's title.
  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset", title: titleRef.current });
    setSession((value) => value + 1);
    let cancelled = false;
    void (async () => {
      try {
        const answer = await shareCapabilities({ data: { ...(await withToken()), orgId: org.id } });
        if (!cancelled) setCapabilities(answer);
      } catch (error) {
        // Without an answer the dialog offers neither the model nor the email: the link still works.
        console.error(error);
        if (!cancelled) setCapabilities({ model: false, email: false });
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

  function fail(error: unknown) {
    console.error(error);
    if (errorSays(error, "SHARE:inactive")) toast.error(t("shares.send.inactive"));
    else toast.error(errorMessage(locale, error));
    dispatch({ type: "setBusy", value: false });
  }

  async function prepare() {
    if (state.busy) return;
    dispatch({ type: "setBusy", value: true });
    try {
      const answer = await draftShare({
        data: {
          ...(await withToken()),
          orgId: org.id,
          shortlistId,
          candidateIds: state.selected,
          useModel: state.useModel && capabilities?.model === true,
        },
      });
      dispatch({
        type: "drafted",
        items: answer.items,
        brief: answer.brief,
        modelUsed: answer.modelUsed,
        modelFailed: answer.modelFailed,
      });
      if (answer.modelFailed) toast.error(t("shares.review.modelFailed"));
    } catch (error) {
      fail(error);
    }
  }

  async function create() {
    if (state.busy) return;
    dispatch({ type: "setBusy", value: true });
    try {
      const answer = await createShare({
        data: {
          ...(await withToken()),
          orgId: org.id,
          shortlistId,
          title: state.title.trim(),
          intro: state.intro.trim(),
          items: cleanItems(state.items),
          includeCvs: state.includeCvs,
          expiresInDays: state.expiresInDays,
        },
      });
      dispatch({ type: "created", share: answer });
      toast.success(t("shares.created"));
    } catch (error) {
      fail(error);
    }
  }

  async function send() {
    if (state.busy || !state.share) return;
    dispatch({ type: "setBusy", value: true });
    try {
      const answer = await sendShare({
        data: {
          ...(await withToken()),
          orgId: org.id,
          shareId: state.share.shareId,
          url: state.share.url,
          recipients: state.recipients,
          message: state.message.trim(),
        },
      });
      dispatch({ type: "sent", outcome: answer });
    } catch (error) {
      fail(error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The stepper under the title says the three steps: no sentence repeats them. */}
      <DialogContent size="lg" className="flex flex-col gap-5" aria-describedby={undefined}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("shares.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="shrink-0">
          <Stepper step={state.step} />
        </div>
        <DialogBody className="py-1">
          {state.step === "content" ? (
            <ContentStep
              state={state}
              dispatch={dispatch}
              items={shareable.data}
              loading={shareable.loading}
              error={shareable.error}
              capabilities={capabilities}
            />
          ) : state.step === "review" ? (
            <ReviewStep state={state} dispatch={dispatch} />
          ) : (
            <SendStep state={state} dispatch={dispatch} emailReady={capabilities?.email === true} />
          )}
        </DialogBody>
        <div className="shrink-0">
          {state.step === "content" ? (
            <ContentFooter
              state={state}
              items={shareable.data}
              loading={shareable.loading}
              onPrepare={() => void prepare()}
            />
          ) : state.step === "review" ? (
            <ReviewFooter
              state={state}
              onBack={() => dispatch({ type: "backToContent" })}
              onCreate={() => void create()}
            />
          ) : (
            <SendFooter
              state={state}
              emailReady={capabilities?.email === true}
              onSend={() => void send()}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
