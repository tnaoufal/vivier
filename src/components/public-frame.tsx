/**
 * The frame of the pages outside the app shell (sign-in, an invitation,
 * the status page, the legal pages): the brand and the two toggles on
 * top, the content centred or in a column, and a footer with the one
 * honesty sentence and the three public links. The landing page draws
 * its own, richer header and footer.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { LocaleToggle, ThemeToggle } from "@/components/app-shell/toggles";
import { BrandMark } from "@/components/brand-mark";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const WIDTHS = {
  /** A centred card (sign-in, an invitation). */
  sm: "max-w-md",
  /** A reading column (the legal pages, the status page). */
  md: "max-w-2xl",
  lg: "max-w-4xl",
} as const;

export function PublicFrame({
  children,
  width = "md",
  center = false,
  className,
}: {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  /** Centres the content vertically (a card on a page of its own). */
  center?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8 lg:px-10">
        <BrandMark size="md" />
        <div className="flex items-center gap-1">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>
      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col px-4 py-8 sm:px-8 sm:py-12",
          center && "justify-center",
          WIDTHS[width],
          className,
        )}
      >
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-meta text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p className="max-w-xl">{t("auth.footer.human")}</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label={t("landing.footer.links")}>
            <Link to="/privacy" className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("nav.privacy")}
            </Link>
            <Link to="/terms" className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("nav.terms")}
            </Link>
            <Link to="/status" className="rounded-sm hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("nav.status")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
