"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AnalyticsRankedDatum } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

export function RankedBarChartCard(props: {
  title: string;
  helper: string;
  data: AnalyticsRankedDatum[];
  toolbar?: React.ReactNode;
}) {
  if (props.data.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  const data = props.data
    .slice()
    .reverse()
    .map((entry) => ({ label: entry.label, value: entry.value }));
  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical">
            <CartesianGrid stroke="var(--color-outline-muted)" strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis type="category" width={130} dataKey="label" tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Bar dataKey="value" fill="var(--color-accent-strong)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </AnalyticsCard>
  );
}
