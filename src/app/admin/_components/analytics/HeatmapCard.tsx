"use client";

import type { AnalyticsHeatmapCell } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

export function HeatmapCard(props: {
  title: string;
  helper: string;
  cells: AnalyticsHeatmapCell[];
  toolbar?: React.ReactNode;
}) {
  if (props.cells.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  const xLabels = Array.from(new Set(props.cells.map((cell) => cell.xLabel)));
  const yLabels = Array.from(new Set(props.cells.map((cell) => cell.yLabel)));
  const maxValue = Math.max(...props.cells.map((cell) => cell.value), 1);
  const lookup = new Map(props.cells.map((cell) => [`${cell.xLabel}:${cell.yLabel}`, cell.value]));

  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] gap-2" style={{ gridTemplateColumns: `140px repeat(${xLabels.length}, minmax(0, 1fr))` }}>
          <div />
          {xLabels.map((label) => (
            <div key={label} className="text-center text-xs text-ink-muted">{label}</div>
          ))}
          {yLabels.map((yLabel) => (
            <div key={yLabel} className="contents">
              <div className="flex items-center text-sm text-ink-muted">{yLabel}</div>
              {xLabels.map((xLabel) => {
                const value = lookup.get(`${xLabel}:${yLabel}`) ?? 0;
                const opacity = value <= 0 ? 0.08 : Math.max(0.14, value / maxValue);
                return (
                  <div
                    key={`${xLabel}:${yLabel}`}
                    className="flex aspect-square items-center justify-center rounded-lg border border-outline-muted text-xs font-semibold text-ink-primary"
                    style={{ backgroundColor: `rgba(15, 118, 110, ${opacity})` }}
                    title={`${yLabel} · ${xLabel}: ${value.toFixed(1)}`}
                  >
                    {value > 0 ? value.toFixed(value % 1 === 0 ? 0 : 1) : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </AnalyticsCard>
  );
}
