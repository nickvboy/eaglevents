const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export type MonthBucket = {
  start: Date;
  end: Date;
  label: string;
};

export type SeriesPoint = {
  label: string;
  value: number;
};

export type TrendDelta = {
  delta: number;
  percent: number;
  direction: "increase" | "decrease" | "neutral";
};

function clone(date: Date) {
  return new Date(date.getTime());
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

export function getMonthBuckets(endDate: Date, count: number): MonthBucket[] {
  if (count <= 0) return [];
  const buckets: MonthBucket[] = [];
  const cursor = startOfMonth(clone(endDate));
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    const end = endOfMonth(start);
    buckets.push({
      start,
      end,
      label: MONTH_LABEL.format(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))),
    });
  }
  return buckets;
}

export function bucketizeByMonth(dates: Date[], bucketCount: number, endDate = new Date()): SeriesPoint[] {
  const buckets = getMonthBuckets(endDate, bucketCount);
  if (buckets.length === 0) return [];
  const counts = Array.from({ length: buckets.length }, () => 0);
  for (const date of dates) {
    const time = date.getTime();
    for (let index = buckets.length - 1; index >= 0; index--) {
      const bucket = buckets[index]!;
      if (time >= bucket.start.getTime() && time <= bucket.end.getTime()) {
        counts[index]! += 1;
        break;
      }
    }
  }
  return buckets.map((bucket, index) => ({
    label: bucket.label,
    value: counts[index] ?? 0,
  }));
}

export function calculateTrendDelta(current: number, previous: number): TrendDelta {
  const delta = current - previous;
  if (current === 0 && previous === 0) {
    return { delta: 0, percent: 0, direction: "neutral" };
  }
  if (previous === 0) {
    if (delta === 0) return { delta: 0, percent: 0, direction: "neutral" };
    return { delta, percent: 100, direction: delta > 0 ? "increase" : "decrease" };
  }
  const percent = Math.round((Math.abs(delta) / Math.abs(previous)) * 1000) / 10;
  const direction = delta === 0 ? "neutral" : delta > 0 ? "increase" : "decrease";
  return { delta, percent, direction };
}

export function sumSeries(series: SeriesPoint[]): number {
  return series.reduce((acc, point) => acc + point.value, 0);
}
