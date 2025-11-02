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
        router.push(callbackUrl);
      } else {
        router.push("/login?registered=1");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="w-full max-w-md rounded-xl bg-white/10 p-6">
        <h1 className="mb-4 text-2xl font-semibold">Create your account</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/60"
              placeholder="yourname"
              autoComplete="username"
              required
              minLength={3}
              maxLength={50}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-full bg-white/10 px-4 py-2 text-white placeholder:text-white/60"
              placeholder="you@example.com"
              autoComplete="email"
              required
              maxLength={255}
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
              autoComplete="new-password"
              required
              minLength={8}
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
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-white/80">
          Already have an account?{" "}
          <Link href="/login" className="underline hover:text-white">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
