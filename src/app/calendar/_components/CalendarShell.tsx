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

type View = "day" | "workweek" | "week" | "month";

type CalendarShellProps = {
  currentUser: Session["user"] | null;
};

const MOBILE_QUERY = "(max-width: 768px)";

export function CalendarShell({ currentUser }: CalendarShellProps) {
  const [view, setView] = useState<View>("workweek");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [openNew, setOpenNew] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const [mobileMonthDate, setMobileMonthDate] = useState(() => startOfDay(new Date()));

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
    if (isMobile && view !== "day") setView("day");
  }, [isMobile, view]);

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
    const s = startOfWeek(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [view, selectedDate]);

  const mobileWeekDays = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

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
    if (view === "day") setSelectedDate(addDays(selectedDate, -1));
    else if (view === "workweek" || view === "week") setSelectedDate(addDays(selectedDate, -7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, selectedDate.getDate()));
  };
  const onNext = () => {
    if (view === "day") setSelectedDate(addDays(selectedDate, 1));
    else if (view === "workweek" || view === "week") setSelectedDate(addDays(selectedDate, 7));
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
            focusedWeekStart={startOfWeek(selectedDate)}
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
              <MobileToolbar onToday={goToToday} currentUser={currentUser} />
              <MobileDateHeader
                selectedDate={selectedDate}
                today={today}
                weekDays={mobileWeekDays}
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
                <WeekGrid
                  days={[selectedDate]}
                  events={events as CalendarEvent[]}
                  variant="compact"
                  onSelectEvent={(event) => setSelectedEventId(event.id)}
                />
                <NewEventFab onClick={() => setOpenNew(true)} />
              </div>
            </>
          ) : (
            <>
              <CalendarToolbar
                view={view}
                rangeStart={range.start}
                rangeEnd={range.end}
                onViewChange={setView}
                onToday={goToToday}
                onPrev={onPrev}
                onNext={onNext}
                onNewEvent={() => setOpenNew(true)}
                currentUser={currentUser}
              />

              <div className="relative flex min-h-0 flex-1">
                {view === "month" ? (
                  <MonthGrid
                    days={monthViewDays}
                    events={events}
                    selectedMonth={selectedDate.getMonth()}
                    onSelectDay={(d) => {
                      setSelectedDate(startOfDay(d));
                      setView("week");
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
              <div className="mt-auto text-xs text-emerald-400">
                {count} event{count > 1 ? "s" : ""}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

type MobileToolbarProps = {
  onToday: () => void;
  currentUser: Session["user"] | null;
};

function MobileToolbar({ onToday, currentUser }: MobileToolbarProps) {
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/80 px-4 py-3 text-white">
      <button className="rounded-md border border-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/10" onClick={onToday}>
        Today
      </button>
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
        <div className="grid grid-cols-7 gap-2">
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
                  "flex flex-col items-center gap-1 rounded-xl py-2 text-xs transition-colors " +
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
