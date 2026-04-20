"use client";

export function AnalyticsLoadingState({ cards = 3 }: { cards?: number }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="h-80 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
      ))}
    </div>
  );
}
