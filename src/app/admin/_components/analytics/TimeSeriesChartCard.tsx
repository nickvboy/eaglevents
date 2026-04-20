"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AnalyticsSeriesPoint } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

export function TimeSeriesChartCard(props: {
  title: string;
  helper: string;
  series: AnalyticsSeriesPoint[];
  compareSeries?: AnalyticsSeriesPoint[];
  mode?: "line" | "area";
  toolbar?: React.ReactNode;
}) {
  if (props.series.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  const data = props.series.map((point, index) => ({
    label: point.bucketLabel,
    value: point.value,
    compare: props.compareSeries?.[index]?.value ?? point.compareValue ?? null,
  }));
  const shared = (
    <>
      <CartesianGrid stroke="var(--color-outline-muted)" strokeDasharray="3 3" />
      <XAxis dataKey="label" tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
      <YAxis tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
      <Tooltip />
    </>
  );

  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {props.mode === "area" ? (
            <AreaChart data={data}>
              {shared}
              <Area type="monotone" dataKey="value" stroke="var(--color-accent-strong)" fill="var(--color-accent-muted)" fillOpacity={0.45} />
              {props.compareSeries ? <Area type="monotone" dataKey="compare" stroke="var(--color-ink-muted)" fillOpacity={0} /> : null}
            </AreaChart>
          ) : (
            <LineChart data={data}>
              {shared}
              <Line type="monotone" dataKey="value" stroke="var(--color-accent-strong)" strokeWidth={3} dot={false} />
              {props.compareSeries ? <Line type="monotone" dataKey="compare" stroke="var(--color-ink-muted)" strokeWidth={2} dot={false} /> : null}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </AnalyticsCard>
  );
}
