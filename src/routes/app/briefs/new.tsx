/**
 * /app/briefs/new: a title and the brief as free text. The row is
 * created open, with no criteria yet; the brief page then proposes
 * them (with a model) or lets the person write them.
 */
import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/auth-context";
import { requireSupabase } from "@/lib/auth/supabase-client";
import { createBrief, DESCRIPTION_MAX, TITLE_MAX } from "@/lib/briefs/queries";
import { useT } from "@/lib/i18n";
import { useCurrentOrg, useOrg } from "@/lib/org/org-context";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/app/briefs/new")({
  component: NewBriefPage,
});

function NewBriefPage() {
  const t = useT();
  const { org } = useCurrentOrg();
  const { can } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !user || !title.trim()) return;
    setBusy(true);
    try {
      const supabase = await requireSupabase();
      const briefId = await createBrief(supabase, { orgId: org.id, title, description, userId: user.id });
      toast.success(t("briefs.new.created"));
      void navigate({ to: "/app/briefs/$briefId", params: { briefId } });
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!can("member")) {
    return (
      <div>
        <PageHeader title={t("briefs.new.title")} />
        <EmptyState
          title={t("common.forbidden")}
          action={
            <Button asChild variant="outline">
              <Link to="/app/briefs">{t("briefs.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to="/app/briefs" className="hover:underline">
            {t("nav.briefs")}
          </Link>
        }
        title={t("briefs.new.title")}
        description={t("briefs.new.text")}
      />
      <form onSubmit={(event) => void submit(event)} className="sheet max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="space-y-1.5">
          <Label htmlFor="new-brief-title">{t("briefs.form.title")}</Label>
          <Input
            id="new-brief-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("briefs.form.title.placeholder")}
            maxLength={TITLE_MAX}
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-brief-description">{t("briefs.form.description")}</Label>
          <Textarea
            id="new-brief-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("briefs.form.description.placeholder")}
            maxLength={DESCRIPTION_MAX}
            rows={10}
          />
          <p className="text-xs text-muted-foreground">{t("briefs.form.description.help")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline" type="button">
            <Link to="/app/briefs">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {t("briefs.new.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
