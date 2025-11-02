"use client";

import { useEffect, useMemo, useState } from "react";
import { minutesSinceStartOfDay } from "../utils/date";
import { EventCard } from "./EventCard";
import { positionEventsForDay } from "../utils/event-layout";
import type { CalendarEvent, PositionedEvent } from "../utils/event-layout";

type Props = {
  date: Date;
  events: CalendarEvent[];
  onSelectEvent?: (event: CalendarEvent) => void;
};

const MINUTE_PX = 1; // 60px per hour -> 30-minute increments visible

export function DayColumn({ date, events, onSelectEvent }: Props) {
  const positioned = useMemo(() => positionEventsForDay(events), [events]);
  const [nowMinutes, setNowMinutes] = useState(minutesSinceStartOfDay(new Date()));

  useEffect(() => {
    const id = setInterval(() => setNowMinutes(minutesSinceStartOfDay(new Date())), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <div className="relative h-[1440px] border-l border-white/10 bg-black/20">
      {/* hour lines */}
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-white/10"
          style={{ top: i * 60 * MINUTE_PX }}
        >
          <div className="-translate-y-2 select-none pl-1 text-[10px] text-white/50">
            {formatHour(i)}
          </div>
        </div>
      ))}

      {/* current time line */}
      {isToday && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
          style={{ top: nowMinutes * MINUTE_PX }}
        >
          <span className="h-[1px] flex-1 bg-emerald-400" />
          <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-black shadow">
            {formatClockLabel(nowMinutes)}
          </span>
        </div>
      )}

      {/* events */}
      {positioned.map((p, idx) => (
        <div
          key={idx}
          className="absolute z-10 p-0.5"
          style={{
            top: p.top * MINUTE_PX,
            height: p.height * MINUTE_PX,
            left: `${(p.lane * 100) / p.laneCount}%`,
            width: `${100 / p.laneCount}%`,
          }}
        >
          <EventCard
            title={p.event.title}
            location={p.event.location}
            start={new Date(p.event.startDatetime)}
            end={new Date(p.event.endDatetime)}
            onDoubleClick={() => onSelectEvent?.(p.event)}
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

function formatClockLabel(minutes: number) {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}
