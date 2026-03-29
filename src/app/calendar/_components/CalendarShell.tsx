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
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "~/app/_components/icons";

type View = "day" | "threeday" | "workweek" | "week" | "month";
type CalendarRow = RouterOutputs["calendar"]["listAccessible"][number];
type CalendarScopeOption = RouterOutputs["calendar"]["scopeOptions"][number];

const MOBILE_QUERY = "(max-width: 768px)";
const VALID_VIEWS: View[] = ["day", "threeday", "workweek", "week", "month"];
const VIEW_PREFERENCE_KEY = "calendar.view.preference";
const VIEW_PREFERENCE_TTL_MS = 1000 * 60 * 60 * 4;

type StoredViewPreference = {
  view: View;
  expiresAt: number;
};

function isView(value: string): value is View {
  return VALID_VIEWS.includes(value as View);
}

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

function getStoredView(value: string | null, fallback: View) {
  if (value && isView(value)) return value;
  return fallback;
}

function getStoredViewPreference(fallback: View) {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(VIEW_PREFERENCE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredViewPreference>;
      if (
        typeof parsed.view === "string" &&
        isView(parsed.view) &&
        typeof parsed.expiresAt === "number"
      ) {
        if (parsed.expiresAt > Date.now()) return parsed.view;
        window.localStorage.removeItem(VIEW_PREFERENCE_KEY);
      }
    }
  } catch {
    // ignore storage errors
  }

  return getStoredView(
    window.localStorage.getItem("calendar.view.desktop") ?? window.localStorage.getItem("calendar.view.mobile"),
    fallback,
  );
}

