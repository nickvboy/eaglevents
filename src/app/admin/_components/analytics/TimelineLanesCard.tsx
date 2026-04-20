"use client";

import type { AnalyticsTimelineLane } from "~/server/services/admin-analytics";

import { AnalyticsCard } from "./AnalyticsCard";
import { EmptyAnalyticsState } from "./EmptyAnalyticsState";

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function TimelineLanesCard(props: {
  title: string;
  helper: string;
  lanes: AnalyticsTimelineLane[];
  toolbar?: React.ReactNode;
}) {
  if (props.lanes.length === 0) {
    return (
      <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
        <EmptyAnalyticsState message="No events fall on the selected day." />
      </AnalyticsCard>
    );
  }

  const minTime = Math.min(...props.lanes.map((lane) => lane.start.getTime()));
  const maxTime = Math.max(...props.lanes.map((lane) => lane.end.getTime()));
  const span = Math.max(maxTime - minTime, 1);
  const laneCount = Math.max(...props.lanes.map((lane) => lane.lane), 0) + 1;

  return (
    <AnalyticsCard title={props.title} helper={props.helper} toolbar={props.toolbar}>
      <div className="overflow-x-auto">
        <div className="relative min-w-[840px]" style={{ height: `${laneCount * 68}px` }}>
          {props.lanes.map((lane) => {
            const left = ((lane.start.getTime() - minTime) / span) * 100;
            const width = ((lane.end.getTime() - lane.start.getTime()) / span) * 100;
            return (
              <div
                key={`${lane.eventId}-${lane.lane}`}
                className="absolute rounded-xl border border-outline-muted bg-accent-muted/40 px-3 py-2"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 8)}%`,
                  top: `${lane.lane * 68}px`,
                }}
              >
                <div className="truncate text-sm font-semibold text-ink-primary">{lane.title}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {formatTime(lane.start)} - {formatTime(lane.end)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AnalyticsCard>
  );
}
