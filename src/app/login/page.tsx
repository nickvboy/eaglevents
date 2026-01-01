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
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRetryAt(null);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        identifier,
        password,
        callbackUrl,
      });
      if (res?.error) {
        const errorCode = decodeURIComponent(res.error);
        if (errorCode.startsWith("RateLimit:")) {
          const raw = errorCode.slice("RateLimit:".length);
          const parsed = Number(raw);
          const fallback = Date.now() + 15 * 60 * 1000;
          const target = Number.isFinite(parsed) ? parsed : fallback;
          setRetryAt(target);
          setError("Too many login attempts.");
        } else {
          setError("Invalid credentials");
        }
      } else if (res?.ok) {
        router.push(callbackUrl);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-primary">
      <div className="w-full max-w-[960px] overflow-hidden rounded-lg border border-outline-muted bg-surface-raised shadow-[var(--shadow-pane)] md:grid md:grid-cols-2">
        {/* Left brand panel */}
        <div className="hidden h-full flex-col justify-between border-r border-outline-muted bg-[radial-gradient(35rem_20rem_at_-10%_-20%,var(--color-accent-muted),transparent),linear-gradient(180deg,var(--color-surface-muted),var(--color-surface-canvas))] p-8 md:flex">
          <div className="text-2xl font-semibold tracking-tight">Eaglevents Calendar</div>
          <div className="text-sm text-ink-muted">Sign in to access your calendars and events.</div>
        </div>
        {/* Right sign-in form */}
        <div className="p-8">
          <div className="mb-6">
            <div className="text-2xl font-semibold">Sign in</div>
            <div className="text-sm text-ink-subtle">Use your account to continue</div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs uppercase text-ink-faint">Username or Email</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                placeholder="you@example.com or username"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-ink-faint">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-status-danger">
                {error}
                {retryAt ? ` Try again at ${new Date(retryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : null}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-accent-default px-4 py-2 text-sm font-medium text-ink-inverted transition hover:bg-accent-strong disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-between text-sm">
            <div className="text-ink-subtle">New to Eaglevents?</div>
            <Link href="/signup" className="text-accent-default hover:text-accent-soft">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

