"use client";

import type { AnalyticsBoxPlotDatum } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

export function BoxPlotCard(props: {
  title: string;
  helper: string;
  data: AnalyticsBoxPlotDatum[];
  toolbar?: React.ReactNode;
}) {
  if (props.data.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  const maxValue = Math.max(...props.data.map((item) => item.max), 1);
  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="space-y-4">
        {props.data.map((item) => {
          const left = (item.min / maxValue) * 100;
          const q1 = (item.q1 / maxValue) * 100;
          const median = (item.median / maxValue) * 100;
          const q3 = (item.q3 / maxValue) * 100;
          const right = (item.max / maxValue) * 100;
          return (
            <div key={item.key}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-ink-primary">{item.label}</div>
                <div className="text-xs text-ink-muted">Median {item.median}h</div>
              </div>
              <div className="relative h-8 rounded-full bg-surface-muted">
                <div className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-outline-muted" style={{ left: `${left}%`, width: `${Math.max(right - left, 1)}%` }} />
                <div className="absolute top-2 bottom-2 rounded-full bg-accent-muted" style={{ left: `${q1}%`, width: `${Math.max(q3 - q1, 2)}%` }} />
                <div className="absolute top-1 bottom-1 w-[3px] rounded-full bg-accent-strong" style={{ left: `${median}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </AnalyticsCard>
  );
}
