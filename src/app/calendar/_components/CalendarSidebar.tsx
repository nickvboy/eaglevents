"use client";

import { addDays, startOfDay } from "../utils/date";

type MonthWidgetProps = {
  activeDate: Date;
  selectedDate: Date;
  onSelect: (d: Date) => void;
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
  const days = buildMonthGrid(props.activeDate);
  const today = startOfDay(new Date());
  const selected = startOfDay(props.selectedDate);
  const focusWeek = startOfDay(props.focusedWeekStart);

  return (
    <aside className="w-64 shrink-0 border-r border-white/10 bg-black/30 p-3 text-sm text-white">
      <div className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold">
            {props.activeDate.toLocaleString(undefined, { month: "long", year: "numeric" })}
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
            <div key={`${d}-${idx}`} className="px-1 text-center text-xs text-white/60">
              {d}
            </div>
          ))}
          {days.map((d, idx) => {
            const inMonth = d.getMonth() === props.activeDate.getMonth();
            const isToday = startOfDay(d).getTime() === today.getTime();
            const isSelected = startOfDay(d).getTime() === selected.getTime();
            const isInFocusWeek = startOfDay(d).getTime() >= focusWeek.getTime() && startOfDay(d).getTime() < addDays(focusWeek, 7).getTime();
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
                  <span className="absolute inset-0 rounded-md bg-white/5" />
                )}
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
