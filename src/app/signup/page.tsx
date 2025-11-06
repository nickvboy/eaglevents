"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to sign up");
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
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <div className="w-full max-w-[960px] overflow-hidden rounded-lg border border-white/10 bg-neutral-950 shadow-xl md:grid md:grid-cols-2">
        <div className="hidden h-full flex-col justify-between border-r border-white/10 bg-[radial-gradient(35rem_20rem_at_-10%_-20%,#093,#000),linear-gradient(#0a0a0a,#090909)] p-8 md:flex">
          <div className="text-2xl font-semibold tracking-tight">Create account</div>
          <div className="text-sm text-white/70">Set up your profile to get started.</div>
        </div>
        <div className="p-8">
          <div className="mb-6">
            <div className="text-2xl font-semibold">Create your account</div>
            <div className="text-sm text-white/60">Use a valid email and a strong password</div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="yourname"
                autoComplete="username"
                required
                minLength={3}
                maxLength={50}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="you@example.com"
                autoComplete="email"
                required
                maxLength={255}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="Enter a strong password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {loading ? "Creating…" : "Create account"}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-between text-sm">
            <div className="text-white/60">Already have an account?</div>
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
