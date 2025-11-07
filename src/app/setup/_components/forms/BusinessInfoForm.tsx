"use client";

import { useEffect, useState } from "react";

import { api } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";

const businessTypes = [
  { value: "university", label: "University" },
  { value: "nonprofit", label: "Non-profit" },
  { value: "corporation", label: "Corporation" },
  { value: "government", label: "Government" },
  { value: "venue", label: "Venue / Facility" },
  { value: "other", label: "Other" },
] as const;

export function BusinessInfoForm({ status, onUpdated }: { status: SetupStatusData; onUpdated: () => void }) {
  const mutation = api.setup.createBusiness.useMutation({
    onSuccess: () => {
      onUpdated();
    },
  });
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof businessTypes)[number]["value"]>("university");

  useEffect(() => {
    if (status.business) {
      setName(status.business.name);
      setType(status.business.type);
    }
  }, [status.business]);

  if (status.business) {
    return (
      <div>
        <h2 className="text-xl font-semibold">Organization details</h2>
        <p className="mt-1 text-sm text-white/60">Business information has been captured.</p>
        <div className="mt-4 rounded-md border border-white/10 bg-black/60 p-4 text-sm">
          <div className="font-medium">{status.business.name}</div>
          <div className="text-white/60 capitalize">{status.business.type}</div>
        </div>
        <p className="mt-4 text-xs text-white/50">
          Need to change this later? Navigate to Organization settings after setup.
        </p>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await mutation.mutateAsync({ name: name.trim(), type });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Tell us about your organization</h2>
        <p className="mt-1 text-sm text-white/60">This anchors calendars, departments, and permissions.</p>
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Business name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-white/15 bg-black/50 px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring"
          placeholder="Eagle Events AV"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Business type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as (typeof businessTypes)[number]["value"])}
          className="w-full rounded-md border border-white/15 bg-black/50 px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring"
        >
          {businessTypes.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {mutation.error ? <p className="text-sm text-red-300">{mutation.error.message}</p> : null}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {mutation.isPending ? "Saving..." : "Save and continue"}
      </button>
    </form>
  );
}
