export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function startOfWeek(d: Date, workWeek = false) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 sun ... 6 sat
  const delta = day; // week starts on Sunday
  return addDays(x, -delta);
}

export function endOfWeek(d: Date, workWeek = false) {
  const start = startOfWeek(d, workWeek);
  return addDays(start, workWeek ? 4 : 6);
}

export function daysInRange(start: Date, end: Date) {
  const days: Date[] = [];
  const cur = startOfDay(start);
  const last = startOfDay(end);
  while (cur <= last) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function formatRangeLabel(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: start.getFullYear() !== end.getFullYear() ? "numeric" : undefined,
  });
  const s = formatter.format(start);
  const e = formatter.format(end);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    // Example: October 27–31, 2025
    const month = new Intl.DateTimeFormat(undefined, { month: "long" }).format(start);
    return `${month} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${s} – ${e}`;
}

export function minutesSinceStartOfDay(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

