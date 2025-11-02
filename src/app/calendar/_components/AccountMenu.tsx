"use client";

import { useState, useRef, useEffect } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";

type Props = {
  user: Session["user"] | null;
  variant?: "default" | "icon";
};

export function AccountMenu({ user, variant = "icon" }: Props) {
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
    ? "inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-black shadow hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
    : "flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-white hover:bg-white/10";

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
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-black">
              {initials}
            </span>
            <span className="max-w-[180px] truncate text-white/90">{email}</span>
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-white/10 bg-neutral-950 p-1 text-sm text-white shadow-lg">
          <button
            className="block w-full rounded-md px-2 py-1 text-left hover:bg-white/10"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
