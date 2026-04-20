"use client";

import type { AnalyticsCalendarCell } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

export function CalendarHeatmapCard(props: {
  title: string;
  helper: string;
  cells: AnalyticsCalendarCell[];
  toolbar?: React.ReactNode;
}) {
  if (props.cells.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  const maxValue = Math.max(...props.cells.map((cell) => cell.value), 1);
  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="grid grid-cols-7 gap-2">
        {props.cells.map((cell) => {
          const opacity = cell.value <= 0 ? 0.08 : Math.max(0.16, cell.value / maxValue);
          return (
            <div
              key={cell.dateKey}
              className="rounded-lg border border-outline-muted p-2 text-center"
              style={{ backgroundColor: `rgba(29, 78, 216, ${opacity})` }}
              title={`${cell.label}: ${cell.value}`}
            >
              <div className="text-xs font-semibold text-ink-primary">{cell.date.getUTCDate()}</div>
              <div className="mt-1 text-[11px] text-ink-muted">{cell.value}</div>
            </div>
          );
        })}
      </div>
    </AnalyticsCard>
  );
}
