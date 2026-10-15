/**
 * The rail, the 64px column of every signed-in page from `lg`: the brand
 * square (32px of ink, the paper "V", the way to /app), four 44px icon
 * links with a tooltip on the right (the dashboard, the briefs, the
 * pool, the team, or the space when the person works alone), the active
 * one filled with the ink; at the bottom the theme switch (named for
 * what it switches to) and the person's disc, whose menu holds the
 * spaces (a check on the current one, the personal space first, named
 * "Espace personnel"), a new team, the settings, the language and the
 * sign-out. `RailItems` is the same content as rows with their words,
 * for the sheet the Workspace header opens below `lg`; `BrandSquare` is
 * the brand alone, for that header.
 */
import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Briefcase,
  Check,
  Languages,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";

import { useTheme } from "@/components/theme-context";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth/auth-context";
import { BRAND } from "@/lib/brand";
import type { OrganizationRow } from "@/lib/db/types";
import { useI18n, type Locale, type TranslationKey } from "@/lib/i18n";
import { memberName, useOrg, type OrgMembership } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

import { Avatar } from "./avatar";
import { ThemeToggle } from "./toggles";

/** A space of one person. `kind` is the column spaces.md adds: read through a cast until db/types.ts carries it. */
export function isPersonalSpace(org: OrganizationRow | null | undefined): boolean {
  return (org as { kind?: string } | null | undefined)?.kind === "personal";
}

/** How a space is named: the personal one by its kind, a team by its name. */
function spaceName(org: OrganizationRow, t: (key: TranslationKey) => string): string {
  return isPersonalSpace(org) ? t("nav.personalSpace") : org.name;
}

/** The person's spaces, the personal one first. */
function orderedSpaces(memberships: readonly OrgMembership[]): OrgMembership[] {
  return [...memberships].sort(
    (a, b) => Number(isPersonalSpace(b.org)) - Number(isPersonalSpace(a.org)),
  );
}

interface RailItem {
  to: string;
  key: TranslationKey;
  icon: ReactNode;
  exact?: boolean;
}

