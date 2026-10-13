/**
 * The shares of one shortlist under its board: each with its title,
 * who created it and when, its expiry, its state (active, expired,
 * revoked), how often it was opened, the emails sent for it with their
 * status, and for members a revocation behind a confirmation. No link
 * is shown here: the token is not stored. Refreshed on the share
 * activities of the organisation (realtime) and on demand.
 */
import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, Share2 } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Pill, type PillTone } from "@/components/app-shell/pill";
import { Button } from "@/components/ui/button";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { EmailSendStatus, ShareRow } from "@/lib/db/types";
import { formatDate, formatDateTime, formatRelative, useI18n } from "@/lib/i18n";
import { memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { listShares, listShareSends, sendsByShare, type ShareSend } from "@/lib/shares/queries";
import { revokeShare } from "@/lib/shares/shares.functions";
import { shareState, type ShareState } from "@/lib/shares/state";
import { toast } from "@/lib/toast";

const STATE_TONE: Record<ShareState, PillTone> = { active: "positive", expired: "neutral", revoked: "negative" };
const SEND_TONE: Record<EmailSendStatus, PillTone> = { queued: "caution", sent: "positive", failed: "negative" };

interface PanelData {
  shares: ShareRow[];
  sends: Map<string, ShareSend[]>;
}

export function SharesPanel({ shortlistId }: { shortlistId: string }) {
  const { t, locale } = useI18n();
  const { org } = useCurrentOrg();
  const { can, members } = useOrg();
  const canAct = can("member");
  const [pending, setPending] = useState<ShareRow | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery<PanelData>(`shares:${org.id}:${shortlistId}`, async () => {
    const supabase = await requireSupabase();
    const shares = await listShares(supabase, org.id, shortlistId);
    const sends = await listShareSends(supabase, org.id, shares.map((share) => share.id));
    return { shares, sends: sendsByShare(sends) };
  });

  // shares is not in the realtime publication; the activities every change writes are.
  const refresh = query.refresh;
  const onActivity = useCallback(
    (change: { new: Record<string, unknown> }) => {
      const kind = change.new["kind"];
      if (typeof kind === "string" && kind.startsWith("share.")) void refresh();
    },
    [refresh],
  );
  useEffect(() => {
    let latest: { new: Record<string, unknown> } | null = null;
    const soon = debounce(() => {
      if (latest) onActivity(latest);
    }, 300);
    return subscribeToTable("activities", `org_id=eq.${org.id}`, (change) => {
      latest = change;
      soon();
    });
  }, [onActivity, org.id]);

  async function revoke() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await revokeShare({ data: { ...(await withToken()), orgId: org.id, shareId: pending.id } });
      toast.success(t("shares.panel.revoked.toast"));
      setPending(null);
      await query.refresh();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage(locale, error));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (userId: string | null) =>
    userId ? memberName(members.get(userId), t("shares.panel.formerMember")) : t("common.someone");

  const shares = query.data?.shares ?? [];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg text-ink">{t("shares.panel.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("shares.panel.text")}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void query.refresh()}
          disabled={query.loading}
          aria-label={t("shares.panel.refresh")}
          title={t("shares.panel.refresh")}
        >
          <RefreshCw />
        </Button>
      </div>

      {query.error ? (
        <EmptyState
          title={t("shares.panel.error")}
          action={
            <Button type="button" variant="outline" onClick={() => void query.refresh()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : query.loading && !query.data ? (
        <div className="sheet space-y-3 p-4" aria-busy="true">
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      ) : !shares.length ? (
        <EmptyState icon={<Share2 />} title={t("shares.panel.empty.title")} text={t("shares.panel.empty.text")} />
      ) : (
        <ul className="sheet divide-y divide-border">
          {shares.map((share) => {
            const state = shareState(share);
            const sends = query.data?.sends.get(share.id) ?? [];
            const items = Array.isArray(share.items) ? share.items.length : 0;
            const dateLine =
              state === "revoked"
                ? t("shares.panel.revoked", { date: formatDate(locale, share.revoked_at) })
                : state === "expired"
                  ? t("shares.panel.expired", { date: formatDate(locale, share.expires_at) })
                  : t("shares.panel.expires", { date: formatDate(locale, share.expires_at) });
            const views =
              share.view_count === 0
                ? t("shares.panel.views.none")
                : share.view_count === 1
                  ? t("shares.panel.views.one")
                  : t("shares.panel.views.many", { count: share.view_count });
            return (
              <li key={share.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{share.title}</span>
                  <Pill tone={STATE_TONE[state]}>{t(`shares.state.${state}`)}</Pill>
                  {canAct && state === "active" ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPending(share)} disabled={busy}>
                      {t("shares.panel.revoke")}
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("shares.panel.createdBy", { name: nameOf(share.created_by), date: formatDateTime(locale, share.created_at) })}
                  {" · "}
                  {dateLine}
                  {" · "}
                  {items === 1 ? t("shares.panel.items.one") : t("shares.panel.items.many", { count: items })}
                  {share.include_cvs ? ` · ${t("shares.panel.cvs")}` : ""}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Eye className="size-3.5" />
                  {views}
                  {share.last_viewed_at ? ` · ${t("shares.panel.lastViewed", { when: formatRelative(locale, share.last_viewed_at) })}` : ""}
                </p>
                {sends.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {sends.map((send) => (
                      <li key={send.id} className="inline-flex items-center gap-1.5 text-xs text-ink" title={send.error ?? undefined}>
                        <span>{send.to_email}</span>
                        <Pill tone={SEND_TONE[send.status]}>{t(`shares.send.status.${send.status}`)}</Pill>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("shares.panel.noSends")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setPending(null);
        }}
        title={t("shares.panel.revoke.title")}
        text={t("shares.panel.revoke.text")}
        confirmLabel={t("shares.panel.revoke")}
        destructive
        busy={busy}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}
