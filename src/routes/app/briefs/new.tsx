/**
 * /app/briefs/new on the plane: the header (the briefs as the way back,
 * the title) holds the one filled button that creates the brief and
 * analyses it (the brief page opens with `?run=1` and starts the
 * analysis at once; Enter in the title submits through it too); one
 * pane holds the title and the consultant's brief as free text (the
 * placeholder is the example). A viewer sees the refusal in the pane.
 * The brief is the only source of the analysis: no criteria, no profile
 * to write here.
 */
import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldAlert, Sparkles } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PHONE_ICON, Pane, Workspace } from "@/components/app-shell/workspace";
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

/** The form in the pane, submitted by the header's button through `form`. */
const FORM_ID = "new-brief-form";

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

  const member = can("member");

  return (
    <Workspace
      eyebrow={eyebrow}
      title={t("briefs.new.title")}
      actions={
        member ? (
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            icon={<Sparkles />}
            disabled={busy || !title.trim()}
            aria-busy={busy || undefined}
            aria-label={t("briefs.new.create")}
            className={PHONE_ICON}
          >
            <span className="max-sm:sr-only">{t("briefs.new.create")}</span>
          </Button>
        ) : null
      }
    >
      <Pane label={t("briefs.new.title")} width="fill" bodyClassName="p-4 sm:p-6">
        {member ? (
          <form
            id={FORM_ID}
            onSubmit={(event) => void submit(event)}
            className="max-w-2xl space-y-6"
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
            </div>
          </form>
        ) : (
          <EmptyState quiet icon={<ShieldAlert />} title={t("common.forbidden")} />
        )}
      </Pane>
    </Workspace>
  );
}
