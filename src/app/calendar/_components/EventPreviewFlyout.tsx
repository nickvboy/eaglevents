"use client";

import { useEffect, useRef, useState } from "react";
import { EditIcon, MaximizeIcon } from "~/app/_components/icons";

type CalendarInfo = { name: string; color: string } | null;

type PreviewEvent = {
  id: number;
  title: string;
  location: string | null;
  description?: string | null;
  startDatetime: string | Date;
  endDatetime: string | Date;
};

type EventPreviewFlyoutProps = {
  event: PreviewEvent | null;
  calendar: CalendarInfo;
  open: boolean;
  onExpand: () => void;
  onEdit: () => void;
};

export function EventPreviewFlyout({ event, calendar, open, onExpand, onEdit }: EventPreviewFlyoutProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const lastEventRef = useRef<typeof event>(null);

  useEffect(() => {
    if (event) lastEventRef.current = event;
  }, [event]);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      return;
    }
    const timeout = setTimeout(() => setShouldRender(false), 180);
    return () => clearTimeout(timeout);
  }, [open]);

  const displayEvent = event ?? lastEventRef.current;

  if (!shouldRender || !displayEvent) return null;

  const start = new Date(displayEvent.startDatetime);
  const end = new Date(displayEvent.endDatetime);
  const dateLabel = formatDateRange(start, end);
  const timeLabel = formatTimeRange(start, end);

  return (
    <aside
      className={
        "pointer-events-none absolute left-[calc(100%+0.5rem)] top-0 z-30 w-72 transition-all duration-200 ease-out " +
        (open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0")
      }
      aria-hidden={!open}
    >
      <div className="pointer-events-auto rounded-2xl border border-white/10 bg-neutral-950/95 shadow-xl shadow-black/40 backdrop-blur relative">
        <span className="pointer-events-none absolute -left-2 top-6 block h-4 w-4 rotate-45 rounded-sm border-l border-t border-white/10 bg-neutral-950/95 shadow-lg shadow-black/40" />
        <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3">
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-widest text-emerald-300">Preview</div>
            <h2 className="mt-1 text-base font-semibold text-white">{displayEvent.title}</h2>
            {calendar && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs text-white/70">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: calendar.color }} />
                {calendar.name}
              </div>
            )}
          </div>
          <div className="flex-shrink-0 space-y-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="Open full event"
            >
              <MaximizeIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="Edit event"
            >
              <EditIcon className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="space-y-4 px-4 py-3 text-sm text-white/80">
          <div className="rounded-lg border border-white/10 bg-black/40 p-3 text-[13px] text-white/70">
            <div>{dateLabel}</div>
            <div>{timeLabel}</div>
            {displayEvent.location && (
              <div className="mt-2 text-xs uppercase tracking-wide text-white/50">{displayEvent.location}</div>
            )}
          </div>

          {displayEvent.description && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">At a glance</div>
              <p className="max-h-28 overflow-hidden whitespace-pre-line text-sm leading-relaxed text-white/70">
                {displayEvent.description}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Quick actions</div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
                Email organizer
              </button>
              <button className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white">
                Add note
              </button>
            </div>
          </div>
        </div>
        <footer className="border-t border-white/10 bg-black/40 px-4 py-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            View full details
          </button>
        </footer>
      </div>
    </aside>
  );
}

function formatDateRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  return sameDay ? formatter.format(start) : `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatTimeRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}
