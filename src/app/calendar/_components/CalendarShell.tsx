"use client";

import { useMemo, useState } from "react";
import type { Session } from "next-auth";
import { CalendarSidebar } from "./CalendarSidebar";
import { CalendarToolbar } from "./CalendarToolbar";
import { WeekGrid } from "./WeekGrid";
import { NewEventDialog } from "./NewEventDialog";
import { api } from "~/trpc/react";
import { addDays, endOfWeek, startOfDay, startOfWeek } from "../utils/date";
import type { CalendarEvent } from "../utils/event-layout";
import type { RouterOutputs } from "~/trpc/react";

type View = "day" | "workweek" | "week" | "month";

type CalendarShellProps = {
  currentUser: Session["user"] | null;
};

export function CalendarShell({ currentUser }: CalendarShellProps) {
  const [view, setView] = useState<View>("workweek");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [openNew, setOpenNew] = useState(false);

  // calendars
  const { data: calendars } = api.calendar.listMine.useQuery(undefined);
  const defaultCalendarId = calendars?.find((c) => c.isPrimary)?.id ?? calendars?.[0]?.id;
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<number[]>([]);
  const effectiveVisible = visibleCalendarIds.length > 0 ? visibleCalendarIds : calendars?.map((c) => c.id) ?? [];

  // visible range
  const range = useMemo(() => {
    if (view === "day") {
      return { start: startOfDay(selectedDate), end: startOfDay(addDays(selectedDate, 0)) };
    }
    if (view === "workweek") {
      const s = startOfWeek(selectedDate);
      return { start: s, end: addDays(s, 4) };
    }
    if (view === "week") {
      const s = startOfWeek(selectedDate);
      return { start: s, end: endOfWeek(selectedDate) };
    }
    // month
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    return { start, end };
  }, [selectedDate, view]);

  // days to render in grid
  const days: Date[] = useMemo(() => {
    if (view === "day") return [selectedDate];
    if (view === "workweek") {
      const s = startOfWeek(selectedDate);
      return [0, 1, 2, 3, 4].map((i) => addDays(s, i));
    }
    if (view === "week") {
      const s = startOfWeek(selectedDate);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    // month: show 7 days row header only; grid handled separately, but we'll reuse WeekGrid by weeks
    const s = startOfWeek(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [view, selectedDate]);

  // events
  const eventsQuery = api.event.list.useQuery({ start: range.start, end: addDays(range.end, 1), calendarIds: effectiveVisible });
  const events = (eventsQuery.data ?? []) as RouterOutputs["event"]["list"];

  const onPrev = () => {
    if (view === "day") setSelectedDate(addDays(selectedDate, -1));
    else if (view === "workweek" || view === "week") setSelectedDate(addDays(selectedDate, -7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()));
  };
  const onNext = () => {
    if (view === "day") setSelectedDate(addDays(selectedDate, 1));
    else if (view === "workweek" || view === "week") setSelectedDate(addDays(selectedDate, 7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, selectedDate.getDate()));
  };

  // Month view rendering: simple month grid with counts
  const monthDays = useMemo(() => {
    if (view !== "month") return [] as Date[];
    const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const start = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view, selectedDate]);

  return (
    <div className="flex min-h-screen bg-neutral-950">
      <CalendarSidebar
        activeDate={selectedDate}
        selectedDate={selectedDate}
        onSelect={(d) => setSelectedDate(d)}
        focusedWeekStart={startOfWeek(selectedDate)}
        calendars={(calendars ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        visibleCalendarIds={effectiveVisible}
        onToggleCalendar={(id) =>
          setVisibleCalendarIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <CalendarToolbar
          view={view}
          rangeStart={range.start}
          rangeEnd={range.end}
          onViewChange={setView}
          onToday={() => setSelectedDate(startOfDay(new Date()))}
          onPrev={onPrev}
          onNext={onNext}
          onNewEvent={() => setOpenNew(true)}
          currentUser={currentUser}
        />

        {view === "month" ? (
          <MonthGrid days={monthDays} events={events} selectedMonth={selectedDate.getMonth()} onSelectDay={(d) => { setSelectedDate(d); setView("week"); }} />
        ) : (
          <WeekGrid days={days} events={events as CalendarEvent[]} />
        )}
      </div>

      <NewEventDialog open={openNew} onClose={() => setOpenNew(false)} defaultDate={selectedDate} calendarId={defaultCalendarId} />
    </div>
  );
}

function MonthGrid({ days, events, selectedMonth, onSelectDay }: { days: Date[]; events: CalendarEvent[]; selectedMonth: number; onSelectDay: (d: Date) => void }) {
  const byDay = new Map<string, number>();
  for (const e of events) {
    const d = new Date(e.startDatetime);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return (
    <div className="grid flex-1 grid-cols-7 gap-px bg-white/10 p-px">
      {days.map((d) => {
        const inMonth = d.getMonth() === selectedMonth;
        const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        const count = byDay.get(key) ?? 0;
        return (
          <button
            key={d.toISOString()}
            onClick={() => onSelectDay(d)}
            className={
              "flex min-h-[120px] flex-col items-start gap-1 rounded-sm border border-white/10 bg-black/30 p-2 text-left text-white " +
              (inMonth ? "" : "opacity-50")
            }
          >
            <div className="text-xs text-white/70">{d.getDate()}</div>
            {count > 0 && (
              <div className="mt-auto text-xs text-emerald-400">{count} event{count > 1 ? "s" : ""}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
