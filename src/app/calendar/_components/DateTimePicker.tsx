"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, startOfDay } from "../utils/date";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "~/app/_components/icons";

type Props = {
  value: Date;
  onChange: (d: Date) => void;
  label?: string;
};

export function DateTimePicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(new Date(value));
  const [mode, setMode] = useState<"day" | "month">("day");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => setDraftDate(new Date(value)), [value]);

  const hours = Array.from({ length: 24 * 2 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? 0 : 30;
    const d = new Date(draftDate);
    d.setHours(h, m, 0, 0);
    return d;
  });

  function buildMonthGrid(refDate: Date) {
    const first = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    const start = new Date(first);
    const offset = (first.getDay() + 7) % 7; // sunday
    start.setDate(first.getDate() - offset);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(start, i));
    return days;
  }

  const days = useMemo(() => buildMonthGrid(draftDate), [draftDate]);
  const today = startOfDay(new Date());
  const selected = startOfDay(draftDate);

  useEffect(() => {
    if (!open) setMode("day");
  }, [open]);

  const monthNames = useMemo(
    () => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    [],
  );

  const adjustMonth = (delta: number) => {
    const next = new Date(draftDate);
    next.setMonth(draftDate.getMonth() + delta);
    setDraftDate(next);
  };

  const adjustYear = (delta: number) => {
    const next = new Date(draftDate);
    next.setFullYear(next.getFullYear() + delta);
    setDraftDate(next);
  };

  const selectMonth = (monthIndex: number) => {
    const year = draftDate.getFullYear();
    const currentDay = draftDate.getDate();
    const daysInTargetMonth = new Date(year, monthIndex + 1, 0).getDate();
    const clampedDay = Math.min(currentDay, daysInTargetMonth);
    const next = new Date(draftDate);
    next.setFullYear(year, monthIndex, clampedDay);
    setDraftDate(next);
    setMode("day");
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-white/20 bg-black/40 px-2 py-1 text-sm text-white hover:bg-white/10"
        onClick={() => setOpen((v) => !v)}
      >
        {label && <span className="text-white/60">{label}</span>}
        <span>
          {value.toLocaleDateString()} {value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-72 rounded-md border border-white/10 bg-black/90 p-3 shadow-lg">
          {mode === "day" ? (
            <div className="mb-2 flex items-center justify-between text-white">
              <button
                type="button"
                aria-label="Previous month"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/20 hover:bg-white/10"
                onClick={() => adjustMonth(-1)}
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                aria-label="Select month"
                className="flex items-center gap-1 rounded-md px-3 py-1 text-sm font-medium transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-2 cursor-pointer select-none"
                onClick={() => setMode("month")}
              >
                {draftDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Next month"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/20 hover:bg-white/10"
                onClick={() => adjustMonth(1)}
              >
                <ChevronRightIcon />
              </button>
            </div>
          ) : (
            <div className="mb-3 flex items-center text-white">
              <button
                type="button"
                aria-label="Back to day view"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/20 hover:bg-white/10 transition cursor-pointer"
                onClick={() => setMode("day")}
              >
                <ChevronDownIcon className="h-4 w-4 transition-transform" />
              </button>
              <div className="ml-auto flex items-center gap-2">
                <div className="text-base font-semibold">{draftDate.getFullYear()}</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Increase year"
                    className="flex items-center justify-center rounded-md p-1 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-1 cursor-pointer select-none"
                    onClick={() => adjustYear(1)}
                  >
                    <ArrowUpIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Decrease year"
                    className="flex items-center justify-center rounded-md p-1 text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-1 cursor-pointer select-none"
                    onClick={() => adjustYear(-1)}
                  >
                    <ArrowDownIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === "day" ? (
            <div className="grid grid-cols-7 gap-1">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                <div key={`${d}-${idx}`} className="px-1 text-center text-xs text-white/60">
                  {d}
                </div>
              ))}
              {days.map((d, idx) => {
                const inMonth = d.getMonth() === draftDate.getMonth();
                const isToday = startOfDay(d).getTime() === today.getTime();
                const isSelected = startOfDay(d).getTime() === selected.getTime();
                return (
                  <button
                    key={`${d.toISOString()}-${idx}`}
                    onClick={() =>
                      setDraftDate(
                        new Date(
                          d.getFullYear(),
                          d.getMonth(),
                          d.getDate(),
                          draftDate.getHours(),
                          draftDate.getMinutes(),
                        ),
                      )
                    }
                    className={
                      "relative h-8 rounded-md text-center transition-colors duration-150 ease-out " +
                      (inMonth ? "text-white" : "text-white/40 hover:text-white/70")
                    }
                  >
                    <span
                      className={
                        "relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150 " +
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
          ) : (
            <div className="grid grid-cols-3 gap-2 px-2 pb-2 pt-1 text-sm">
              {monthNames.map((label, idx) => {
                const isSelected = idx === draftDate.getMonth();
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => selectMonth(idx)}
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
              })}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select
              className="w-full rounded-md border border-white/20 bg-black/40 p-1 text-sm text-white"
              value={`${draftDate.getHours()}:${draftDate.getMinutes()}`}
              onChange={(e) => {
                const [hourPart, minutePart] = e.target.value.split(":");
                const h = Number(hourPart ?? 0);
                const m = Number(minutePart ?? 0);
                const d = new Date(draftDate);
                d.setHours(h, m, 0, 0);
                setDraftDate(d);
              }}
            >
              {hours.map((d) => (
                <option key={d.toISOString()} value={`${d.getHours()}:${d.getMinutes()}`}>
                  {d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </option>
              ))}
            </select>
            <button
              className="rounded-md bg-emerald-600 px-2 py-1 text-sm font-medium text-black"
              onClick={() => {
                onChange(draftDate);
                setOpen(false);
              }}
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
