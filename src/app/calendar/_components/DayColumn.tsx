"use client";

import { useEffect, useMemo, useState } from "react";
import { minutesSinceStartOfDay } from "../utils/date";
import { EventCard } from "./EventCard";
import { EventPreviewFlyout } from "./EventPreviewFlyout";
import { positionEventsForDay } from "../utils/event-layout";
import type { CalendarEvent } from "../utils/event-layout";

type Props = {
  date: Date;
  events: CalendarEvent[];
  previewEventId?: number | null;
  onPreviewEvent?: (event: CalendarEvent | null) => void;
  onOpenEvent?: (event: CalendarEvent) => void;
  onEditEvent?: (event: CalendarEvent) => void;
  calendarLookup?: Map<number, { name: string; color: string }>;
  previewSide?: "left" | "right";
};

const MINUTE_PX = 1; // 60px per hour -> 30-minute increments visible
const DAY_HEIGHT = 24 * 60 * MINUTE_PX;
const PREVIEW_MAX_HEIGHT = 360;

export function DayColumn({
  date,
  events,
  previewEventId,
  onPreviewEvent,
  onOpenEvent,
  onEditEvent,
  calendarLookup,
  previewSide = "right",
}: Props) {
  const positioned = useMemo(() => positionEventsForDay(events), [events]);
  const [nowMinutes, setNowMinutes] = useState(minutesSinceStartOfDay(new Date()));

  useEffect(() => {
    const id = setInterval(() => setNowMinutes(minutesSinceStartOfDay(new Date())), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const isToday = new Date().toDateString() === date.toDateString();
  const previewPlacementFor = (top: number) => (top * MINUTE_PX + PREVIEW_MAX_HEIGHT > DAY_HEIGHT ? "up" : "down");

  return (
    <div className="relative h-full min-h-[1440px] border-l border-outline-muted bg-surface-muted">
      {/* hour lines */}
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-outline-muted"
          style={{ top: i * 60 * MINUTE_PX }}
        >
          <div className="-translate-y-2 select-none pl-1 text-[10px] text-ink-subtle">
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
          <span className="h-[1px] flex-1 bg-accent-default" />
          <span className="ml-2 rounded-full bg-accent-strong px-2 py-0.5 text-[10px] font-semibold text-ink-inverted shadow">
            {formatClockLabel(nowMinutes)}
          </span>
        </div>
      )}

      {/* events */}
      {positioned.map((p, idx) => {
        const previewPlacement = previewPlacementFor(p.top);
        const calendarColor = calendarLookup?.get(p.event.calendarId)?.color;
        return (
          <div
            key={idx}
            className={"absolute p-0.5 " + (p.event.id === previewEventId ? "z-30" : "z-10")}
            style={{
              top: p.top * MINUTE_PX,
              height: p.height * MINUTE_PX,
              left: `${(p.lane * 100) / p.laneCount}%`,
              width: `${100 / p.laneCount}%`,
            }}
          >
            <div className="relative h-full w-full overflow-visible">
                <EventCard
                  title={p.event.title}
                  location={p.event.location}
                  start={new Date(p.event.startDatetime)}
                  end={new Date(p.event.endDatetime)}
                  isSelected={p.event.id === previewEventId}
                  color={calendarColor}
                  onClick={() => onPreviewEvent?.(p.event)}
                  onExpand={() => onOpenEvent?.(p.event)}
                  onDoubleClick={() => onOpenEvent?.(p.event)}
                />
              <EventPreviewFlyout
                event={p.event}
                calendar={calendarLookup?.get(p.event.calendarId) ?? null}
                open={p.event.id === previewEventId}
                placement={previewPlacement}
                side={previewSide}
                onExpand={() => onOpenEvent?.(p.event)}
                onEdit={() => onEditEvent?.(p.event)}
              />
            </div>
          </div>
        );
      })}
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