function isActive(item: RailItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** The four sections, the fourth named for the kind of space, and which one the page is in. */
function useRailItems(): { items: RailItem[]; activeIndex: number } {
  const { org } = useOrg();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const items: RailItem[] = [
    { to: "/app", key: "nav.dashboard", icon: <LayoutDashboard />, exact: true },
    { to: "/app/briefs", key: "nav.briefs", icon: <Briefcase /> },
    { to: "/app/candidates", key: "nav.candidates", icon: <Users /> },
    isPersonalSpace(org)
      ? { to: "/app/members", key: "nav.space", icon: <UserRound /> }
      : { to: "/app/members", key: "nav.members", icon: <UsersRound /> },
  ];
  return { items, activeIndex: items.findIndex((item) => isActive(item, pathname)) };
}

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The brand: a 32px square of ink with the paper initial, the way to the dashboard. */
export function BrandSquare({ className }: { className?: string | undefined }) {
  return (
    <Link
      to="/app"
      aria-label={BRAND.name}
      className={cn(
        "press flex size-8 shrink-0 items-center justify-center rounded-md bg-ink font-display text-base leading-none text-background",
        FOCUS,
        className,
      )}
    >
      <span aria-hidden="true">{BRAND.name.charAt(0)}</span>
    </Link>
  );
}

/** The person's disc and its menu: the spaces, a new team, the settings, the language, the sign-out. */
function PersonMenu() {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut } = useAuth();
  const { members, memberships, org, switchOrg } = useOrg();
  const profile = user ? members.get(user.id) : undefined;
  const name = memberName(profile, user?.email ?? "");
  const nextLocale: Locale = locale === "fr" ? "en" : "fr";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("shell.nav.account")} · ${name}`}
          className={cn(
            "press flex size-11 cursor-pointer items-center justify-center rounded-[10px] hover:bg-muted data-[state=open]:bg-muted",
            FOCUS,
          )}
        >
          <Avatar name={name} size="md" decorative />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64">
        <DropdownMenuLabel>{t("nav.switchOrg")}</DropdownMenuLabel>
        {orderedSpaces(memberships).map((membership) => (
          <DropdownMenuCheckboxItem
            key={membership.org.id}
            checked={membership.org.id === org?.id}
            onSelect={() => switchOrg(membership.org.id)}
          >
            <span className="min-w-0 flex-1 truncate">{spaceName(membership.org, t)}</span>
            {isPersonalSpace(membership.org) ? null : (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(`role.${membership.role}`)}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem asChild>
          <Link to="/app/organizations/new">
            <Plus aria-hidden="true" />
            {t("nav.newOrg")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/settings">
            <Settings aria-hidden="true" />
            {t("nav.settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setLocale(nextLocale)} lang={nextLocale}>
          <Languages aria-hidden="true" />
          {t("common.language")} · {t(`common.locale.${nextLocale}`)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t("common.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Rail({ className }: { className?: string | undefined }) {
  const { t } = useI18n();
  const { items, activeIndex } = useRailItems();
  return (
    <nav
      aria-label={t("shell.nav.label")}
      className={cn(
        "flex h-full min-h-0 w-16 flex-col items-center gap-1.5 border-r border-line bg-background py-3",
        className,
      )}
    >
      <BrandSquare className="mb-2.5" />
      {items.map((item, index) => {
        const active = index === activeIndex;
        const label = t(item.key);
        return (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <Link
                to={item.to}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press flex size-11 items-center justify-center rounded-[10px] [&_svg]:size-5",
                  FOCUS,
                  active ? "bg-ink text-background" : "text-muted-foreground hover:bg-muted hover:text-ink",
                )}
              >
                <span aria-hidden="true" className="inline-flex">
                  {item.icon}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
      <div className="flex-1" />
      <ThemeToggle rail />
      <PersonMenu />
    </nav>
  );
}

/** One row of the phone menu: a 44px link or button with its one icon and its word. */
function MenuRow({
  to,
  icon,
  current = false,
  onSelect,
  lang,
  children,
}: {
  to?: string | undefined;
  icon: ReactNode;
  current?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  lang?: Locale | undefined;
  children: ReactNode;
}) {
  const className = cn(
    "press flex h-11 w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5 [&_svg]:shrink-0",
    current ? "bg-ink text-background" : "text-ink hover:bg-muted",
  );
  const content = (
    <>
      <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
  if (to !== undefined) {
    return (
      <Link
        to={to}
        onClick={onSelect}
        aria-current={current ? "page" : undefined}
        lang={lang}
        className={className}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={current ? "true" : undefined}
      lang={lang}
      className={className}
    >
      {content}
    </button>
  );
}

/**
 * The rail's content as rows with their words, for the sheet the
 * Workspace header opens below `lg`: the sections, the spaces with the
 * current one checked, a new team, then the person, the settings, the
 * theme, the language and the sign-out. `onNavigate` closes the sheet.
 */
export function RailItems({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { members, memberships, org, switchOrg } = useOrg();
  const { items, activeIndex } = useRailItems();
  const profile = user ? members.get(user.id) : undefined;
  const name = memberName(profile, user?.email ?? "");
  const nextLocale: Locale = locale === "fr" ? "en" : "fr";
  const themeLabel = theme === "dark" ? t("common.theme.light") : t("common.theme.dark");
  return (
    <nav aria-label={t("shell.nav.label")} className="flex h-full flex-col overflow-y-auto">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 pr-14">
        <BrandSquare />
        <span className="font-display text-base text-ink">{BRAND.name}</span>
      </div>
      <ul className="flex flex-col gap-0.5 p-2">
        {items.map((item, index) => (
          <li key={item.to}>
            <MenuRow
              to={item.to}
              icon={item.icon}
              current={index === activeIndex}
              onSelect={onNavigate}
            >
              {t(item.key)}
            </MenuRow>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-2">
        <p className="label-caps px-3 py-2">{t("nav.switchOrg")}</p>
        <ul className="flex flex-col gap-0.5">
          {orderedSpaces(memberships).map((membership) => {
            const current = membership.org.id === org?.id;
            return (
              <li key={membership.org.id}>
                <MenuRow
                  icon={current ? <Check /> : null}
                  onSelect={() => {
                    switchOrg(membership.org.id);
                    onNavigate?.();
                  }}
                >
                  {spaceName(membership.org, t)}
                </MenuRow>
              </li>
            );
          })}
          <li>
            <MenuRow to="/app/organizations/new" icon={<Plus />} onSelect={onNavigate}>
              {t("nav.newOrg")}
            </MenuRow>
          </li>
        </ul>
      </div>
      <div className="mt-auto border-t border-line p-2">
        <div className="flex items-center gap-3 px-3 py-2">
          <Avatar name={name} size="sm" decorative />
          <span className="min-w-0 truncate text-sm font-medium text-ink">{name}</span>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <MenuRow to="/app/settings" icon={<Settings />} onSelect={onNavigate}>
              {t("nav.settings")}
            </MenuRow>
          </li>
          <li>
            <MenuRow icon={theme === "dark" ? <Sun /> : <Moon />} onSelect={toggleTheme}>
              {t("common.theme")} · {themeLabel}
            </MenuRow>
          </li>
          <li>
            <MenuRow
              icon={<Languages />}
              onSelect={() => setLocale(nextLocale)}
              lang={nextLocale}
            >
              {t("common.language")} · {t(`common.locale.${nextLocale}`)}
            </MenuRow>
          </li>
          <li>
            <MenuRow icon={<LogOut />} onSelect={() => void signOut()}>
              {t("common.signOut")}
            </MenuRow>
          </li>
        </ul>
      </div>
    </nav>
  );
}
