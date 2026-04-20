"use client";

type Kpi = {
  id: string;
  label: string;
  value: number;
  helper?: string;
  suffix?: string;
};

function formatValue(value: number, suffix?: string) {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  return suffix ? `${formatted}${suffix}` : formatted;
}

export function AnalyticsKpiGrid({ items }: { items: Kpi[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-2xl border border-outline-muted bg-[radial-gradient(circle_at_top,var(--color-surface-overlay),transparent)] p-5 shadow-[var(--shadow-pane)]"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">{item.label}</p>
          <div className="mt-3 text-3xl font-semibold text-ink-primary">{formatValue(item.value, item.suffix)}</div>
          {item.helper ? <p className="mt-2 text-sm text-ink-muted">{item.helper}</p> : null}
        </article>
      ))}
    </section>
  );
}
