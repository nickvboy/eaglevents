"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, HomeIcon, ShieldIcon } from "./icons";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/admin", label: "Admin", icon: ShieldIcon },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center border-r border-outline-muted bg-[linear-gradient(180deg,var(--color-surface-sunken),var(--color-surface-canvas))] py-6 text-ink-primary shadow-[2px_0_18px_rgba(0,0,0,0.55)]">
      <nav className="flex w-full flex-1 flex-col items-center gap-4" aria-label="Main">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== "/" && (pathname?.startsWith(item.href) ?? false));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={`Go to ${item.label}`}
              aria-current={isActive ? "page" : undefined}
              className="group relative flex w-full items-center justify-center py-1"
            >
              <span
                aria-hidden
                className={
                  "absolute left-0 h-8 w-[3px] rounded-full transition " +
                  (isActive ? "bg-accent-default shadow-[var(--shadow-accent-glow)]" : "bg-transparent group-hover:bg-outline-muted")
                }
              />
              <Icon
                className={
                  "h-5 w-5 transition " +
                  (isActive
                    ? "text-accent-soft drop-shadow-[var(--shadow-accent-glow)]"
                    : "text-ink-muted group-hover:text-ink-primary")
                }
              />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
