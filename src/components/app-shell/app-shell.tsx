/**
 * The frame of every signed-in page: a 264px grey 50 sidebar with the
 * brand, the organisation switcher (name and plan), the four sections
 * with an ink mark (paper text) that slides to the current one, and, at
 * the bottom, the person (avatar, name, role) whose menu holds the
 * settings, the theme, the language, the organisations and the sign-out.
 * On phones a top bar with the brand opens the same sidebar as a
 * full-screen sheet, closed on navigation. Content renders in the
 * outlet, centred, at most 72rem wide, and each page change fades and
 * rises in (`PageTransition`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Briefcase,
  Building2,
  ChevronsUpDown,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
  UsersRound,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { useTheme } from "@/components/theme-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { memberName, useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import { Avatar } from "./avatar";
import { PageTransition } from "./page-transition";

interface NavItem {
  to: string;
  key: TranslationKey;
  icon: ReactNode;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { to: "/app", key: "nav.dashboard", icon: <LayoutDashboard />, exact: true },
  { to: "/app/briefs", key: "nav.briefs", icon: <Briefcase /> },
  { to: "/app/candidates", key: "nav.candidates", icon: <Users /> },
  { to: "/app/members", key: "nav.members", icon: <UsersRound /> },
];

function isActive(item: NavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The four sections. The active mark is one ink pill behind the links
 * that slides to the current one: its top offset is measured from the
 * active link and moved with a transition, so it travels instead of
 * jumping. The current link reads in paper over it.
 */
function NavLinks({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navRef = useRef<HTMLElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  const activeIndex = NAV.findIndex((item) => isActive(item, pathname));

  const measure = useCallback(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) {
      setMark(null);
      return;
    }
    setMark({ top: active.offsetTop, height: active.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, activeIndex]);

  return (
    <nav ref={navRef} className="relative flex flex-col gap-0.5" aria-label={t("shell.nav.label")}>
      {mark ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 rounded-md bg-ink transition-[transform,height] duration-base ease-out-soft"
          style={{ transform: `translateY(${mark.top}px)`, height: mark.height }}
        />
      ) : null}
      {NAV.map((item, index) => {
        const active = index === activeIndex;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "press relative z-10 flex h-10 items-center gap-3 rounded-md px-3 text-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5 [&_svg]:shrink-0",
              active
                ? "text-background"
                : "text-ink-soft hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              // Without a measured mark (first paint), the active link still reads as active.
              active && !mark && "bg-ink",
            )}
            aria-current={active ? "page" : undefined}
          >
            <span aria-hidden="true" className="inline-flex shrink-0">
              {item.icon}
            </span>
            <span className="truncate">{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The organisations the person belongs to, the current one checked, and the way to a new one. */
function OrgChoices() {
  const { t } = useI18n();
  const { memberships, org, switchOrg } = useOrg();
  return (
    <>
      {memberships.map((m) => (
        <DropdownMenuCheckboxItem
          key={m.org.id}
          checked={m.org.id === org?.id}
          onSelect={() => switchOrg(m.org.id)}
        >
          <span className="min-w-0 flex-1 truncate">{m.org.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{t(`role.${m.role}`)}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to="/app/organizations/new">
          <Plus aria-hidden="true" />
          {t("nav.newOrg")}
        </Link>
      </DropdownMenuItem>
    </>
  );
}

function OrgSwitcher() {
  const { t } = useI18n();
  const { org } = useOrg();
  if (!org) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="press flex w-full cursor-pointer items-center gap-3 rounded-md border border-sidebar-border bg-card p-3 text-left shadow-hairline hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent/60"
        >
          {/* The accessible name keeps the organisation and its plan: "Switch organisation · Acme · Pro". */}
          <span className="sr-only">{t("nav.switchOrg")} · </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted font-display text-base text-ink">
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{org.name}</span>
            {/* Grey 700, not grey 500: the line keeps AA on the hover tint over the sidebar. */}
            <span className="block truncate text-meta text-ink-soft">
              {t(`shell.org.plan.${org.plan}`)}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("nav.switchOrg")}</DropdownMenuLabel>
        <OrgChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The person's menu: the settings, the theme and the language (each
 * item named for what it switches to), the organisations in a submenu,
 * and the sign-out.
 */
function UserMenu() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { members } = useOrg();
  const profile = user ? members.get(user.id) : undefined;
  const name = memberName(profile, user?.email ?? "");
  const roleLabel = profile ? t(`role.${profile.role}`) : "";
  const nextLocale = locale === "fr" ? "en" : "fr";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="press flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent/60"
          title={t("shell.nav.account")}
        >
          <Avatar name={name} size="md" decorative />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{name}</span>
            {roleLabel ? (
              <span className="block truncate text-meta text-ink-soft">{roleLabel}</span>
            ) : null}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuItem asChild>
          <Link to="/app/settings">
            <Settings aria-hidden="true" />
            {t("nav.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleTheme}>
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          {t("common.theme")} ·{" "}
          {theme === "dark" ? t("common.theme.light") : t("common.theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setLocale(nextLocale)} lang={nextLocale}>
          <Languages aria-hidden="true" />
          {t("common.language")} · {t(`common.locale.${nextLocale}`)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Building2 aria-hidden="true" />
            {t("nav.switchOrg")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <OrgChoices />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t("common.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({
  onNavigate,
  inSheet = false,
}: {
  onNavigate?: (() => void) | undefined;
  /** Rendered in the phone menu: the top row leaves room for the sheet's close button. */
  inSheet?: boolean;
}) {
  return (
    <div className="flex h-full min-h-full flex-col gap-6 p-4">
      <div className={cn("flex h-10 items-center", inSheet ? "pl-1 pr-14" : "px-1")}>
        <BrandMark size="sm" to="/app" />
      </div>
      <OrgSwitcher />
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto border-t border-sidebar-border pt-4">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // The phone menu closes whenever the page changes, whatever opened it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <Sidebar />
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-sticky flex h-16 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur lg:hidden">
          <BrandMark size="sm" to="/app" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label={t("common.menu")}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            <Menu />
          </Button>
        </header>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="left"
            className="bg-sidebar p-0 text-sidebar-foreground sm:p-0 lg:hidden"
          >
            <SheetTitle className="sr-only">{t("common.menu")}</SheetTitle>
            <SheetDescription className="sr-only">{t("shell.nav.label")}</SheetDescription>
            <Sidebar inSheet onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 lg:px-10">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
