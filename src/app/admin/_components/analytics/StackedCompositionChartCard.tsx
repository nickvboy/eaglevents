"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AnalyticsCompositionPoint } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

const palette = ["#0f766e", "#1d4ed8", "#ea580c", "#7c3aed", "#b91c1c", "#15803d"];

export function StackedCompositionChartCard(props: {
  title: string;
  helper: string;
  points?: AnalyticsCompositionPoint[];
  mode?: "bar" | "area";
  toolbar?: React.ReactNode;
}) {
  const points = props.points ?? [];

  if (points.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  const keys = Array.from(new Set(points.flatMap((point) => point.values.map((value) => value.key))));
  const labelsByKey = new Map(
    points.flatMap((point) => point.values.map((value) => [value.key, value.label] as const)),
  );
  const data = points.map((point) => {
    const row: Record<string, string | number> = { label: point.bucketLabel };
    for (const key of keys) row[key] = 0;
    for (const value of point.values) row[value.key] = value.value;
    return row;
  });

  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {props.mode === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid stroke="var(--color-outline-muted)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value, name) => [value, labelsByKey.get(String(name)) ?? String(name)]} />
              {keys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={labelsByKey.get(key) ?? key}
                  stackId="1"
                  stroke={palette[index % palette.length] ?? "#0f766e"}
                  fill={palette[index % palette.length] ?? "#0f766e"}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid stroke="var(--color-outline-muted)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--color-ink-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value, name) => [value, labelsByKey.get(String(name)) ?? String(name)]} />
              {keys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={labelsByKey.get(key) ?? key}
                  stackId="1"
                  fill={palette[index % palette.length] ?? "#0f766e"}
                  radius={index === keys.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </AnalyticsCard>
  );
}
