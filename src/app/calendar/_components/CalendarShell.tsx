"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarSidebar } from "./CalendarSidebar";
import { CalendarToolbar } from "./CalendarToolbar";
import { WeekGrid } from "./WeekGrid";
import { NewEventDialog } from "./NewEventDialog";
import { EventDetailDrawer } from "./EventDetailDrawer";
import { api } from "~/trpc/react";
import { addDays, addMonths, endOfWeek, startOfDay, startOfWeek } from "../utils/date";
import type { CalendarEvent } from "../utils/event-layout";
import type { RouterOutputs } from "~/trpc/react";
import { ChevronLeftIcon, ChevronRightIcon } from "~/app/_components/icons";

type View = "day" | "threeday" | "workweek" | "week" | "month";

const MOBILE_QUERY = "(max-width: 768px)";
const CALENDAR_SWATCHES = ["bg-accent-strong", "bg-status-success", "bg-status-warning", "bg-status-danger", "bg-accent-soft"] as const;

function getStoredDate(key: string, fallback: Date) {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    const parsed = saved ? new Date(saved) : null;
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return startOfDay(parsed);
    }
  } catch {
    // ignore storage errors
  }
  return fallback;
}

export function CalendarShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDate = useMemo(() => startOfDay(new Date()), []);
  const [desktopView, setDesktopView] = useState<View>("workweek");
  const [mobileView, setMobileView] = useState<View>("day");
  const [selectedDate, setSelectedDate] = useState(() => initialDate);
  const desktopViewHydrated = useRef(false);
  const mobileViewHydrated = useRef(false);
  const [openNew, setOpenNew] = useState(false);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [previewEventId, setPreviewEventId] = useState<number | null>(null);
  const [sidebarMonthDate, setSidebarMonthDate] = useState(() => {
    return startOfDay(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  });
  const [monthOverlayText, setMonthOverlayText] = useState(() =>
    selectedDate.toLocaleString(undefined, { month: "long", year: "numeric" }),
  );
  const [monthOverlayVisible, setMonthOverlayVisible] = useState(true);
  const monthOverlayTimeoutRef = useRef<number | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const [mobileMonthDate, setMobileMonthDate] = useState(() => selectedDate);
  const activeView = isMobile ? mobileView : desktopView;
  const setActiveView = (next: View) => {
    if (isMobile) setMobileView(next);
    else setDesktopView(next);
  };
  

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("calendar.view.desktop");
      if (saved === "day" || saved === "threeday" || saved === "workweek" || saved === "week" || saved === "month") {
        setDesktopView(saved as View);
      }
    } catch {
      // ignore storage errors
    } finally {
      desktopViewHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!desktopViewHydrated.current) return;
    try {
      window.localStorage.setItem("calendar.view.desktop", desktopView);
    } catch {
      // ignore storage errors
    }
  }, [desktopView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("calendar.view.mobile");
      if (saved === "day" || saved === "threeday" || saved === "workweek" || saved === "week" || saved === "month") {
        setMobileView(saved as View);
      }
    } catch {
      // ignore storage errors
    } finally {
      mobileViewHydrated.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!mobileViewHydrated.current) return;
    try {
      window.localStorage.setItem("calendar.view.mobile", mobileView);
    } catch {
      // ignore storage errors
    }
  }, [mobileView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = getStoredDate("calendar.selectedDate", initialDate);
    if (stored.getTime() === initialDate.getTime()) return;
    setSelectedDate(stored);
    setSidebarMonthDate(startOfDay(new Date(stored.getFullYear(), stored.getMonth(), 1)));
    setMobileMonthDate(stored);
  }, [initialDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("calendar.selectedDate", selectedDate.toISOString());
    } catch {
      // ignore storage errors
    }
  }, [selectedDate]);

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

  // business name
  const { data: business } = api.calendar.getBusiness.useQuery(undefined);

  // calendars
  const { data: calendars } = api.calendar.listMine.useQuery(undefined);
  const defaultCalendarId = calendars?.find((c) => c.isPrimary)?.id ?? calendars?.[0]?.id;
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<number[]>([]);
  const [visibleCalendarsLoaded, setVisibleCalendarsLoaded] = useState(false);
  const effectiveVisible = visibleCalendarIds.length > 0 ? visibleCalendarIds : calendars?.map((c) => c.id) ?? [];
  const calendarLookup = useMemo(() => {
    const map = new Map<number, { name: string; swatchClass: string }>();
    (calendars ?? []).forEach((c, idx) => {
      const swatchClass = CALENDAR_SWATCHES[idx % CALENDAR_SWATCHES.length] ?? CALENDAR_SWATCHES[0];
      map.set(c.id, { name: c.name, swatchClass });
    });
    return map;
  }, [calendars]);

  const eventIdParam = searchParams.get("eventId")?.trim() ?? "";
  const lookupQuery = api.event.findByIdentifier.useQuery(
    { identifier: eventIdParam },
    { enabled: eventIdParam.length > 0 },
  );

  // Persist visible calendars selection
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!visibleCalendarsLoaded) return;
    try {
      window.localStorage.setItem("calendar.visibleCalendars", JSON.stringify(visibleCalendarIds));
    } catch {
      // ignore storage errors
    }
  }, [visibleCalendarIds, visibleCalendarsLoaded]);

  // Restore visible calendars when calendars load
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!calendars) return;
    try {
      const raw = window.localStorage.getItem("calendar.visibleCalendars");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((id: unknown) => typeof id === "number" && calendars.some((c) => c.id === id));
          setVisibleCalendarIds(valid as number[]);
        }
      }
    } catch {
      // ignore storage errors
    } finally {
      setVisibleCalendarsLoaded(true);
    }
  }, [calendars]);

  const focusEvent = useCallback((eventId: number, eventDate: Date, calendarId?: number) => {
    const normalized = startOfDay(eventDate);
    setSelectedDate(normalized);
    setSidebarMonthDate(startOfDay(new Date(normalized.getFullYear(), normalized.getMonth(), 1)));
    setMobileMonthDate(normalized);
    setPreviewEventId(null);
    setEditingEventId(null);
    setOpenNew(false);
    setSelectedEventId(eventId);
    if (calendarId) {
      setVisibleCalendarIds((prev) => {
        if (prev.length === 0 || prev.includes(calendarId)) return prev;
        return [...prev, calendarId];
      });
    }
  }, []);


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
  });
  const events = useMemo<RouterOutputs["event"]["list"]>(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const previewEvent = useMemo(
    () => events.find((e) => e.id === previewEventId) ?? null,
    [events, previewEventId],
  );
  useEffect(() => {
    if (previewEventId && !previewEvent) setPreviewEventId(null);
  }, [previewEventId, previewEvent]);
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  const resolvedSelectedEvent = selectedEvent ?? lookupQuery.data ?? null;
  const editingEvent = useMemo(() => {
    const fromList = events.find((e) => e.id === editingEventId) ?? null;
    if (fromList) return fromList;
    if (editingEventId && resolvedSelectedEvent?.id === editingEventId) return resolvedSelectedEvent;
    return null;
  }, [events, editingEventId, resolvedSelectedEvent]);
  useEffect(() => {
    if (!eventsQuery.isFetching && selectedEventId && !selectedEvent) {
      setSelectedEventId(null);
    }
  }, [selectedEventId, selectedEvent, eventsQuery.isFetching]);

  const handlePreviewEvent = (event: CalendarEvent | null) => {
    if (!event) {
      setPreviewEventId(null);
      return;
    }
    setPreviewEventId((prev) => (prev === event.id ? null : event.id));
  };

  const handleOpenEvent = (event: CalendarEvent | RouterOutputs["event"]["list"][number]) => {
    setPreviewEventId(null);
    setSelectedEventId(event.id);
  };
  const handleEditEvent = (eventInput: number | CalendarEvent | RouterOutputs["event"]["list"][number]) => {
    const eventId = typeof eventInput === "number" ? eventInput : eventInput.id;
    setPreviewEventId(null);
    setOpenNew(false);
    setEditingEventId(eventId);
  };
  const handleCloseEditor = () => {
    setOpenNew(false);
    setEditingEventId(null);
  };
  const handleNewEventRequest = () => {
    setEditingEventId(null);
    setOpenNew(true);
  };
  const dialogOpen = openNew || editingEventId !== null;

  const goToToday = () => {
    const today = startOfDay(new Date());
    setSelectedDate(today);
    setSidebarMonthDate(startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  };
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

  const monthKey = selectedDate.getFullYear() * 12 + selectedDate.getMonth();

  useEffect(() => {
    if (!eventIdParam) return;
    const numericId = Number(eventIdParam);
    if (!Number.isFinite(numericId) || numericId <= 0) return;

    const dateParam = searchParams.get("date");
    const calendarParam = searchParams.get("calendarId");
    const calendarId = calendarParam ? Number(calendarParam) : undefined;
    const parsedDate = dateParam ? new Date(dateParam) : null;

    if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
      focusEvent(numericId, parsedDate, Number.isFinite(calendarId) ? calendarId : undefined);
      return;
    }

    if (lookupQuery.data) {
      focusEvent(lookupQuery.data.id, new Date(lookupQuery.data.startDatetime), lookupQuery.data.calendarId);
    }
  }, [eventIdParam, focusEvent, lookupQuery.data, searchParams]);

  useEffect(() => {
    const year = Math.floor(monthKey / 12);
    const month = monthKey % 12;
    const label = new Date(year, month, 1).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
    setMonthOverlayText(label);
    setMonthOverlayVisible(true);

    if (monthOverlayTimeoutRef.current !== null) {
      window.clearTimeout(monthOverlayTimeoutRef.current);
    }

    const timeoutId = window.setTimeout(() => {
      setMonthOverlayVisible(false);
      monthOverlayTimeoutRef.current = null;
    }, 2000);
    monthOverlayTimeoutRef.current = timeoutId;

    return () => {
      window.clearTimeout(timeoutId);
      if (monthOverlayTimeoutRef.current === timeoutId) {
        monthOverlayTimeoutRef.current = null;
      }
    };
  }, [monthKey]);

  const clearEventParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("eventId");
    params.delete("date");
    params.delete("calendarId");
    const next = params.toString();
    router.replace(next ? `/calendar?${next}` : "/calendar");
  }, [router, searchParams]);

  const monthOverlay = (
    <div
      className={
        "pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 transform transition-all duration-300 " +
        (monthOverlayVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0")
      }
    >
      <div className="rounded-full bg-surface-overlay px-4 py-1 text-sm font-semibold text-ink-primary shadow-lg shadow-[var(--shadow-pane)] backdrop-blur">
        {monthOverlayText}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-raised lg:flex-row">
        <div className="hidden h-full shrink-0 lg:block">
          <CalendarSidebar
            monthDate={sidebarMonthDate}
            selectedDate={selectedDate}
            onSelect={(d) => {
              const normalized = startOfDay(d);
              setSelectedDate(normalized);
              setSidebarMonthDate(startOfDay(new Date(normalized.getFullYear(), normalized.getMonth(), 1)));
            }}
            onMonthChange={(direction) =>
              setSidebarMonthDate((prev) => {
                const next = addMonths(prev, direction);
                return startOfDay(new Date(next.getFullYear(), next.getMonth(), 1));
              })
            }
            focusedWeekStart={startOfWeek(selectedDate, activeView === "workweek")}
            calendars={(calendars ?? []).map((c) => ({
              id: c.id,
              name: c.name,
              swatchClass: calendarLookup.get(c.id)?.swatchClass ?? CALENDAR_SWATCHES[0],
            }))}
            visibleCalendarIds={effectiveVisible}
            onToggleCalendar={(id) =>
              setVisibleCalendarIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
            }
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {business?.name && (
            <div className="shrink-0 border-b border-outline-muted bg-surface-muted px-4 py-3 lg:px-6">
              <h1 className="text-xl font-semibold text-ink-primary lg:text-2xl">{business.name}</h1>
            </div>
          )}
          {isMobile ? (
            <>
              <div className="shrink-0">
                <MobileToolbar onToday={goToToday} view={activeView} onViewChange={setActiveView} />
              </div>
              <div className="shrink-0">
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
            </div>
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {monthOverlay}
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
                    previewedEventId={previewEventId}
                    onPreviewEvent={handlePreviewEvent}
                    onOpenEvent={handleOpenEvent}
                    onEditEvent={handleEditEvent}
                    calendarLookup={calendarLookup}
                  />
                )}
                <NewEventFab onClick={handleNewEventRequest} />
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0">
                <CalendarToolbar
                  view={activeView}
                  rangeStart={range.start}
                  rangeEnd={range.end}
                  onViewChange={setActiveView}
                  onToday={goToToday}
                  onPrev={onPrev}
                  onNext={onNext}
                  onNewEvent={handleNewEventRequest}
              />
            </div>

                <div className="relative flex min-h-0 flex-1 overflow-hidden">
                  {monthOverlay}
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
                      previewedEventId={previewEventId}
                      onPreviewEvent={handlePreviewEvent}
                      onOpenEvent={handleOpenEvent}
                      onEditEvent={handleEditEvent}
                      calendarLookup={calendarLookup}
                    />
                  )}
                </div>
            </>
          )}
        </div>
      </div>

      <EventDetailDrawer
        open={!!resolvedSelectedEvent}
        event={resolvedSelectedEvent}
        calendar={resolvedSelectedEvent ? calendarLookup.get(resolvedSelectedEvent.calendarId) ?? null : null}
        onClose={() => {
          setSelectedEventId(null);
          clearEventParams();
        }}
        onEdit={handleEditEvent}
      />

      <NewEventDialog
        open={dialogOpen}
        onClose={handleCloseEditor}
        defaultDate={selectedDate}
        calendarId={defaultCalendarId}
        event={editingEvent}
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
    <div className="grid flex-1 grid-cols-7 gap-px bg-surface-sunken p-1 md:p-px">
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
              "flex min-h-[140px] flex-col rounded-lg border bg-surface-sunken p-3 text-left text-ink-primary transition hover:border-outline-accent hover:bg-surface-overlay " +
              (inMonth ? "border-outline-muted" : "border-outline-muted opacity-60") +
              (isToday ? " ring-2 ring-accent-strong" : "")
            }
          >
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="font-semibold text-ink-primary">
                {d.getDate()}
                {!inMonth && (
                  <span className="ml-1 text-[10px] uppercase text-ink-faint">
                    {d.toLocaleDateString(undefined, { month: "short" })}
                  </span>
                )}
              </span>
              {dayEvents.length > 0 && (
                <span className="rounded-md border border-outline-accent/40 bg-accent-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-status-success">
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
                    className="w-full rounded-md border border-outline-accent bg-accent-muted px-2 py-1 text-left text-[11px] text-ink-primary"
                    title={ev.title}
                  >
                    <div className="truncate font-medium text-ink-primary">
                      {ev.title}
                    </div>
                    <div className="truncate text-[10px] text-ink-subtle">
                      {ev.isAllDay ? "All day" : formatMonthEventTime(evStart, evEnd)}
                    </div>
                  </div>
                );
              })}

              {remaining > 0 && (
                <div className="mt-auto rounded-md border border-outline-muted bg-surface-overlay px-2 py-1 text-[10px] text-ink-muted">
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
  return `${formatter.format(start)} ΓÇô ${formatter.format(end)}`;
}

type MobileToolbarProps = {
  onToday: () => void;
  view: View;
  onViewChange: (v: View) => void;
};

function MobileToolbar({ onToday, view, onViewChange }: MobileToolbarProps) {
  const views: View[] = ["day", "threeday", "workweek", "week", "month"];
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-outline-muted bg-surface-overlay px-4 py-3 text-ink-primary">
      <button
        className="shrink-0 rounded-md border border-outline-muted px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
        onClick={onToday}
      >
        Today
      </button>
      <div className="flex flex-1 justify-center">
        <div className="inline-flex items-center gap-px rounded-lg border border-outline-muted bg-surface-sunken/50 p-1">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={
                "rounded-md px-2 py-1 text-xs font-medium capitalize transition " +
                (view === v ? "bg-accent-strong text-ink-inverted shadow" : "text-ink-subtle hover:bg-surface-muted")
              }
            >
              {v === "workweek" ? "Work week" : v === "threeday" ? "3 day" : v}
            </button>
          ))}
        </div>
      </div>
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
    <div className="border-b border-outline-muted bg-surface-overlay text-ink-primary">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <button
          type="button"
          aria-label="Previous date"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-muted hover:bg-surface-muted"
          onClick={handlePrev}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-lg font-semibold">{focusDate.toLocaleString(undefined, { month: "long" })}</div>
          <div className="text-xs text-ink-muted">{focusDate.getFullYear()}</div>
        </div>
        <button
          type="button"
          aria-label="Next date"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-muted hover:bg-surface-muted"
          onClick={handleNext}
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex gap-2">
          {props.weekDays.map((d) => {
            const isSelected = isSameDay(d, props.selectedDate);
            const isToday = isSameDay(d, props.today);
            const inMonth = d.getMonth() === props.selectedDate.getMonth();
            const base = isSelected ? "bg-accent-strong text-ink-inverted" : "bg-surface-muted text-ink-primary";
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
                <span className={"uppercase " + (isSelected ? "text-ink-inverted" : "text-ink-muted")}>
                  {d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}
                </span>
                <span className={"text-sm font-medium " + (isSelected ? "" : isToday ? "text-status-success" : "")}>
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
          <span className="h-1.5 w-full rounded-full bg-surface-muted" />
        </button>
      </div>

      {props.calendarOpen && (
        <div className="px-4 pb-3">
          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-ink-subtle">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, index) => (
              <span key={`${d}-${index}`}>{d}</span>
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
                    (inMonth ? "text-ink-primary" : "text-ink-faint")
                  }
                >
                  <span
                    className={
                      "relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full " +
                      (isSelected
                        ? "bg-accent-strong text-ink-inverted font-medium"
                        : isToday
                          ? "border border-outline-accent"
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
      className="fixed bottom-24 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-[18px] bg-accent-strong text-3xl font-semibold leading-none text-ink-inverted shadow-lg shadow-[var(--shadow-accent-glow)] transition hover:bg-accent-default md:bottom-6"
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




