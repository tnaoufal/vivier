/**
 * The document every page renders in: the head (fonts, theme colour,
 * the saved theme applied before paint), the providers (language, theme,
 * session, tooltips), the toaster, and the two pages the router falls
 * back to (not found, error) in the product's own calm style.
 */
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { useTheme } from "@/components/theme-context";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth/use-auth";
import { BRAND } from "@/lib/brand";
import { useT } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/provider";
import appCss from "../styles.css?url";

/*
 * The browser chrome's colour (the address bar on a phone) follows the
 * app's theme, not the OS: the two are the page background of each theme
 * (`--background` in styles.css: the paper, and the ink; change them
 * together).
 */
const THEME_COLOR = { light: "#ffffff", dark: "#0a0a0a" } as const;

/*
 * Light is the default; a saved dark preference applies before CSS
 * paints. The same script writes the one theme-color meta, so the chrome
 * is right from the first paint; it is created here and not by React:
 * a meta React rendered with another content would be hydrated as a
 * second one.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark';document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';var m=document.createElement('meta');m.setAttribute('name','theme-color');m.setAttribute('content',d?'${THEME_COLOR.dark}':'${THEME_COLOR.light}');document.head.appendChild(m);}catch(e){}})();`;

/** Keeps the theme-color meta on the app's theme after a switch. */
function ThemeColor() {
  const { theme } = useTheme();
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  }, [theme]);
  return null;
}

function NotFoundComponent() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="rise-in w-full max-w-md text-center">
        <BrandMark size="md" className="mb-10 justify-center" />
        <p className="font-display text-6xl text-ink tabular-nums">404</p>
        <h1 className="mt-4 font-display text-2xl text-ink">{t("common.notFound")}</h1>
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
      <div className="rise-in w-full max-w-md text-center">
        <BrandMark size="md" className="mb-10 justify-center" />
        <h1 className="font-display text-2xl text-ink">{t("common.errorPage")}</h1>
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
            <ThemeColor />
            <AuthProvider>
              <TooltipProvider delayDuration={300} skipDelayDuration={400}>
                {children}
              </TooltipProvider>
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
