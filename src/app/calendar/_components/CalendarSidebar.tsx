"use client";

import { useEffect, useRef, useState } from "react";

import { addDays, startOfDay } from "../utils/date";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "~/app/_components/icons";

type MonthWidgetProps = {
  monthDate: Date;
  selectedDate: Date;
  onSelect: (d: Date) => void;
  onMonthChange: (direction: number) => void;
  focusedWeekStart: Date; // start of the week currently in focus
  calendars: { id: number; name: string; color: string }[];
  visibleCalendarIds: number[];
  onToggleCalendar: (id: number) => void;
};

function buildMonthGrid(refDate: Date) {
  const first = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const start = new Date(first);
  const offset = (first.getDay() + 7) % 7; // sunday start
  start.setDate(first.getDate() - offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  return days;
}

export function CalendarSidebar(props: MonthWidgetProps) {
  const days = buildMonthGrid(props.monthDate);
  const today = startOfDay(new Date());
  const selected = startOfDay(props.selectedDate);
  const focusWeek = startOfDay(props.focusedWeekStart);
  const [animateDirection, setAnimateDirection] = useState<"forward" | "backward" | null>(null);
  const wheelAccumulator = useRef(0);
  const wheelTimeout = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"day" | "month">("day");
  const [monthSelectionYear, setMonthSelectionYear] = useState(props.monthDate.getFullYear());

  useEffect(() => {
    return () => {
      if (wheelTimeout.current !== null) {
        window.clearTimeout(wheelTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!animateDirection) return;
    const id = window.setTimeout(() => setAnimateDirection(null), 180);
    return () => window.clearTimeout(id);
  }, [animateDirection]);

  const applyMonthChange = (direction: number) => {
    if (!direction) return;
    setAnimateDirection(direction > 0 ? "forward" : "backward");
    props.onMonthChange(direction);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      if (mode !== "day") return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      event.stopPropagation();
      wheelAccumulator.current += event.deltaY;
      if (wheelTimeout.current !== null) window.clearTimeout(wheelTimeout.current);
      wheelTimeout.current = window.setTimeout(() => {
        wheelAccumulator.current = 0;
      }, 150);

      if (Math.abs(wheelAccumulator.current) >= 40) {
        const direction = wheelAccumulator.current > 0 ? 1 : -1;
        wheelAccumulator.current = 0;
        applyMonthChange(direction);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [props.monthDate, props.onMonthChange, mode]);

  useEffect(() => {
    if (mode === "month") {
      setMonthSelectionYear(props.monthDate.getFullYear());
    }
  }, [mode, props.monthDate]);

  const handleSelectMonth = (monthIndex: number) => {
    const current = props.monthDate;
    const diff = (monthSelectionYear - current.getFullYear()) * 12 + (monthIndex - current.getMonth());
    if (diff !== 0) {
      applyMonthChange(diff);
    }
    setMode("day");
  };

  return (
    <aside
      ref={containerRef}
      className="w-64 shrink-0 overflow-hidden border-r border-white/10 bg-black/30 p-3 text-sm text-white"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="mb-3">
        {mode === "day" ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-base text-white transition hover:bg-white/10"
                onClick={() => applyMonthChange(-1)}
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                aria-label="Select month"
                className="flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1 text-base font-semibold transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-2 cursor-pointer select-none"
                onClick={() => {
                  setMonthSelectionYear(props.monthDate.getFullYear());
                  setMode("month");
                }}
              >
                {props.monthDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-base text-white transition hover:bg-white/10"
                onClick={() => applyMonthChange(1)}
              >
                <ChevronRightIcon />
              </button>
            </div>
            <div
              className={
                "grid grid-cols-7 gap-1 transform transition-all duration-200 ease-out " +
                (animateDirection === "forward"
                  ? "-translate-y-1 opacity-80"
                  : animateDirection === "backward"
                    ? "translate-y-1 opacity-80"
                    : "")
              }
            >
              {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                <div key={`${d}-${idx}`} className="px-1 text-center text-xs text-white/60">
                  {d}
                </div>
              ))}
              {days.map((d, idx) => {
                const inMonth = d.getMonth() === props.monthDate.getMonth();
                const isToday = startOfDay(d).getTime() === today.getTime();
                const isSelected = startOfDay(d).getTime() === selected.getTime();
                const isInFocusWeek =
                  startOfDay(d).getTime() >= focusWeek.getTime() &&
                  startOfDay(d).getTime() < addDays(focusWeek, 7).getTime();
                return (
                  <button
                    key={`${d.toISOString()}-${idx}`}
                    onClick={() => props.onSelect(d)}
                    className={
                      "relative h-8 rounded-md text-center transition-colors " +
                      (inMonth ? "text-white" : "text-white/40")
                    }
                  >
                    {isInFocusWeek && (
                      <span className="absolute inset-x-1/2 top-0 h-full w-9 -translate-x-1/2 rounded-full bg-white/5" />
                    )}
                    <span
                      className={
                        "relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full " +
                        (isSelected
                          ? "bg-emerald-500 text-black font-medium"
                          : isToday
                            ? "border border-emerald-500"
                            : "hover:bg-white/10")
                      }
                    >
                      {d.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 text-white">
              <button
                type="button"
                aria-label="Back to day view"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-base transition hover:bg-white/10 cursor-pointer"
                onClick={() => setMode("day")}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <div className="ml-auto flex items-center gap-3">
                <div className="text-base font-semibold">{monthSelectionYear}</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Increase year"
                    className="flex items-center justify-center rounded-md p-1 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-1 cursor-pointer select-none"
                    onClick={() => setMonthSelectionYear((year) => year + 1)}
                  >
                    <ArrowUpIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Decrease year"
                    className="flex items-center justify-center rounded-md p-1 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-1 cursor-pointer select-none"
                    onClick={() => setMonthSelectionYear((year) => year - 1)}
                  >
                    <ArrowDownIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 px-2 pb-2 pt-1 text-sm">
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
                (label, idx) => {
                  const isSelected =
                    idx === props.monthDate.getMonth() && monthSelectionYear === props.monthDate.getFullYear();
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleSelectMonth(idx)}
                      className={
                        "rounded-md px-3 py-2 text-center transition-all duration-150 cursor-pointer select-none " +
                        (isSelected
                          ? "bg-emerald-500 text-black shadow shadow-emerald-500/30"
                          : "bg-white/5 text-white/80 hover:bg-white/10")
                      }
                      aria-pressed={isSelected}
                    >
                      {label}
                    </button>
                  );
                },
              )}
            </div>
          </>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs uppercase text-white/60">My calendars</div>
        <div className="flex flex-col gap-1">
          {props.calendars.map((c) => {
            const visible = props.visibleCalendarIds.includes(c.id);
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => props.onToggleCalendar(c.id)}
                  className="accent-emerald-500"
                />
                <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: c.color }} />
                <span className="truncate">{c.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

