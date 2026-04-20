"use client";

export function EmptyAnalyticsState({ message = "No events match the current filters." }: { message?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-outline-muted bg-surface-muted px-4 py-10 text-center text-sm text-ink-muted">
      {message}
    </div>
  );
}
