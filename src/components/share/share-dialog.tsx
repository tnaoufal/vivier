/**
 * Sharing a shortlist in one dialog and three steps: the content (which
 * candidates, title, intro, CVs, expiry, the model or not), the review
 * of every sheet (the assessment read only, the prose editable), then
 * the link and the emails. The state lives in a pure reducer
 * (lib/shares/dialog-state.ts); the server functions do the reading of
 * profiles and of the shortlist's analysis, the model call, the share
 * row and the emails. Opened from the shortlist board by members.
 */
import { useEffect, useReducer, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { useQuery } from "@/lib/data/use-query";
import { useI18n } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { dialogReducer, initialState, STEPS, stepIndex, type Step } from "@/lib/shares/dialog-state";
import { cleanItems } from "@/lib/shares/draft";
import { listShareableItems } from "@/lib/shares/queries";
import { createShare, draftShare, sendShare, shareCapabilities, type ShareCapabilities } from "@/lib/shares/shares.functions";
import { toast } from "@/lib/toast";

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

function StepIndicator({ step }: { step: Step }) {
  const { t } = useI18n();
  const current = stepIndex(step);
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" aria-label={t("shares.dialog.title")}>
      {STEPS.map((name, index) => (
        <li
          key={name}
          aria-current={index === current ? "step" : undefined}
          className={index === current ? "font-semibold text-ink" : index < current ? "text-primary" : "text-muted-foreground"}
        >
          {index + 1}. {t(STEP_KEYS[name])}
        </li>
      ))}
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
      candidateIds: shareable.data.filter((item) => item.status === "retained" && item.candidates).map((item) => item.candidate_id),
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
      <DialogContent className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-6 overflow-hidden p-8 sm:p-8">
        <DialogHeader className="min-w-0 space-y-2 pr-8 text-left">
          <DialogTitle className="text-xl leading-7">{t("shares.dialog.title")}</DialogTitle>
          <DialogDescription className="text-sm leading-5">{t("shares.dialog.text")}</DialogDescription>
        </DialogHeader>
        <StepIndicator step={state.step} />
        {/* Scrolls only when a short screen cannot hold the step; the candidates list scrolls on its own. */}
        <div className="min-h-0 min-w-0 overflow-y-auto">
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
        </div>
        {/* The step's buttons sit under the scrolling box, as the charter asks, so the primary action never scrolls away with thirty sheets. */}
        {state.step === "content" ? (
          <ContentFooter state={state} items={shareable.data} loading={shareable.loading} onPrepare={() => void prepare()} />
        ) : state.step === "review" ? (
          <ReviewFooter state={state} onBack={() => dispatch({ type: "backToContent" })} onCreate={() => void create()} />
        ) : (
          <SendFooter state={state} emailReady={capabilities?.email === true} onSend={() => void send()} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
