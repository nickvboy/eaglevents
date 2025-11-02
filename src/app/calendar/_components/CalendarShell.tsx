"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "next-auth";
import { CalendarSidebar } from "./CalendarSidebar";
import { CalendarToolbar } from "./CalendarToolbar";
import { WeekGrid } from "./WeekGrid";
import { NewEventDialog } from "./NewEventDialog";
import { AccountMenu } from "./AccountMenu";
import { EventDetailDrawer } from "./EventDetailDrawer";
import { api } from "~/trpc/react";
import { addDays, addMonths, endOfWeek, startOfDay, startOfWeek } from "../utils/date";
import type { CalendarEvent } from "../utils/event-layout";
import type { RouterOutputs } from "~/trpc/react";

type View = "day" | "threeday" | "workweek" | "week" | "month";

type CalendarShellProps = {
  currentUser: Session["user"] | null;
};

const MOBILE_QUERY = "(max-width: 768px)";

export function CalendarShell({ currentUser }: CalendarShellProps) {
  const [desktopView, setDesktopView] = useState<View>("workweek");
  const [mobileView, setMobileView] = useState<View>("day");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [openNew, setOpenNew] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const [mobileMonthDate, setMobileMonthDate] = useState(() => startOfDay(new Date()));
  const activeView = isMobile ? mobileView : desktopView;
  const setActiveView = (next: View) => {
    if (isMobile) setMobileView(next);
    else setDesktopView(next);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const handle = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mq.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handle);
      return () => mq.removeEventListener("change", handle);
    }
    const legacyHandle = () => setIsMobile(mq.matches);
    mq.addListener(legacyHandle);
    return () => mq.removeListener(legacyHandle);
  }, []);

  useEffect(() => {
    if (!mobileCalendarOpen) {
      setMobileMonthDate(selectedDate);
    }
  }, [selectedDate, mobileCalendarOpen]);

  useEffect(() => {
    if (!isMobile) setMobileCalendarOpen(false);
    else setMobileMonthDate(selectedDate);
  }, [isMobile, selectedDate]);

  const today = startOfDay(new Date());

  // calendars
  const { data: calendars } = api.calendar.listMine.useQuery(undefined);
  const defaultCalendarId = calendars?.find((c) => c.isPrimary)?.id ?? calendars?.[0]?.id;
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<number[]>([]);
  const effectiveVisible = visibleCalendarIds.length > 0 ? visibleCalendarIds : calendars?.map((c) => c.id) ?? [];
  const calendarLookup = useMemo(() => {
    const map = new Map<number, { name: string; color: string }>();
    (calendars ?? []).forEach((c) => map.set(c.id, { name: c.name, color: c.color }));
    return map;
  }, [calendars]);

  // visible range
  const range = useMemo(() => {
    if (activeView === "day") {
      return { start: startOfDay(selectedDate), end: startOfDay(addDays(selectedDate, 0)) };
    }
    if (activeView === "threeday") {
      const s = startOfDay(selectedDate);
      return { start: s, end: startOfDay(addDays(s, 2)) };
    }
    if (activeView === "workweek") {
      const s = startOfWeek(selectedDate, true);
      return { start: s, end: addDays(s, 4) };
    }
    if (activeView === "week") {
      const s = startOfWeek(selectedDate);
      return { start: s, end: endOfWeek(selectedDate) };
    }
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    return { start, end };
  }, [selectedDate, activeView]);

  // days to render in grid
  const days: Date[] = useMemo(() => {
    if (activeView === "day") return [selectedDate];
    if (activeView === "threeday") {
      const start = startOfDay(selectedDate);
      return [0, 1, 2].map((i) => addDays(start, i));
    }
    if (activeView === "workweek") {
      const s = startOfWeek(selectedDate, true);
      return [0, 1, 2, 3, 4].map((i) => addDays(s, i));
    }
    if (activeView === "week") {
      const s = startOfWeek(selectedDate);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [activeView, selectedDate]);

  const mobileHeaderDays = useMemo(() => {
    if (activeView === "month") {
      const start = startOfWeek(selectedDate);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    return days;
  }, [activeView, selectedDate, days]);

  const monthViewDays = useMemo(() => buildMonthGrid(selectedDate), [selectedDate]);
  const mobileMonthDays = useMemo(() => buildMonthGrid(mobileMonthDate), [mobileMonthDate]);

  // events
  const eventsQuery = api.event.list.useQuery({
    start: range.start,
    end: addDays(range.end, 1),
    calendarIds: effectiveVisible,
  });
  const events = (eventsQuery.data ?? []) as RouterOutputs["event"]["list"];
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  useEffect(() => {
    if (selectedEventId && !selectedEvent) setSelectedEventId(null);
  }, [selectedEventId, selectedEvent]);

  const goToToday = () => setSelectedDate(startOfDay(new Date()));
  const goPrevDay = () => setSelectedDate(addDays(selectedDate, -1));
  const goNextDay = () => setSelectedDate(addDays(selectedDate, 1));

  const onPrev = () => {
    if (activeView === "day") setSelectedDate(addDays(selectedDate, -1));
    else if (activeView === "threeday") setSelectedDate(addDays(selectedDate, -3));
    else if (activeView === "workweek" || activeView === "week") setSelectedDate(addDays(selectedDate, -7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()));
  };
  const onNext = () => {
    if (activeView === "day") setSelectedDate(addDays(selectedDate, 1));
    else if (activeView === "threeday") setSelectedDate(addDays(selectedDate, 3));
    else if (activeView === "workweek" || activeView === "week") setSelectedDate(addDays(selectedDate, 7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, selectedDate.getDate()));
  };

  const handleCalendarOpenChange = (open: boolean) => {
    setMobileCalendarOpen(open);
    if (open) setMobileMonthDate(selectedDate);
  };

  return (
    <>
      <div className="flex min-h-screen flex-col bg-neutral-950 lg:flex-row">
        <div className="hidden lg:block">
          <CalendarSidebar
            activeDate={selectedDate}
            selectedDate={selectedDate}
            onSelect={(d) => setSelectedDate(d)}
            focusedWeekStart={startOfWeek(selectedDate, activeView === "workweek")}
            calendars={(calendars ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color }))}
            visibleCalendarIds={effectiveVisible}
            onToggleCalendar={(id) =>
              setVisibleCalendarIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
            }
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {isMobile ? (
            <>
              <MobileToolbar onToday={goToToday} currentUser={currentUser} view={activeView} onViewChange={setActiveView} />
              <MobileDateHeader
                selectedDate={selectedDate}
                today={today}
                weekDays={mobileHeaderDays}
                monthDays={mobileMonthDays}
                calendarOpen={mobileCalendarOpen}
                monthDisplayDate={mobileMonthDate}
                onCalendarOpenChange={handleCalendarOpenChange}
                onPrevDay={goPrevDay}
                onNextDay={goNextDay}
                onPrevMonth={() => setMobileMonthDate((prev) => addMonths(prev, -1))}
                onNextMonth={() => setMobileMonthDate((prev) => addMonths(prev, 1))}
                onSelectDate={(d) => setSelectedDate(startOfDay(d))}
              />
              <div className="relative flex min-h-0 flex-1">
                {activeView === "month" ? (
                  <MonthGrid
                    days={monthViewDays}
                    events={events}
                    selectedMonth={selectedDate.getMonth()}
                    onSelectDay={(d) => {
                      setSelectedDate(startOfDay(d));
                      setActiveView("week");
                    }}
                  />
                ) : (
                  <WeekGrid
                    days={days}
                    events={events as CalendarEvent[]}
                    variant="compact"
                    onSelectEvent={(event) => setSelectedEventId(event.id)}
                  />
                )}
                <NewEventFab onClick={() => setOpenNew(true)} />
              </div>
            </>
          ) : (
            <>
              <CalendarToolbar
                view={activeView}
                rangeStart={range.start}
                rangeEnd={range.end}
                onViewChange={setActiveView}
                onToday={goToToday}
                onPrev={onPrev}
                onNext={onNext}
                onNewEvent={() => setOpenNew(true)}
                currentUser={currentUser}
              />

              <div className="relative flex min-h-0 flex-1">
                {activeView === "month" ? (
                  <MonthGrid
                    days={monthViewDays}
                    events={events}
                    selectedMonth={selectedDate.getMonth()}
                    onSelectDay={(d) => {
                      setSelectedDate(startOfDay(d));
                      setActiveView("week");
                    }}
                  />
                ) : (
                  <WeekGrid
                    days={days}
                    events={events as CalendarEvent[]}
                    onSelectEvent={(event) => setSelectedEventId(event.id)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <EventDetailDrawer
        open={!!selectedEvent}
        event={selectedEvent}
        calendar={selectedEvent ? calendarLookup.get(selectedEvent.calendarId) ?? null : null}
        onClose={() => setSelectedEventId(null)}
      />

      <NewEventDialog
        open={openNew}
        onClose={() => setOpenNew(false)}
        defaultDate={selectedDate}
        calendarId={defaultCalendarId}
      />
    </>
  );
}

function MonthGrid({
  days,
  events,
  selectedMonth,
  onSelectDay,
}: {
  days: Date[];
  events: CalendarEvent[];
  selectedMonth: number;
  onSelectDay: (d: Date) => void;
}) {
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const d of days) {
    const key = startOfDay(d).toISOString();
    eventsByDay.set(key, []);
  }
  for (const e of events) {
    const start = startOfDay(new Date(e.startDatetime));
    const key = start.toISOString();
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key)!.push(e);
  }
  for (const [, list] of eventsByDay) {
    list.sort(
      (a, b) =>
        new Date(a.startDatetime).getTime() - new Date(b.startDatetime).getTime(),
    );
  }

  const MAX_VISIBLE = 2;
  const todayKey = startOfDay(new Date()).toISOString();

  return (
    <div className="grid flex-1 grid-cols-7 gap-px bg-black p-1 md:p-px">
      {days.map((d) => {
        const inMonth = d.getMonth() === selectedMonth;
        const key = startOfDay(d).toISOString();
        const isToday = key === todayKey;
        const dayEvents = eventsByDay.get(key) ?? [];
        const visibleEvents = dayEvents.slice(0, MAX_VISIBLE);
        const remaining = dayEvents.length - visibleEvents.length;

        return (
          <button
            key={d.toISOString()}
            onClick={() => onSelectDay(d)}
            className={
              "flex min-h-[140px] flex-col rounded-lg border bg-black p-3 text-left text-white transition hover:border-emerald-400/60 hover:bg-black/80 " +
              (inMonth ? "border-white/15" : "border-white/10 opacity-60") +
              (isToday ? " ring-2 ring-emerald-500/70" : "")
            }
          >
            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="font-semibold text-white">
                {d.getDate()}
                {!inMonth && (
                  <span className="ml-1 text-[10px] uppercase text-white/40">
                    {d.toLocaleDateString(undefined, { month: "short" })}
                  </span>
                )}
              </span>
              {dayEvents.length > 0 && (
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                  {dayEvents.length} event{dayEvents.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-1 flex-col gap-1">
              {visibleEvents.map((ev) => {
                const evStart = new Date(ev.startDatetime);
                const evEnd = new Date(ev.endDatetime);
                return (
                  <div
                    key={ev.id}
                    className="w-full rounded-md border border-emerald-500/50 bg-emerald-600/20 px-2 py-1 text-left text-[11px] text-white/90"
                    title={ev.title}
                  >
                    <div className="truncate font-medium text-white">
                      {ev.title}
                    </div>
                    <div className="truncate text-[10px] text-white/70">
                      {ev.isAllDay ? "All day" : formatMonthEventTime(evStart, evEnd)}
                    </div>
                  </div>
                );
              })}

              {remaining > 0 && (
                <div className="mt-auto rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] text-white/60">
                  +{remaining} more
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatMonthEventTime(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

type MobileToolbarProps = {
  onToday: () => void;
  currentUser: Session["user"] | null;
  view: View;
  onViewChange: (v: View) => void;
};

function MobileToolbar({ onToday, currentUser, view, onViewChange }: MobileToolbarProps) {
  const views: View[] = ["day", "threeday", "workweek", "week", "month"];
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-4 py-3 text-white">
      <button
        className="shrink-0 rounded-md border border-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/10"
        onClick={onToday}
      >
        Today
      </button>
      <div className="flex flex-1 justify-center">
        <div className="inline-flex items-center gap-px rounded-lg border border-white/15 bg-black/50 p-1">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={
                "rounded-md px-2 py-1 text-xs font-medium capitalize transition " +
                (view === v ? "bg-emerald-500 text-black shadow" : "text-white/70 hover:bg-white/10")
              }
            >
              {v === "workweek" ? "Work week" : v === "threeday" ? "3 day" : v}
            </button>
          ))}
        </div>
      </div>
      <AccountMenu user={currentUser} />
    </div>
  );
}

type MobileDateHeaderProps = {
  selectedDate: Date;
  today: Date;
  weekDays: Date[];
  monthDays: Date[];
  monthDisplayDate: Date;
  calendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (d: Date) => void;
};

function MobileDateHeader(props: MobileDateHeaderProps) {
  const focusDate = props.calendarOpen ? props.monthDisplayDate : props.selectedDate;
  const handlePrev = props.calendarOpen ? props.onPrevMonth : props.onPrevDay;
  const handleNext = props.calendarOpen ? props.onNextMonth : props.onNextDay;

  return (
    <div className="border-b border-white/10 bg-black/80 text-white">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <button
          className="rounded-full border border-white/20 p-2 text-lg leading-none hover:bg-white/10"
          onClick={handlePrev}
        >
          {"<"}
        </button>
        <div className="text-center">
          <div className="text-lg font-semibold">{focusDate.toLocaleString(undefined, { month: "long" })}</div>
          <div className="text-xs text-white/60">{focusDate.getFullYear()}</div>
        </div>
        <button
          className="rounded-full border border-white/20 p-2 text-lg leading-none hover:bg-white/10"
          onClick={handleNext}
        >
          {">"}
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex gap-2">
          {props.weekDays.map((d) => {
            const isSelected = isSameDay(d, props.selectedDate);
            const isToday = isSameDay(d, props.today);
            const inMonth = d.getMonth() === props.selectedDate.getMonth();
            const base = isSelected ? "bg-emerald-500 text-black" : "bg-white/5 text-white";
            return (
              <button
                key={d.toISOString()}
                onClick={() => props.onSelectDate(d)}
                className={
                  "flex flex-1 min-w-0 flex-col items-center gap-1 rounded-xl py-2 text-xs transition-colors " +
                  base +
                  (inMonth ? "" : " opacity-60")
                }
              >
                <span className={"uppercase " + (isSelected ? "text-black/80" : "text-white/60")}>
                  {d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
                </span>
                <span className={"text-sm font-medium " + (isSelected ? "" : isToday ? "text-emerald-300" : "")}>
                  {d.getDate()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center pb-2">
        <button
          type="button"
          className="flex h-8 w-16 items-center justify-center"
          onClick={() => props.onCalendarOpenChange(!props.calendarOpen)}
        >
          <span className="h-1.5 w-full rounded-full bg-white/25" />
        </button>
      </div>

      {props.calendarOpen && (
        <div className="px-4 pb-3">
          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-white/50">
            {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {props.monthDays.map((d) => {
              const isSelected = isSameDay(d, props.selectedDate);
              const isToday = isSameDay(d, props.today);
              const inMonth = d.getMonth() === props.monthDisplayDate.getMonth();
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => {
                    props.onSelectDate(d);
                    props.onCalendarOpenChange(false);
                  }}
                  className={
                    "relative h-10 rounded-md text-center text-sm transition-colors " +
                    (inMonth ? "text-white" : "text-white/40")
                  }
                >
                  <span
                    className={
                      "relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full " +
                      (isSelected
                        ? "bg-emerald-500 text-black font-medium"
                        : isToday
                          ? "border border-emerald-400"
                          : "")
                    }
                  >
                    {d.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NewEventFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-[18px] bg-emerald-500 text-3xl font-semibold leading-none text-black shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400"
      aria-label="Create event"
    >
      +
    </button>
  );
}

function buildMonthGrid(refDate: Date) {
  const first = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
