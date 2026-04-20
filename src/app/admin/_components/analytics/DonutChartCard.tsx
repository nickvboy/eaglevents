"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

const colors = ["#0f766e", "#1d4ed8", "#ea580c", "#7c3aed"];

export function DonutChartCard(props: {
  title: string;
  helper: string;
  data: Array<{ key: string; label: string; value: number }>;
  toolbar?: React.ReactNode;
}) {
  if (props.data.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState />
      </AnalyticsCard>
    );
  }

  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            <Pie data={props.data} dataKey="value" nameKey="label" innerRadius={65} outerRadius={100} paddingAngle={3}>
              {props.data.map((entry, index) => (
                <Cell key={entry.key} fill={colors[index % colors.length] ?? "#0f766e"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {props.data.map((entry, index) => (
          <div key={entry.key} className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colors[index % colors.length] ?? "#0f766e" }} />
            <span>{entry.label}</span>
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}
