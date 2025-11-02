"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

export function UserBar(props: { name?: string | null; email?: string | null }) {
  const display = props.name ?? props.email ?? "User";
  const router = useRouter();
  return (
    <div className="mx-auto mb-6 flex w-full max-w-md items-center justify-between rounded-full bg-white/10 px-4 py-2.5 text-white shadow-sm">
      <span className="text-sm">Signed in as <span className="font-semibold">{display}</span></span>
      <button
        className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium hover:bg-white/20"
        onClick={async () => {
          await signOut({ redirect: false });
          router.replace("/login");
        }}
      >
        Sign out
      </button>
    </div>
  );
}
