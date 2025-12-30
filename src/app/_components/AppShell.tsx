"use client";

import type { ReactNode } from "react";
import type { Session } from "next-auth";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./SidebarNav";
import { GlobalSearch } from "./GlobalSearch";

const HIDE_SHELL_PATHS = ["/login", "/signup", "/setup"];

type AppShellProps = {
  user: Session["user"] | null;
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const hideShell =
    HIDE_SHELL_PATHS.some((base) => pathname === base || (base !== "/" && pathname?.startsWith(`${base}/`)));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {!hideShell ? <SidebarNav user={user} /> : null}
      <div className="flex min-h-screen flex-1 flex-col">
        {!hideShell ? <GlobalSearch enabled={Boolean(user?.id)} /> : null}
        <main className="flex min-h-0 flex-1 flex-col bg-surface-canvas pb-16 md:pb-0">{children}</main>
      </div>
    </div>
  );
}
