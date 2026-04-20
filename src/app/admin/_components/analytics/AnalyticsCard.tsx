"use client";

import type { ReactNode } from "react";

type AnalyticsCardProps = {
  title: string;
  helper: string;
  children: ReactNode;
  toolbar?: ReactNode;
};

export function AnalyticsCard(props: AnalyticsCardProps) {
  return (
    <article className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink-primary">{props.title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{props.helper}</p>
        </div>
        {props.toolbar ? <div className="flex flex-wrap items-center gap-2">{props.toolbar}</div> : null}
      </header>
      <div className="mt-5">{props.children}</div>
    </article>
  );
}
