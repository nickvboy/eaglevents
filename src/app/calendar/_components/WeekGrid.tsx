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

  const headerHeight = variant === "compact" ? 52 : 40;
  const gridCols = `56px repeat(${days.length}, 1fr)`;

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Sticky header row so columns align with scrollbar width */}
        <div
          className="sticky top-0 z-20 grid shrink-0 border-b border-outline-muted bg-surface-overlay"
          style={{
            height: `${headerHeight}px`,
            gridTemplateColumns: gridCols,
          }}
        >
          {/* Time gutter header spacer */}
          <div className="border-r border-outline-muted" />
          {/* Day headers */}
          {days.map((d) => (
            <div key={d.toISOString()}>
              {variant === "default" ? (
                <div className="border-l border-outline-muted px-2 py-1 text-xs text-ink-primary">
                  <div className="font-medium">
                    {d.toLocaleDateString(undefined, { weekday: "long" })}
                  </div>
                  <div className="text-ink-muted">
                    {d.getMonth() + 1}/{d.getDate()}
                  </div>
                </div>
              ) : (
                <div className="border-l border-outline-muted px-3 py-2 text-sm text-ink-primary">
                  <div className="font-semibold">
                    {d.toLocaleDateString(undefined, { weekday: "long" })}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Scrollable body */}
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {/* Time gutter */}
          <TimeGutter />
          {/* Day columns */}
          {days.map((d) => (
            <div key={d.toISOString()}>
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
      </div>
    </div>
  );
}

function formatHour(h: number) {
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12} ${ampm}`;
}

function TimeGutter() {
  return (
    <div className="relative h-full min-h-[1440px] w-14 shrink-0 border-r border-outline-muted bg-surface-muted text-[10px] text-ink-subtle">
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="relative h-[60px] border-b border-transparent px-1">
          <div className="-translate-y-2 select-none text-right">{i > 0 ? formatHour(i) : ""}</div>
        </div>
      ))}
    </div>
  );
}
