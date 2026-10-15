/**
 * /app/briefs/new: one centred card with a title and the consultant's
 * brief as free text (the placeholder is the example), and the one
 * button that creates it and analyses it: the brief page opens with
 * `?run=1` and starts the analysis at once. A viewer sees the refusal
 * every page shows. The brief is the only source of the analysis: no
 * criteria, no profile to write here.
 */
import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

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
      const briefId = await createBrief(await requireSupabase(), {
        orgId: org.id,
        title,
        description,
        userId: user.id,
      });
      // The brief page starts the analysis itself, once, and drops the param.
      void navigate({ to: "/app/briefs/$briefId", params: { briefId }, search: { run: 1 } });
    } catch (error) {
      console.error(error);
      toast.error(t("common.error"));
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
        <NotAllowed />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={eyebrow} title={t("briefs.new.title")} />
      <form onSubmit={(event) => void submit(event)} className="sheet space-y-6 p-6">
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
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button asChild variant="ghost" type="button">
            <Link to="/app/briefs">{t("common.cancel")}</Link>
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={<Sparkles />}
            disabled={busy || !title.trim()}
            aria-busy={busy || undefined}
          >
            {t("briefs.new.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
