"use client";

export function ReportsPlaceholder() {
  return (
    <div className="rounded-2xl border border-dashed border-outline-muted bg-surface-muted p-10 text-center shadow-[var(--shadow-pane)]">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h2 className="text-2xl font-semibold text-ink-primary">Reports workspace coming soon</h2>
        <p className="text-sm text-ink-muted">
          We&apos;re gathering requirements for the reporting suite. Once ready, this space will let you build
          executive dashboards, export rollups, and share snapshots with leadership.
        </p>
        <p className="text-sm text-ink-muted">
          Have ideas or data needs? Capture them now so we can prioritize the first release.
        </p>
      </div>
    </div>
  );
}


