/**
 * The frame of every signed-in page: a 256px sidebar with the brand, the
 * organisation switcher (name and plan), the five sections and, at the
 * bottom, the person (avatar, name, role) with their menu. On phones a
 * top bar with the brand opens the same sidebar as a full-screen menu,
 * closed on navigation. Content renders in the outlet, centred, at most
 * 72rem wide.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Briefcase,
  ChevronsUpDown,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  Settings,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/auth-context";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { memberName, useOrg } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import { Avatar } from "./avatar";
import { Pill } from "./pill";
import { LocaleToggle, ThemeToggle } from "./toggles";

interface NavItem {
  to: string;
  key: TranslationKey;
  icon: ReactNode;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { to: "/app", key: "nav.dashboard", icon: <LayoutDashboard />, exact: true },
  { to: "/app/candidates", key: "nav.candidates", icon: <Users /> },
  { to: "/app/briefs", key: "nav.briefs", icon: <Briefcase /> },
  { to: "/app/shortlists", key: "nav.shortlists", icon: <ListChecks /> },
  { to: "/app/activity", key: "nav.activity", icon: <Activity /> },
];

function NavLinks({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-1" aria-label={t("shell.nav.label")}>
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px] [&_svg]:shrink-0",
              active
                ? "bg-primary/10 text-primary"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.icon}
            <span className="truncate">{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function OrgSwitcher() {
  const { t } = useI18n();
  const { memberships, org, switchOrg } = useOrg();
  if (!org) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-sidebar-border bg-card p-3 text-left transition-colors duration-150 ease-out-soft hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("nav.switchOrg")}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-display text-base text-primary">
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{org.name}</span>
            <span className="mt-1 block">
              <Pill tone="primary">{t(`shell.org.plan.${org.plan}`)}</Pill>
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("nav.switchOrg")}</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.org.id} onSelect={() => switchOrg(m.org.id)} className="gap-2">
            <span className="min-w-0 flex-1 truncate">{m.org.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{t(`role.${m.role}`)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/organizations/new" className="gap-2">
            <Plus className="size-4" />
            {t("nav.newOrg")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const { members, can } = useOrg();
  const profile = user ? members.get(user.id) : undefined;
  const name = memberName(profile, user?.email ?? "");
  const roleLabel = profile ? t(`role.${profile.role}`) : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 ease-out-soft hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("shell.nav.account")}
        >
          <Avatar name={name} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{name}</span>
            {roleLabel ? <span className="block truncate text-[13px] leading-5 text-muted-foreground">{roleLabel}</span> : null}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/app/account" className="gap-2">
            <UserRound className="size-4" />
            {t("nav.account")}
          </Link>
        </DropdownMenuItem>
        {can("admin") ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/app/members" className="gap-2">
                <Users className="size-4" />
                {t("nav.members")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/app/settings" className="gap-2">
                <Settings className="size-4" />
                {t("nav.settings")}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="gap-2">
          <LogOut className="size-4" />
          {t("common.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  return (
    <div className="flex h-full min-h-full flex-col gap-6 p-4">
      <div className="flex items-center justify-between px-1">
        <BrandMark size="sm" to="/app" />
        <div className="flex items-center gap-0.5">
          <LocaleToggle />
          <ThemeToggle />
        </div>
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
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <Sidebar />
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <BrandMark size="sm" to="/app" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? t("common.closeMenu") : t("common.menu")}
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </header>
        {open ? (
          <div className="fixed inset-0 top-16 z-10 overflow-y-auto bg-sidebar text-sidebar-foreground lg:hidden">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
