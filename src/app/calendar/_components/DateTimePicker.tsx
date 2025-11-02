"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, startOfDay } from "../utils/date";

type Props = {
  value: Date;
  onChange: (d: Date) => void;
  label?: string;
};

export function DateTimePicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(new Date(value));
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
          <div className="mb-2 flex items-center justify-between text-white">
            <button
              className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10"
              onClick={() => setDraftDate(new Date(draftDate.getFullYear(), draftDate.getMonth() - 1, draftDate.getDate()))}
            >
              {"<"}
            </button>
            <div className="text-sm">
              {draftDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
            </div>
            <button
              className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10"
              onClick={() => setDraftDate(new Date(draftDate.getFullYear(), draftDate.getMonth() + 1, draftDate.getDate()))}
            >
              {">"}
            </button>
          </div>
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
                  onClick={() => setDraftDate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), draftDate.getHours(), draftDate.getMinutes()))}
                  className={
                    "relative h-8 rounded-md text-center transition-colors " +
                    (inMonth ? "text-white" : "text-white/40")
                  }
                >
                  <span
                    className={
                      "relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full " +
                      (isSelected ? "bg-emerald-500 text-black font-medium" : isToday ? "border border-emerald-500" : "")
                    }
                  >
                    {d.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
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
