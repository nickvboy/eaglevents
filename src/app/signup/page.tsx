"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { PasswordInput } from "~/app/_components/PasswordInput";

export default function SignupPage() {
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

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    setRetryAt(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : null;
        const retry =
          payload && typeof payload === "object" && "retryAt" in payload && typeof (payload as { retryAt?: unknown }).retryAt === "number"
            ? (payload as { retryAt: number }).retryAt
            : null;
        setError(message ?? "Failed to sign up");
        setRetryAt(retry);
        return;
      }
      const login = await signIn("credentials", {
        redirect: false,
        identifier: email || username,
        password,
        callbackUrl,
      });
      if (login?.ok) {
        const profileSetupUrl = `/profile/new?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        router.push(profileSetupUrl);
      } else {
        router.push("/login?registered=1");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-primary">
      <div className="w-full max-w-[960px] overflow-hidden rounded-lg border border-outline-muted bg-surface-raised shadow-[var(--shadow-pane)] md:grid md:grid-cols-2">
        <div className="hidden h-full flex-col justify-between border-r border-outline-muted bg-[radial-gradient(35rem_20rem_at_-10%_-20%,var(--color-accent-muted),transparent),linear-gradient(180deg,var(--color-surface-muted),var(--color-surface-canvas))] p-8 md:flex">
          <div className="text-2xl font-semibold tracking-tight">Create account</div>
          <div className="text-sm text-ink-muted">Set up your profile to get started.</div>
        </div>
        <div className="p-8">
          <div className="mb-6">
            <div className="text-2xl font-semibold">Create your account</div>
            <div className="text-sm text-ink-subtle">Use a valid email and a strong password</div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs uppercase text-ink-faint">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                placeholder="yourname"
                autoComplete="username"
                required
                minLength={3}
                maxLength={50}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-ink-faint">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                placeholder="you@example.com"
                autoComplete="email"
                required
                maxLength={255}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-ink-faint">Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                placeholder="Enter a strong password"
                autoComplete="new-password"
                required
                minLength={8}
                visible={showPasswords}
                onToggleVisibility={() => setShowPasswords((prev) => !prev)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-ink-faint">Confirm password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
                minLength={8}
                visible={showPasswords}
                onToggleVisibility={() => setShowPasswords((prev) => !prev)}
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
              {loading ? "Creating..." : "Create account"}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-between text-sm">
            <div className="text-ink-subtle">Already have an account?</div>
            <Link href="/login" className="text-accent-default hover:text-accent-soft">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

