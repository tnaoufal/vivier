/**
 * /app/briefs/new: a title and the need as free text, two fields in one
 * card, with the honest help: the criteria come next, proposed by the
 * model when there is one and validated by the team. The row is created
 * open, with no criteria yet; the brief page then proposes them or lets
 * the person write them.
 */
import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell/page-header";
import { NotAllowed } from "@/components/team/not-allowed";
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
      const briefId = await createBrief(supabase, {
        orgId: org.id,
        title,
        description,
        userId: user.id,
      });
      toast.success(t("briefs.new.created"));
      void navigate({ to: "/app/briefs/$briefId", params: { briefId } });
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const eyebrow = (
    <Link
      to="/app/briefs"
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("nav.briefs")}
    </Link>
  );

  if (!can("member")) {
    return (
      <div>
        <PageHeader eyebrow={eyebrow} title={t("briefs.new.title")} />
        <NotAllowed text={t("briefs.new.forbidden")} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={eyebrow}
        title={t("briefs.new.title")}
        description={t("briefs.new.text")}
      />
      <form
        onSubmit={(event) => void submit(event)}
        className="sheet max-w-2xl space-y-6 p-6 sm:p-8"
      >
        <div className="space-y-2">
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
        <div className="space-y-2">
          <Label htmlFor="new-brief-description">{t("briefs.form.description")}</Label>
          <Textarea
            id="new-brief-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("briefs.form.description.placeholder")}
            maxLength={DESCRIPTION_MAX}
            rows={10}
          />
          <p className="text-meta text-muted-foreground">{t("briefs.form.description.help")}</p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button asChild variant="ghost" type="button">
            <Link to="/app/briefs">{t("common.cancel")}</Link>
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
            {t("briefs.new.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
