"use client";

import { useEffect, useState } from "react";
import { DayColumn } from "./DayColumn";
import type { CalendarEvent } from "../utils/event-layout";
import { minutesSinceStartOfDay, startOfDay } from "../utils/date";

type Props = {
  days: Date[]; // days to show as columns
  events: CalendarEvent[]; // all events in range
  variant?: "default" | "compact";
  onSelectEvent?: (event: CalendarEvent) => void;
};

export function WeekGrid({ days, events, variant = "default", onSelectEvent }: Props) {
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const d of days) eventsByDay.set(startOfDay(d).toISOString(), []);
  for (const e of events) {
    const sd = startOfDay(new Date(e.startDatetime)).toISOString();
    if (eventsByDay.has(sd)) eventsByDay.get(sd)!.push(e);
  }

  return (
    <div className={"flex min-h-0 flex-1 overflow-auto " + (variant === "compact" ? "bg-black/40" : "")}>
      {/* Time gutter */}
      <TimeGutter />
      {/* Day columns */}
      {days.map((d) => (
        <div key={d.toISOString()} className="min-w-0 flex-1">
          {variant === "default" ? (
            <div className="sticky top-0 z-10 border-b border-l border-white/10 bg-black/60 px-2 py-1 text-xs text-white">
              <div className="font-medium">
                {d.toLocaleDateString(undefined, { weekday: "long" })}
              </div>
              <div className="text-white/60">
                {d.getMonth() + 1}/{d.getDate()}
              </div>
            </div>
          ) : (
            <div className="border-b border-l border-white/10 bg-black/70 px-3 py-2 text-sm text-white">
              <div className="font-semibold">
                {d.toLocaleDateString(undefined, { weekday: "long" })}
              </div>
              <div className="text-xs text-white/60">
                {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            </div>
          )}
          <DayColumn
            date={d}
            events={eventsByDay.get(startOfDay(d).toISOString()) ?? []}
            onSelectEvent={onSelectEvent}
          />
        </div>
      ))}
    </div>
  );
}

function formatHour(h: number) {
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12} ${ampm}`;
}

function TimeGutter() {
  const [nowMinutes, setNowMinutes] = useState(minutesSinceStartOfDay(new Date()));

  useEffect(() => {
    const id = setInterval(() => setNowMinutes(minutesSinceStartOfDay(new Date())), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-14 shrink-0 border-r border-white/10 bg-black/30 text-[10px] text-white/50">
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="h-[60px] border-b border-transparent px-1 pt-1">
          {i > 0 ? formatHour(i) : ""}
        </div>
      ))}
      <div className="pointer-events-none absolute left-0 right-0 px-1" style={{ top: nowMinutes }}>
        <span className="block h-[1px] bg-emerald-400" />
      </div>
    </div>
  );
}
