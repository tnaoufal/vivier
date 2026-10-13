import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/theme-provider";
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <BrandMark size="md" className="mb-8 justify-center" />
        <h1 className="font-display text-6xl text-ink">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-ink">{t("common.notFound")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.notFound.text")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common.home")}
          </Link>
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <BrandMark size="md" className="mb-8 justify-center" />
        <h1 className="text-xl font-semibold text-ink">{t("common.errorPage")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.errorPage.text")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("common.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium text-ink hover:bg-accent"
          >
            {t("common.home")}
          </a>
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
