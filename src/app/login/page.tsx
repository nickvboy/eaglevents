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
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="w-full max-w-md rounded-xl bg-white/10 p-6">
        <h1 className="mb-4 text-2xl font-semibold">Sign in</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm">Username or Email</label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/60"
              placeholder="you@example.com or username"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/60"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-white/80">
          No account?{" "}
          <Link href="/signup" className="underline hover:text-white">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
