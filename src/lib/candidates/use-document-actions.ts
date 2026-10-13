/**
 * What a person can do with one document from any card: open the CV in
 * a new tab through a short-lived signed link, and send a failed or
 * unreadable one back to the queue (the only status change the browser
 * is allowed; the trigger refuses the rest) followed by a poke of the
 * processor. Toasts speak the person's language; details go to the
 * console.
 */
import { useCallback, useState } from "react";

import { requireSupabase } from "@/lib/auth/supabase-client";
import type { DocumentRow } from "@/lib/db/types";
import { useI18n } from "@/lib/i18n";
import { errorMessage, withToken } from "@/lib/platform/call";
import { toast } from "@/lib/toast";

import { notifyProcessor } from "./candidates.functions";
import { signedCvUrl } from "./upload-browser";

/** Statuses a person may send back to the queue. */
export function canRetry(status: DocumentRow["status"]): boolean {
  return status === "failed" || status === "needs_ocr";
}

export interface DocumentActions {
  /** The id of the document an action is running on, or null. */
  busyId: string | null;
  view: (document: Pick<DocumentRow, "id" | "storage_path">) => Promise<void>;
  retry: (document: Pick<DocumentRow, "id" | "org_id" | "status">) => Promise<void>;
}

export function useDocumentActions(onChanged?: () => void): DocumentActions {
  const { t, locale } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);

  const view = useCallback(
    async (document: Pick<DocumentRow, "id" | "storage_path">) => {
      if (busyId) return;
      setBusyId(document.id);
      // Opened before the await so the browser counts it as the person's own click.
      const tab = window.open("about:blank", "_blank");
      try {
        const supabase = await requireSupabase();
        const url = await signedCvUrl(supabase, document.storage_path);
        if (tab) {
          tab.opener = null;
          tab.location.replace(url);
        } else {
          toast.error(t("candidates.documents.popup"));
        }
      } catch (error) {
        console.error(error);
        tab?.close();
        toast.error(t("candidates.documents.openFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, t],
  );

  const retry = useCallback(
    async (document: Pick<DocumentRow, "id" | "org_id" | "status">) => {
      if (busyId || !canRetry(document.status)) return;
      setBusyId(document.id);
      try {
        const supabase = await requireSupabase();
        const { error } = await supabase
          .from("documents")
          .update({ status: "queued" })
          .eq("id", document.id)
          .eq("org_id", document.org_id);
        if (error) {
          console.error(error);
          toast.error(
            error.message.includes("DOC:already_queued")
              ? t("candidates.documents.alreadyQueued")
              : t("common.error"),
          );
          return;
        }
        try {
          await notifyProcessor({
            data: { ...(await withToken()), orgId: document.org_id, documentIds: [document.id] },
          });
        } catch (pokeError) {
          // The service polls the queue itself; a missed poke only delays the work.
          console.warn("[documents] poke failed", errorMessage(locale, pokeError));
        }
        toast.success(t("candidates.documents.retried"));
        onChanged?.();
      } catch (error) {
        console.error(error);
        toast.error(t("common.error"));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, locale, onChanged, t],
  );

  return { busyId, view, retry };
}
