/**
 * The shares made from a shortlist, under its board: one short row
 * each with the date, who shared, how many addresses it went to and
 * when the link expires (or that it expired or was revoked), a copy
 * button for a link this browser created (the row keeps only a hash of
 * the token, so no other link can be shown again), and for members a
 * revocation in the row's menu, behind a confirmation. Nothing at all
 * when the shortlist was never shared. Refreshed on the share
 * activities of the organisation (realtime).
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Ellipsis, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/app-shell/confirm-dialog";
import { Pill } from "@/components/app-shell/pill";
import { Section } from "@/components/app-shell/section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { debounce, subscribeToTable } from "@/lib/data/realtime";
import { useQuery } from "@/lib/data/use-query";
import type { ShareRow } from "@/lib/db/types";
import { formatDate, useI18n } from "@/lib/i18n";
import { memberName, useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { errorMessage, withToken } from "@/lib/platform/call";
import { recallLink, sessionLinkStore } from "@/lib/shares/link-memory";
import { listShares, listShareSends, sendsByShare, type ShareSend } from "@/lib/shares/queries";
import { revokeShare } from "@/lib/shares/shares.functions";
import { shareState } from "@/lib/shares/state";
import { toast } from "@/lib/toast";

interface PanelData {
  shares: ShareRow[];
  sends: Map<string, ShareSend[]>;
}

/** The distinct addresses a share went to. */
function recipientCount(sends: readonly ShareSend[]): number {
  return new Set(sends.map((send) => send.to_email)).size;
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
    const sends = await listShareSends(
      supabase,
      org.id,
      shares.map((share) => share.id),
    );
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

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("common.copied"));
    } catch (error) {
      console.error(error);
      toast.error(t("shares.dialog.copyFailed"));
    }
  }

  const nameOf = (userId: string | null) =>
    userId ? memberName(members.get(userId), t("shares.panel.formerMember")) : t("common.someone");

  const shares = query.data?.shares ?? [];
  // A shortlist never shared shows nothing here; a read that failed says so in one line.
  if (!query.error && shares.length === 0) return null;
  const store = sessionLinkStore();

  return (
    <Section title={t("shares.panel.title")} count={shares.length || undefined}>
      {query.error ? (
        <p className="text-sm text-muted-foreground">{t("shares.panel.error")}</p>
      ) : (
        <ul className="sheet stagger divide-y divide-border overflow-hidden">
          {shares.map((share) => {
            const state = shareState(share);
            const sends = query.data?.sends.get(share.id) ?? [];
            const recipients = recipientCount(sends);
            const url = recallLink(store, share.id);
            const dateLine =
              state === "revoked"
                ? t("shares.panel.revoked", { date: formatDate(locale, share.revoked_at) })
                : state === "expired"
                  ? t("shares.panel.expired", { date: formatDate(locale, share.expires_at) })
                  : t("shares.panel.expires", { date: formatDate(locale, share.expires_at) });
            const recipientsText =
              recipients === 0
                ? t("shares.panel.recipients.none")
                : recipients === 1
                  ? t("shares.panel.recipients.one")
                  : t("shares.panel.recipients.many", { count: recipients });
            const canRevoke = canAct && state === "active";
            return (
              <li key={share.id} className="sheet-row rise-in">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink tabular-nums">
                      {formatDate(locale, share.created_at)}
                    </span>
                    <span className="min-w-0 truncate text-sm text-muted-foreground">
                      {nameOf(share.created_by)}
                    </span>
                    {state !== "active" ? (
                      <Pill tone="negative" size="sm">
                        {t(`shares.state.${state}`)}
                      </Pill>
                    ) : null}
                  </div>
                  <p className="text-meta text-muted-foreground tabular-nums">
                    {recipientsText}
                    {" · "}
                    {dateLine}
                  </p>
                </div>
                {url && state === "active" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    icon={<Copy />}
                    onClick={() => void copy(url)}
                    aria-label={t("shares.panel.copy")}
                    title={t("shares.panel.copy")}
                    className="text-muted-foreground hover:text-ink"
                  />
                ) : null}
                {canRevoke ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        icon={<Ellipsis />}
                        disabled={busy}
                        aria-label={t("shares.panel.menu")}
                        title={t("shares.panel.menu")}
                        className="text-muted-foreground"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem destructive onSelect={() => setPending(share)}>
                        <Trash2 />
                        {t("shares.panel.revoke")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
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
    </Section>
  );
}
