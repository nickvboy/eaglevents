"use client";

import { useState, useRef, useEffect } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";

type Props = {
  user: Session["user"] | null;
  variant?: "default" | "icon";
  menuPlacement?: "down" | "up";
  menuAlign?: "left" | "right";
};

export function AccountMenu({ user, variant = "icon", menuPlacement = "down", menuAlign = "right" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const email = user?.email ?? "";
  const name = user?.name ?? email?.split("@")[0] ?? "User";
  const initials = (name || "U").slice(0, 1).toUpperCase();

  const isIcon = variant === "icon";
  const buttonClass = isIcon
    ? "inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent-strong text-sm font-semibold text-ink-inverted shadow hover:bg-accent-default focus:outline-none focus:ring-2 focus:ring-accent-soft"
    : "flex items-center gap-2 rounded-md border border-outline-muted bg-surface-muted px-2 py-1 text-sm text-ink-primary hover:bg-surface-muted";
  const menuPositionClass =
    menuPlacement === "up" ? "bottom-full mb-2" : "mt-1";
  const menuAlignClass = menuAlign === "left" ? "left-0" : "right-0";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
        aria-label={email ? `Account menu for ${email}` : "Account menu"}
      >
        {isIcon ? (
          <span className="text-sm font-semibold">{initials}</span>
        ) : (
          <>
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-strong text-xs text-ink-inverted">
              {initials}
            </span>
            <span className="max-w-[180px] truncate text-ink-primary">{email}</span>
          </>
        )}
      </button>
      {open && (
        <div
          className={`absolute ${menuAlignClass} ${menuPositionClass} z-[999] w-48 rounded-md border border-outline-muted bg-surface-raised p-1 text-sm text-ink-primary shadow-lg`}
        >
          <button
            className="block w-full rounded-md px-2 py-1 text-left hover:bg-surface-muted"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
