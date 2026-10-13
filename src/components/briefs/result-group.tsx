/**
 * One group of results on the brief page (matching, to check, set
 * aside, not analysed): the shared Section with the count, one sentence
 * saying what the group means, and, when the group is collapsible, a
 * button that shows or hides its cards. Set-aside profiles start
 * hidden: they are never deleted, only out of the way.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Section } from "@/components/app-shell/section";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ResultGroup({
  title,
  help,
  count,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  help: string;
  count: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;
  const toggle = collapsible ? (
    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="gap-1.5">
      <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} />
      {open ? t("briefs.section.hide") : t("briefs.section.show")}
    </Button>
  ) : null;
  return (
    <Section title={title} count={count} description={help} action={toggle}>
      {shown ? children : null}
    </Section>
  );
}
