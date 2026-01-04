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
  const lockShellScroll = Boolean(pathname?.startsWith("/calendar"));
  const shellHeightClass = hideShell ? "min-h-screen" : "h-screen";
  const useShellScroll = !hideShell && !lockShellScroll;

  return (
    <div className={`flex ${shellHeightClass} ${useShellScroll ? "overflow-hidden" : ""} flex-col md:flex-row`}>
      {!hideShell ? <SidebarNav user={user} /> : null}
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {!hideShell ? (
          <div className="shrink-0">
            <GlobalSearch enabled={Boolean(user?.id)} />
          </div>
        ) : null}
        <main
          className={
            "flex min-h-0 flex-1 flex-col bg-surface-canvas pb-16 md:pb-0 " +
            (lockShellScroll ? "overflow-hidden" : useShellScroll ? "overflow-y-auto" : "")
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
