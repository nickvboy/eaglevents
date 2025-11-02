"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const rawCallback = params.get("callbackUrl") ?? "/";
  const callbackUrl = (() => {
    try {
      const u = new URL(rawCallback, window.location.origin);
      return u.origin === window.location.origin ? u.pathname + u.search + u.hash : "/";
    } catch {
      return "/";
    }
  })();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        identifier,
        password,
        callbackUrl,
      });
      if (res?.error) {
        setError("Invalid credentials");
      } else if (res?.ok) {
        router.push(callbackUrl);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <div className="w-full max-w-[960px] overflow-hidden rounded-lg border border-white/10 bg-neutral-950 shadow-xl md:grid md:grid-cols-2">
        {/* Left brand panel */}
        <div className="hidden h-full flex-col justify-between border-r border-white/10 bg-[radial-gradient(35rem_20rem_at_-10%_-20%,#093,#000),linear-gradient(#0a0a0a,#090909)] p-8 md:flex">
          <div className="text-2xl font-semibold tracking-tight">Eaglevents Calendar</div>
          <div className="text-sm text-white/70">Sign in to access your calendars and events.</div>
        </div>
        {/* Right sign-in form */}
        <div className="p-8">
          <div className="mb-6">
            <div className="text-2xl font-semibold">Sign in</div>
            <div className="text-sm text-white/60">Use your account to continue</div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Username or Email</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="you@example.com or username"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </div>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-between text-sm">
            <div className="text-white/60">New to Eaglevents?</div>
            <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