function persistViewPreference(view: View) {
  if (typeof window === "undefined") return;

  try {
    const payload: StoredViewPreference = {
      view,
      expiresAt: Date.now() + VIEW_PREFERENCE_TTL_MS,
    };
    const serialized = JSON.stringify(payload);
    window.localStorage.setItem(VIEW_PREFERENCE_KEY, serialized);
    window.localStorage.setItem("calendar.view.desktop", view);
    window.localStorage.setItem("calendar.view.mobile", view);
  } catch {
    // ignore storage errors
  }
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
  const [calendarEditorOpen, setCalendarEditorOpen] = useState(false);
  const [editingCalendarId, setEditingCalendarId] = useState<number | null>(null);
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileMonthDate, setMobileMonthDate] = useState(() => selectedDate);
  const [viewsHydrated, setViewsHydrated] = useState(false);
  const activeView = isMobile ? mobileView : desktopView;
  const setActiveView = (next: View) => {
    setDesktopView(next);
    setMobileView(next);
  };
  

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = getStoredViewPreference("workweek");
      setDesktopView(saved);
    } catch {
      // ignore storage errors
    } finally {
      desktopViewHydrated.current = true;
      if (mobileViewHydrated.current) setViewsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!desktopViewHydrated.current) return;
    if (isMobile) return;
    persistViewPreference(desktopView);
  }, [desktopView, isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = getStoredViewPreference("day");
      setMobileView(saved);
    } catch {
      // ignore storage errors
    } finally {
      mobileViewHydrated.current = true;
      if (desktopViewHydrated.current) setViewsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!mobileViewHydrated.current) return;
    if (!isMobile) return;
    persistViewPreference(mobileView);
  }, [mobileView, isMobile]);

  useEffect(() => {
    if (!viewsHydrated) return;
    if (isMobile) {
      if (mobileView !== desktopView) setMobileView(desktopView);
    } else {
      if (desktopView !== mobileView) setDesktopView(mobileView);
    }
  }, [desktopView, isMobile, mobileView, viewsHydrated]);

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

  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  const today = startOfDay(new Date());

  // business name
  const { data: business } = api.calendar.getBusiness.useQuery(undefined);

  // calendars
  const { data: calendars } = api.calendar.listAccessible.useQuery(undefined);
  const { data: calendarScopeOptions } = api.calendar.scopeOptions.useQuery();
  const { data: personalNameSuggestion } = api.calendar.suggestPersonalName.useQuery();
  const defaultCalendarId =
    calendars?.find((c) => c.isPersonal && c.isPrimary)?.id ??
    calendars?.find((c) => c.isPersonal)?.id ??
    calendars?.[0]?.id;
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<number[]>([]);
  const [visibleCalendarsLoaded, setVisibleCalendarsLoaded] = useState(false);
  const effectiveVisible = visibleCalendarIds;
  const calendarLookup = useMemo(() => {
    const map = new Map<number, { name: string; color: string }>();
    (calendars ?? []).forEach((c) => {
      map.set(c.id, { name: c.name, color: c.color });
    });
    return map;
  }, [calendars]);
  const writableCalendars = useMemo(() => (calendars ?? []).filter((c) => c.canWrite), [calendars]);
  const eventCalendarId = useMemo(() => {
    if (writableCalendars.length === 0) return defaultCalendarId;
    if (visibleCalendarIds.length > 0) {
      const selected = writableCalendars.find((calendar) => visibleCalendarIds.includes(calendar.id));
      if (selected) return selected.id;
    }
    return defaultCalendarId ?? writableCalendars[0]?.id;
  }, [writableCalendars, visibleCalendarIds, defaultCalendarId]);

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
    calendarIds: effectiveVisible.length > 0 ? effectiveVisible : undefined,
  });
  const events = useMemo<RouterOutputs["event"]["list"]>(() => {
    if (visibleCalendarsLoaded && effectiveVisible.length === 0) return [];
    return eventsQuery.data ?? [];
  }, [eventsQuery.data, effectiveVisible.length, visibleCalendarsLoaded]);
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
  const editingCalendar = useMemo(
    () => (calendars ?? []).find((calendar) => calendar.id === editingCalendarId) ?? null,
    [calendars, editingCalendarId],
  );
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
    const returnTo = params.get("returnTo");
    params.delete("eventId");
    params.delete("date");
    params.delete("calendarId");
    params.delete("returnTo");
    const next = params.toString();
    const safeReturn =
      returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : null;
    router.replace(safeReturn ?? (next ? `/calendar?${next}` : "/calendar"));
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
              color: c.color,
              isPersonal: c.isPersonal,
              canManage: c.canManage,
            }))}
            visibleCalendarIds={effectiveVisible}
            onToggleCalendar={(id) =>
              setVisibleCalendarIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
            }
            onEditCalendar={(id) => {
              setEditingCalendarId(id);
              setCalendarEditorOpen(true);
            }}
            onCreateCalendar={() => {
              setEditingCalendarId(null);
              setCalendarEditorOpen(true);
            }}
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
                <MobileToolbar
                  onToday={goToToday}
                  view={activeView}
                  onViewChange={setActiveView}
                  onOpenCalendars={() => setMobileSidebarOpen(true)}
                />
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
              <div
                className={
                  "relative flex min-h-0 flex-1 " + (activeView === "month" ? "overflow-auto" : "overflow-hidden")
                }
              >
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
                  onOpenCalendars={() => setMobileSidebarOpen(true)}
              />
            </div>

                <div
                  className={
                    "relative flex min-h-0 flex-1 " + (activeView === "month" ? "overflow-auto" : "overflow-hidden")
                  }
                >
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
      <div
        className={
          "fixed inset-x-0 bottom-0 top-16 z-50 transition lg:hidden md:left-16 " +
          (mobileSidebarOpen ? "pointer-events-auto" : "pointer-events-none")
        }
        aria-hidden={!mobileSidebarOpen}
      >
        <button
          type="button"
          className={
            "absolute inset-0 bg-black/30 transition-opacity duration-300 " +
            (mobileSidebarOpen ? "opacity-100" : "opacity-0")
          }
          aria-label="Close calendars"
          onClick={() => setMobileSidebarOpen(false)}
        />
        <div
          className={
            "absolute left-0 top-0 h-full max-w-[85%] transition-transform duration-300 ease-out " +
            (mobileSidebarOpen ? "translate-x-0" : "-translate-x-full")
          }
        >
          <div className="flex h-full flex-col bg-surface-muted shadow-2xl shadow-[var(--shadow-pane)]">
            <div className="flex items-center justify-between border-b border-outline-muted px-4 py-3 text-ink-primary">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarIcon className="h-4 w-4" />
                Calendars
              </div>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-muted hover:bg-surface-muted"
                aria-label="Close calendars"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <CalendarSidebar
              className="w-72 max-w-[85vw] border-r-0"
              showMiniCalendar
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
                color: c.color,
                isPersonal: c.isPersonal,
                canManage: c.canManage,
              }))}
              visibleCalendarIds={effectiveVisible}
              onToggleCalendar={(id) =>
                setVisibleCalendarIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
              }
              onEditCalendar={(id) => {
                setEditingCalendarId(id);
                setCalendarEditorOpen(true);
              }}
              onCreateCalendar={() => {
                setEditingCalendarId(null);
                setCalendarEditorOpen(true);
              }}
            />
          </div>
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
        calendarId={eventCalendarId}
        visibleCalendarIds={effectiveVisible}
        calendars={calendars ?? []}
        event={editingEvent}
      />
      <CalendarEditorDialog
        open={calendarEditorOpen}
        onClose={() => {
          setCalendarEditorOpen(false);
          setEditingCalendarId(null);
        }}
        calendar={editingCalendar}
        scopeOptions={calendarScopeOptions ?? []}
        personalNameSuggestion={personalNameSuggestion?.name}
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
    <div className="grid flex-1 grid-cols-7 auto-rows-min gap-px bg-surface-sunken p-1 md:p-px">
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
              "flex h-auto min-h-[140px] flex-col rounded-lg border bg-surface-sunken p-2 text-left text-ink-primary transition hover:border-outline-accent hover:bg-surface-overlay md:p-3 " +
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

            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1">
              {visibleEvents.map((ev) => {
                const evStart = new Date(ev.startDatetime);
                const evEnd = new Date(ev.endDatetime);
                return (
                  <div
                    key={ev.id}
                    className="w-full rounded-md border border-outline-accent bg-accent-muted px-2 py-1 text-left text-[10px] text-ink-primary md:text-[11px]"
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
                <div className="mt-auto max-w-full rounded-md border border-outline-muted bg-surface-overlay px-1 py-0.5 text-[9px] leading-tight text-ink-muted md:px-2 md:py-1 md:text-[10px]">
                  <span className="whitespace-nowrap">+{remaining} more</span>
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
  onOpenCalendars: () => void;
};

function MobileToolbar({ onToday, view, onViewChange, onOpenCalendars }: MobileToolbarProps) {
  const views: View[] = ["day", "threeday", "workweek", "week", "month"];
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-outline-muted bg-surface-overlay px-3 py-2 text-ink-primary">
      <button
        type="button"
        className="shrink-0 rounded-md border border-outline-muted px-2 py-1 text-xs font-medium hover:bg-surface-muted"
        onClick={onToday}
      >
        Today
      </button>
      <div className="flex flex-1 items-center justify-center overflow-x-auto">
        <div className="inline-flex items-center gap-px rounded-lg border border-outline-muted bg-surface-sunken/50 p-1">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={
                "rounded-md px-1.5 py-1 text-[11px] font-medium capitalize transition " +
                (view === v ? "bg-accent-strong text-ink-inverted shadow" : "text-ink-subtle hover:bg-surface-muted")
              }
            >
              {v === "workweek" ? "Work week" : v === "threeday" ? "3 day" : v}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenCalendars}
        className="shrink-0 rounded-full border border-outline-muted p-2 text-ink-primary hover:bg-surface-muted"
        aria-label="Open calendars"
      >
        <CalendarIcon className="h-4 w-4" />
      </button>
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

function CalendarEditorDialog({
  open,
  onClose,
  calendar,
  scopeOptions,
  personalNameSuggestion,
}: {
  open: boolean;
  onClose: () => void;
  calendar: CalendarRow | null;
  scopeOptions: CalendarScopeOption[];
  personalNameSuggestion?: string;
}) {
  const utils = api.useUtils();
  const createCalendar = api.calendar.create.useMutation({
    onSuccess: async () => {
      await utils.calendar.listAccessible.invalidate();
      await utils.event.invalidate();
    },
  });
  const updateCalendar = api.calendar.update.useMutation({
    onSuccess: async () => {
      await utils.calendar.listAccessible.invalidate();
      await utils.event.invalidate();
    },
  });

  const isEditing = Boolean(calendar);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#22c55e");
  const [isPersonal, setIsPersonal] = useState(true);
  const [scopeKey, setScopeKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (calendar) {
      setName(calendar.name);
      setColor(calendar.color);
      setIsPersonal(calendar.isPersonal);
      setScopeKey(`${calendar.scopeType}:${calendar.scopeId}`);
      return;
    }
    setName(personalNameSuggestion ?? "");
    setColor("#22c55e");
    setIsPersonal(true);
    setScopeKey(scopeOptions[0] ? `${scopeOptions[0].scopeType}:${scopeOptions[0].scopeId}` : "");
  }, [open, calendar, scopeOptions, personalNameSuggestion]);

  if (!open) return null;

  const canCreateShared = scopeOptions.length > 0;
  const isSaving = createCalendar.isPending || updateCalendar.isPending;
  const canSave = Boolean(name.trim()) && (isPersonal || Boolean(scopeKey));

  const handleSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Calendar name is required.");
      return;
    }
    if (!isPersonal && !scopeKey) {
      setError("Select a scope for this calendar.");
      return;
    }
    const [scopeTypeRaw, scopeIdRaw] = scopeKey.split(":");
    const scopeId = Number(scopeIdRaw);
    try {
      if (isEditing && calendar) {
        await updateCalendar.mutateAsync({
          calendarId: calendar.id,
          name: trimmedName,
          color,
          ...(calendar.isPersonal
            ? {}
            : {
                scopeType: scopeTypeRaw as "business" | "department" | "division",
                scopeId,
              }),
        });
      } else {
        if (isPersonal) {
          await createCalendar.mutateAsync({
            name: trimmedName,
            color,
            isPersonal: true,
          });
        } else {
          await createCalendar.mutateAsync({
            name: trimmedName,
            color,
            isPersonal: false,
            scopeType: scopeTypeRaw as "business" | "department" | "division",
            scopeId,
          });
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save calendar.");
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--color-overlay-backdrop)] px-4">
      <div className="w-full max-w-lg rounded-2xl border border-outline-muted bg-surface-raised p-6 text-ink-primary shadow-2xl shadow-[var(--shadow-pane)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">{isEditing ? "Edit calendar" : "New calendar"}</div>
          <button className="rounded-md border border-outline-muted px-2 py-1 hover:bg-surface-muted" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Color
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-outline-muted bg-transparent"
                />
                <input
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                />
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase text-ink-subtle">Calendar type</div>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={isPersonal}
                  disabled={isEditing}
                  onChange={() => setIsPersonal(true)}
                  className="accent-accent-strong"
                />
                Personal
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!isPersonal}
                  disabled={isEditing || !canCreateShared}
                  onChange={() => setIsPersonal(false)}
                  className="accent-accent-strong"
                />
                Team
              </label>
              {!canCreateShared && !isPersonal ? (
                <span className="text-xs text-ink-muted">No shared scopes available.</span>
              ) : null}
            </div>
          </div>

          {!isPersonal ? (
            <label className="flex flex-col gap-2 text-xs uppercase text-ink-subtle">
              Scope
              <select
                value={scopeKey}
                onChange={(event) => setScopeKey(event.target.value)}
                className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
              >
                <option value="">Select scope</option>
                {scopeOptions.map((option) => (
                  <option key={`${option.scopeType}:${option.scopeId}`} value={`${option.scopeType}:${option.scopeId}`}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {error ? <div className="rounded-md border border-status-danger bg-status-danger-surface px-3 py-2 text-sm text-status-danger">{error}</div> : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-outline-muted px-3 py-1.5 text-sm text-ink-subtle hover:border-outline-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSave || isSaving}
              className="rounded-md bg-accent-strong px-3 py-1.5 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:opacity-60"
            >
              {isSaving ? "Saving..." : isEditing ? "Update calendar" : "Create calendar"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
