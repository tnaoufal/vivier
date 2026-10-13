/**
 * The frame of every signed-in page: a sidebar with the organisation,
 * the five sections and the person; a slim header on phones. Content
 * renders in the outlet with a fixed reading width.
 */
import { useState, type ReactNode } from "react";
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
    <nav className="flex flex-col gap-0.5" aria-label="Sections">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors [&_svg]:size-4",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.icon}
            {t(item.key)}
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
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border px-2.5 py-2 text-left text-sm hover:bg-sidebar-accent/60"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-xs font-semibold text-primary">
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{org.name}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("nav.switchOrg")}</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.org.id} onSelect={() => switchOrg(m.org.id)} className="gap-2">
            <span className="min-w-0 flex-1 truncate">{m.org.name}</span>
            <span className="text-xs text-muted-foreground">{t(`role.${m.role}`)}</span>
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
  const name = memberName(user ? members.get(user.id) : undefined, user?.email ?? "");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent/60">
          <Avatar name={name} size="sm" />
          <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
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
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center justify-between px-1 pt-1">
        <BrandMark size="sm" to="/app" />
        <div className="flex items-center">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>
      <OrgSwitcher />
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto border-t border-sidebar-border pt-3">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:block lg:h-screen">
        <Sidebar />
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <BrandMark size="sm" to="/app" />
          <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
            {open ? <X /> : <Menu />}
          </Button>
        </header>
        {open ? (
          <div className="fixed inset-0 top-14 z-10 bg-sidebar text-sidebar-foreground lg:hidden">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
