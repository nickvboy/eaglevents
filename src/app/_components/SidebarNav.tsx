"use client";

import type { ComponentType } from "react";
import type { Session } from "next-auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, HomeIcon, ReportIcon, SettingsIcon, ShieldIcon } from "./icons";
import { AccountMenu } from "../calendar/_components/AccountMenu";
import { api } from "~/trpc/react";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const baseNavItems: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/tickets", label: "Tickets", icon: ReportIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const adminNavItem: NavItem = { href: "/admin", label: "Admin", icon: ShieldIcon };

type SidebarNavProps = {
  user: Session["user"] | null;
  profileFirstName?: string | null;
};

export function SidebarNav(props: SidebarNavProps) {
  const { user, profileFirstName } = props;
  const pathname = usePathname();
  const permissionsQuery = api.admin.permissions.useQuery();
  const canAccessAdmin = (permissionsQuery.data?.capabilities?.length ?? 0) > 0;
  const navItems = canAccessAdmin ? [...baseNavItems, adminNavItem] : baseNavItems;

  return (
    <aside className="fixed bottom-0 left-0 right-0 z-60 flex h-16 w-full shrink-0 items-center border-t border-outline-muted bg-[linear-gradient(180deg,var(--color-surface-sunken),var(--color-surface-canvas))] px-2 text-ink-primary shadow-[0_-6px_18px_rgba(0,0,0,0.35)] md:sticky md:top-0 md:h-screen md:w-16 md:flex-col md:items-center md:border-t-0 md:border-r md:px-0 md:py-6 md:shadow-[2px_0_18px_rgba(0,0,0,0.55)]">
      <nav className="flex w-full flex-1 items-center justify-between gap-0 md:flex-col md:justify-start md:gap-4" aria-label="Main">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== "/" && (pathname?.startsWith(item.href) ?? false));
          const Icon = item.icon;
          const indicatorClass = isActive
            ? "bg-accent-default shadow-[var(--shadow-accent-glow)]"
            : "bg-transparent group-hover:bg-outline-muted";
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={`Go to ${item.label}`}
              aria-current={isActive ? "page" : undefined}
              className="group relative flex flex-1 items-center justify-center py-2 md:h-auto md:w-full md:flex-none md:py-1"
            >
              <span
                aria-hidden
                className={`absolute bottom-0 left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full transition md:hidden ${indicatorClass}`}
              />
              <span
                aria-hidden
                className={`absolute left-0 h-8 w-[3px] rounded-full transition hidden md:block ${indicatorClass}`}
              />
              <Icon
                className={
                  "h-5 w-5 transition " +
                  (isActive
                    ? "text-accent-strong drop-shadow-[var(--shadow-accent-glow)]"
                    : "text-ink-muted group-hover:text-ink-primary")
                }
              />
            </Link>
          );
        })}
        <div className="flex flex-1 items-center justify-center md:hidden">
          <AccountMenu
            user={user}
            profileFirstName={profileFirstName}
            variant="icon"
            menuPlacement="up"
            menuAlign="right"
          />
        </div>
      </nav>
      <div className="hidden md:mt-auto md:flex md:pb-2">
        <AccountMenu
          user={user}
          profileFirstName={profileFirstName}
          variant="icon"
          menuPlacement="up"
          menuAlign="left"
        />
      </div>
    </aside>
  );
}
