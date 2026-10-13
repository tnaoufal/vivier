/**
 * A candidate typed in by hand (source "manual"): name, email, phone,
 * headline, location. Nothing is inferred; the rest of the profile is
 * filled on its page. At least a name or an email is needed so the row
 * can be found again.
 */
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import type { CandidateInsert } from "@/lib/db/types";
import { useT } from "@/lib/i18n";
import { useCurrentOrg } from "@/lib/org/org-context";
import { toast } from "@/lib/toast";

interface Fields {
  full_name: string;
  email: string;
  phone: string;
  headline: string;
  location: string;
}

const EMPTY: Fields = { full_name: "", email: "", phone: "", headline: "", location: "" };

const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function ManualCandidateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (candidateId: string) => void;
}) {
  const t = useT();
  const { org } = useCurrentOrg();
  const { user } = useAuth();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    if (busy) return;
    if (!next) setFields(EMPTY);
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !user) return;
    if (!fields.full_name.trim() && !fields.email.trim()) {
      toast.error(t("candidates.manual.needName"));
      return;
    }
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      const row: CandidateInsert = {
        org_id: org.id,
        created_by: user.id,
        source: "manual",
        full_name: nullable(fields.full_name),
        email: nullable(fields.email)?.toLowerCase() ?? null,
        phone: nullable(fields.phone),
        headline: nullable(fields.headline),
        location: nullable(fields.location),
      };
      const { data, error } = await supabase.from("candidates").insert(row).select("id").single();
      if (error) {
        console.error(error);
        toast.error(t("common.error"));
        return;
      }
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== "string") {
        toast.error(t("common.error"));
        return;
      }
      toast.success(t("candidates.manual.created"));
      setFields(EMPTY);
      onOpenChange(false);
      onCreated(id);
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("candidates.manual.title")}</DialogTitle>
            <DialogDescription>{t("candidates.manual.text")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="manual-name">{t("candidates.field.full_name")}</Label>
              <Input id="manual-name" value={fields.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={200} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-email">{t("common.email")}</Label>
              <Input id="manual-email" type="email" value={fields.email} onChange={(e) => set("email", e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-phone">{t("candidates.field.phone")}</Label>
              <Input id="manual-phone" type="tel" value={fields.phone} onChange={(e) => set("phone", e.target.value)} maxLength={60} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-headline">{t("candidates.field.headline")}</Label>
              <Input id="manual-headline" value={fields.headline} onChange={(e) => set("headline", e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-location">{t("candidates.field.location")}</Label>
              <Input id="manual-location" value={fields.location} onChange={(e) => set("location", e.target.value)} maxLength={200} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
