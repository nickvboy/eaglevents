"use client";

export function ReportsPlaceholder() {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-black/30 p-10 text-center shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h2 className="text-2xl font-semibold text-white">Reports workspace coming soon</h2>
        <p className="text-sm text-white/60">
          We&apos;re gathering requirements for the reporting suite. Once ready, this space will let you build
          executive dashboards, export rollups, and share snapshots with leadership.
        </p>
        <p className="text-sm text-white/60">
          Have ideas or data needs? Capture them now so we can prioritize the first release.
        </p>
      </div>
    </div>
  );
}

