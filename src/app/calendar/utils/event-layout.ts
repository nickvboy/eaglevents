import { minutesSinceStartOfDay } from "./date";

export type CalendarEvent = {
  id: number;
  title: string;
  location: string | null;
  isAllDay: boolean;
  startDatetime: string | Date;
  endDatetime: string | Date;
  calendarId: number;
  assigneeProfile?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
};

export type PositionedEvent = {
  event: CalendarEvent;
  top: number; // minutes from 12:00 AM
  height: number; // minutes
  lane: number; // column index within overlap group
  laneCount: number; // total columns
};

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

export function positionEventsForDay(events: CalendarEvent[]): PositionedEvent[] {
  const items = events
    .map((e) => ({
      e,
      start: toDate(e.startDatetime),
      end: toDate(e.endDatetime),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  type Active = { idx: number; end: Date; lane: number };
  const result: PositionedEvent[] = [];
  let groupStart = 0;
  let active: Active[] = [];
  let maxConcurrency = 0;

  const flushGroup = (fromIdx: number, toExclusive: number, columns: number) => {
      for (let i = fromIdx; i < toExclusive; i++) {
        const { e, start, end } = items[i]!;
        const top = minutesSinceStartOfDay(start);
        const height = Math.max(15, (end.getTime() - start.getTime()) / 60000);
        const lane = (result[i]?.lane ?? 0);
        result[i] = {
          event: e as CalendarEvent,
          top,
          height,
          lane,
          laneCount: Math.max(columns, 1),
        };
      }
  };

  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!;
    // remove ended from active
    active = active.filter((a) => a.end > cur.start);

    // if active emptied, previous group ended -> flush with maxConcurrency
    if (active.length === 0 && i > groupStart) {
      flushGroup(groupStart, i, maxConcurrency);
      groupStart = i;
      maxConcurrency = 0;
    }

    // find first free lane
    const used = new Set(active.map((a) => a.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    active.push({ idx: i, end: cur.end, lane });
    maxConcurrency = Math.max(maxConcurrency, active.length);
    // store lane so we can flush later
    result[i] = {
      event: cur.e as CalendarEvent,
      top: 0,
      height: 0,
      lane,
      laneCount: 1,
    } as PositionedEvent;
  }

  // flush remaining
  if (items.length > 0) flushGroup(groupStart, items.length, Math.max(maxConcurrency, active.length));

  return result;
}
