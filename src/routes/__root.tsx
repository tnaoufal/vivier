/**
 * The document every page renders in: the head (fonts, theme colour,
 * the saved theme applied before paint), the providers (language, theme,
 * session), the toaster, and the two pages the router falls back to
 * (not found, error) in the product's own calm style.
 */
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth/use-auth";
import { BRAND } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/provider";
import appCss from "../styles.css?url";

// Light is the default; a saved dark preference applies before CSS paints.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

function NotFoundComponent() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md text-center">
        <BrandMark size="md" className="mb-10 justify-center" />
        <p className="font-display text-6xl text-primary tabular-nums">404</p>
        <h1 className="mt-4 font-display text-2xl text-ink">{t("common.notFound")}</h1>
        <p className="mt-2 text-[15px] leading-6 text-muted-foreground">{t("common.notFound.text")}</p>
        <div className="mt-8">
          <Button asChild>
            <Link to="/">{t("common.home")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error instanceof Error ? error : new Error(String(error)));
  const router = useRouter();
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md text-center">
        <BrandMark size="md" className="mb-10 justify-center" />
        <h1 className="font-display text-2xl text-ink">{t("common.errorPage")}</h1>
        <p className="mt-2 text-[15px] leading-6 text-muted-foreground">{t("common.errorPage.text")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            {t("common.retry")}
          </Button>
          <Button asChild variant="outline">
            <a href="/">{t("common.home")}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: BRAND.name },
      { name: "description", content: BRAND.description.fr },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: BRAND.name },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#1a1f1c" },
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#fcfdfb" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preload",
        href: "/fonts/geist-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <I18nProvider>
          <ThemeProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </ThemeProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
