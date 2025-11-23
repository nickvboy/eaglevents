"use client";

import { useMemo } from "react";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellIcon,
  ChartLineIcon,
  UsersIcon,
} from "~/app/_components/icons";
import { api } from "~/trpc/react";

type SeriesPoint = {
  label: string;
  value: number;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatDelta(delta: { delta: number; percent: number; direction: "increase" | "decrease" | "neutral" }) {
  if (delta.direction === "neutral") {
    return { text: "No change", tone: "neutral" as const, icon: null };
  }
  const Icon = delta.direction === "increase" ? ArrowUpIcon : ArrowDownIcon;
  const tone = delta.direction === "increase" ? "positive" : "negative";
  return {
    text: `${Math.abs(delta.percent)}% vs prev.`,
    tone,
    icon: Icon,
  };
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeTime(input: Date | string | null) {
  const date = coerceDate(input);
  if (!date) return "No recent activity";
  const now = Date.now();
  const time = date.getTime();
  const diffMs = now - time;
  if (diffMs < 0) return "Scheduled";
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 31) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears}y ago`;
}

function formatFutureTime(input: Date | string) {
  const date = coerceDate(input);
  if (!date) return "Scheduled";
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "Started";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `In ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `In ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `In ${days}d`;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Sparkline({ series, color = "#34d399" }: { series: SeriesPoint[]; color?: string }) {
  const path = useMemo(() => {
    if (series.length === 0) return "";
    const max = Math.max(...series.map((point) => point.value), 1);
    if (series.length === 1) {
      return `M0 50 L100 50`;
    }
    return series
      .map((point, index) => {
        const x = (index / (series.length - 1)) * 100;
        const y = 100 - (point.value / max) * 100;
        return `${index === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }, [series]);

  return (
    <svg viewBox="0 0 100 100" className="h-32 w-full">
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function BarColumns({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(...series.map((point) => point.value), 1);
  return (
    <div className="flex h-32 w-full items-end gap-2">
      {series.map((point) => {
        const height = max === 0 ? 0 : Math.max(8, Math.round((point.value / max) * 100));
        return (
          <div key={point.label} className="flex w-full flex-col items-center gap-2">
            <div
              className="w-full max-w-[22px] rounded-full bg-gradient-to-t from-emerald-500/20 via-emerald-400/60 to-emerald-300"
              style={{ height: `${height}%` }}
              aria-hidden
            />
            <span className="text-xs font-medium text-white/60">{point.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardView() {
  const { data, isLoading, isError } = api.admin.dashboard.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-28 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
              <div className="h-full animate-pulse rounded-xl bg-white/5" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <div className="h-64 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
          <div className="h-64 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        Unable to load admin dashboard data. Please try again in a moment.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.summaryCards.map((card) => {
          const delta = formatDelta(card.delta);
          return (
            <article
              key={card.id}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 via-white/3 to-transparent p-6 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
            >
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-white/50">{card.label}</span>
                </div>
                <ChartLineIcon className="h-4 w-4 text-emerald-300/80" />
              </header>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-3xl font-semibold text-white">{formatNumber(card.value)}</span>
                <span className="text-xs text-white/50">{card.helper}</span>
              </div>
              {delta.icon ? (
                <div
                  className={
                    "mt-4 flex items-center gap-1 text-xs font-medium " +
                    (delta.tone === "positive" ? "text-emerald-300" : "text-red-300")
                  }
                >
                  <delta.icon className="h-3 w-3" />
                  <span>{delta.text}</span>
                </div>
              ) : (
                <div className="mt-4 text-xs text-white/60">{delta.text}</div>
              )}
            </article>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <article className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Event Volume</h2>
              <p className="text-sm text-white/60">Total activity across the last {data.charts.eventTrend.length} months</p>
            </div>
            <ChartLineIcon className="h-5 w-5 text-emerald-300" />
          </header>
          <div className="mt-6">
            <Sparkline series={data.charts.eventTrend} />
          </div>
          <footer className="mt-4 flex items-center justify-between text-xs text-white/60">
            <span>
              {formatNumber(data.charts.totals.eventTrendTotal)} events across{" "}
              {data.charts.eventTrend.length} months
            </span>
            <span className="text-emerald-300">Peak: {formatNumber(Math.max(...data.charts.eventTrend.map((p) => p.value), 0))}</span>
          </footer>
        </article>

        <article className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Active Users</h2>
              <p className="text-sm text-white/60">Most recent contributors</p>
            </div>
            <UsersIcon className="h-5 w-5 text-emerald-300" />
          </header>
          <ul className="mt-6 flex flex-col gap-4">
            {data.activeUsers.map((user) => (
              <li key={user.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-white">{user.name}</span>
                  <span className="text-xs text-white/50">{user.email}</span>
                </div>
                <span className="text-xs font-medium text-emerald-300">{formatRelativeTime(user.lastActivity)}</span>
              </li>
            ))}
            {data.activeUsers.length === 0 ? (
              <li className="rounded-xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/50">
                No active users yet. Encourage teams to start scheduling events.
              </li>
            ) : null}
          </ul>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <article className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">User Growth</h2>
              <p className="text-sm text-white/60">New users added by month</p>
            </div>
          </header>
          <div className="mt-6">
            <BarColumns series={data.charts.userTrend} />
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
          <header className="flex items-center gap-2">
            <BellIcon className="h-5 w-5 text-emerald-300" />
            <h2 className="text-lg font-semibold text-white">Recent Alerts</h2>
          </header>
          <ul className="mt-6 flex flex-col gap-4">
            {data.alerts.length === 0 ? (
              <li className="rounded-xl border border-white/5 bg-white/5 px-4 py-6 text-sm text-white/60">
                No alerts to show. Operations are running smoothly.
              </li>
            ) : (
              data.alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={
                    "rounded-xl border px-4 py-3 text-sm " +
                    (alert.severity === "critical"
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : alert.severity === "warning"
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
                        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100")
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{alert.message}</span>
                    <span className="text-xs text-white/60">{formatRelativeTime(alert.occurredAt)}</span>
                  </div>
                </li>
              ))
            )}
          </ul>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Upcoming Events</h2>
            <p className="text-sm text-white/60">Next two weeks across all calendars</p>
          </div>
        </header>
        <ul className="mt-6 divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
          {data.upcomingEvents.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-white/60">
              Nothing on the horizon. Schedule events to keep teams aligned.
            </li>
          ) : (
            data.upcomingEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between px-4 py-3 transition hover:bg-white/5">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-white">{event.title}</span>
                  <span className="text-xs text-white/60">
                    {event.assigneeName ? `${event.assigneeName} • ` : ""}
                    {event.start.toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <span className="text-xs font-medium text-emerald-300">{formatFutureTime(event.start)}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

