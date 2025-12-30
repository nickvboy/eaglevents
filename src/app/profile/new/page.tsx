"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

function formatPhone(digits: string) {
  const cleaned = digits.replace(/\D/g, "").slice(0, 10);
  const len = cleaned.length;
  if (len === 0) return "";
  if (len < 4) return cleaned;
  if (len < 7) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
  }
  return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
}

function sanitizeCallback(raw: string | null) {
  if (!raw) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("/")) return decoded;
  } catch {
    // ignore
  }
  return "/";
}

export default function CreateProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const callbackUrl = useMemo(
    () => sanitizeCallback(searchParams.get("callbackUrl")),
    [searchParams],
  );

  const profilePath = useMemo(() => {
    const base = "/profile/new";
    if (callbackUrl && callbackUrl !== "/") {
      return `${base}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    }
    return base;
  }, [callbackUrl]);

  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(profilePath)}`);
    }
  }, [profilePath, router, status]);

  useEffect(() => {
    if (!session?.user?.email || emailTouched || email) return;
    setEmail(session.user.email);
  }, [session?.user?.email, emailTouched, email]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    async function loadProfile() {
      try {
        const res = await fetch("/api/profile", { method: "GET" });
        if (!res.ok) {
          throw new Error("Failed to load profile");
        }
        const data = (await res.json()) as {
          profile: {
            firstName: string;
            lastName: string;
            email: string;
            phoneNumber: string;
            dateOfBirth: string | null;
          } | null;
        };
        if (!active) return;
        if (data.profile) {
          setFirstName(data.profile.firstName ?? "");
          setLastName(data.profile.lastName ?? "");
          setEmail(data.profile.email);
          setEmailTouched(true);
          const digits = (data.profile.phoneNumber ?? "").replace(/\D/g, "").slice(0, 10);
          setPhoneDigits(digits);
          setDateOfBirth(data.profile.dateOfBirth ?? "");
        }
      } catch {
        // Ignore fetch errors; user can re-submit
      } finally {
        if (active) setLoadingProfile(false);
      }
    }
    void loadProfile();
    return () => {
      active = false;
    };
  }, [status]);

  const phoneDisplay = useMemo(() => formatPhone(phoneDigits), [phoneDigits]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const digits = phoneDigits.replace(/\D/g, "").slice(0, 10);
    if (digits.length < 10) {
      setError("Enter a valid phone number with at least 10 digits.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("Provide both first and last name.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          phoneNumber: digits,
          dateOfBirth: dateOfBirth.trim() ? dateOfBirth : undefined,
        }),
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : null;
        setError(message ?? "Failed to save profile.");
        return;
      }
      router.push(callbackUrl);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
      <div className="w-full max-w-[960px] overflow-hidden rounded-lg border border-white/10 bg-neutral-950 shadow-xl md:grid md:grid-cols-2">
        <div className="hidden h-full flex-col justify-between border-r border-white/10 bg-[radial-gradient(35rem_20rem_at_-10%_-20%,#093,#000),linear-gradient(#0a0a0a,#090909)] p-8 md:flex">
          <div className="text-2xl font-semibold tracking-tight">Complete your profile</div>
          <div className="text-sm text-white/70">
            Tell us how to reach you so we can tailor Eaglevents to your needs.
          </div>
        </div>
        <div className="p-8">
          <div className="mb-6">
            <div className="text-2xl font-semibold">Your contact details</div>
            <div className="text-sm text-white/60">
              Update a few basics to finish setting up your account.
            </div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs uppercase text-white/60">First name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                  placeholder="Jane"
                  autoComplete="given-name"
                  required
                  maxLength={100}
                  disabled={loadingProfile || submitting}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase text-white/60">Last name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                  placeholder="Doe"
                  autoComplete="family-name"
                  required
                  maxLength={100}
                  disabled={loadingProfile || submitting}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmailTouched(true);
                  setEmail(e.target.value);
                }}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="you@example.com"
                autoComplete="email"
                required
                maxLength={255}
                disabled={loadingProfile || submitting}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">Phone number</label>
              <input
                type="tel"
                inputMode="tel"
                value={phoneDisplay}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setPhoneDigits(digits);
                }}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                placeholder="(555) 123-4567"
                autoComplete="tel"
                required
                disabled={loadingProfile || submitting}
              />
              <p className="mt-1 text-xs text-white/40">
                Format updates automatically as you type.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-white/60">
                Date of birth (optional)
              </label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none ring-emerald-500/50 placeholder:text-white/40 focus:ring"
                autoComplete="bday"
                disabled={loadingProfile || submitting}
              />
            </div>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={loadingProfile || submitting}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Save profile"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
