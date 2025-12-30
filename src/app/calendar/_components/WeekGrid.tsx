"use client";

import { DayColumn } from "./DayColumn";
import type { CalendarEvent } from "../utils/event-layout";
import { startOfDay } from "../utils/date";

type Props = {
  days: Date[]; // days to show as columns
  events: CalendarEvent[]; // all events in range
  variant?: "default" | "compact";
  previewedEventId?: number | null;
  onPreviewEvent?: (event: CalendarEvent | null) => void;
  onOpenEvent?: (event: CalendarEvent) => void;
  onEditEvent?: (event: CalendarEvent) => void;
  calendarLookup?: Map<number, { name: string; swatchClass: string }>;
};

export function WeekGrid({
  days,
  events,
  variant = "default",
  previewedEventId,
  onPreviewEvent,
  onOpenEvent,
  onEditEvent,
  calendarLookup,
}: Props) {
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const d of days) eventsByDay.set(startOfDay(d).toISOString(), []);
  for (const e of events) {
    const sd = startOfDay(new Date(e.startDatetime)).toISOString();
    if (eventsByDay.has(sd)) eventsByDay.get(sd)!.push(e);
  }

  return (
    <div className={"flex h-full min-h-0 flex-1 overflow-auto " + (variant === "compact" ? "bg-surface-muted" : "")}>
      {/* Time gutter */}
      <TimeGutter variant={variant} />
      {/* Day columns */}
      {days.map((d) => (
        <div key={d.toISOString()} className="min-w-0 flex-1">
          {variant === "default" ? (
            <div className="sticky top-0 z-40 border-b border-l border-outline-muted bg-surface-overlay px-2 py-1 text-xs text-ink-primary">
              <div className="font-medium">
                {d.toLocaleDateString(undefined, { weekday: "long" })}
              </div>
              <div className="text-ink-muted">
                {d.getMonth() + 1}/{d.getDate()}
              </div>
            </div>
          ) : (
            <div className="border-b border-l border-outline-muted bg-surface-overlay px-3 py-2 text-sm text-ink-primary">
              <div className="font-semibold">
                {d.toLocaleDateString(undefined, { weekday: "long" })}
              </div>
              <div className="text-xs text-ink-muted">
                {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            </div>
          )}
          <DayColumn
            date={d}
            events={eventsByDay.get(startOfDay(d).toISOString()) ?? []}
            previewEventId={previewedEventId}
            onPreviewEvent={onPreviewEvent}
            onOpenEvent={onOpenEvent}
            onEditEvent={onEditEvent}
            calendarLookup={calendarLookup}
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

function TimeGutter({ variant }: { variant: "default" | "compact" }) {
  const headerHeightClass = variant === "compact" ? "h-[52px]" : "h-10";
  const headerClass = `sticky top-0 z-40 border-b border-outline-muted bg-surface-overlay ${headerHeightClass}`;
  return (
    <div className="relative h-full min-h-[1440px] w-14 shrink-0 border-r border-outline-muted bg-surface-muted text-[10px] text-ink-subtle">
      <div aria-hidden="true" className={headerClass} />
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="relative h-[60px] border-b border-transparent px-1">
          <div className="-translate-y-2 select-none text-right">{i > 0 ? formatHour(i) : ""}</div>
        </div>
      ))}
    </div>
  );
}
