"use client";

export function CoverageBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border border-outline-muted bg-surface-muted px-3 py-1 text-xs font-medium text-ink-muted">
      {label}: {value}%
    </span>
  );
}
