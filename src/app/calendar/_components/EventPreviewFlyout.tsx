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
  assigneeProfile?: {
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  totalLoggedMinutes?: number;
};

type EventPreviewFlyoutProps = {
  event: PreviewEvent | null;
  calendar: CalendarInfo;
  open: boolean;
  placement?: "down" | "up";
  side?: "left" | "right";
  onExpand: () => void;
  onEdit: () => void;
};

export function EventPreviewFlyout({
  event,
  calendar,
  open,
  placement = "down",
  side = "right",
  onExpand,
  onEdit,
}: EventPreviewFlyoutProps) {
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
  const assigneeName = displayEvent.assigneeProfile
    ? [displayEvent.assigneeProfile.firstName, displayEvent.assigneeProfile.lastName].filter(Boolean).join(" ").trim() ||
      displayEvent.assigneeProfile.email
    : null;
  const totalLoggedMinutes = displayEvent.totalLoggedMinutes ?? 0;
  const totalLoggedHours = Math.round((totalLoggedMinutes / 60) * 100) / 100;
  const placementClass = placement === "up" ? "bottom-0" : "top-0";
  const sideClass = side === "left" ? "right-[calc(100%+0.5rem)]" : "left-[calc(100%+0.5rem)]";
  const pointerSideClass = side === "left" ? "-right-2" : "-left-2";
  const pointerBorderClass =
    side === "left"
      ? placement === "up"
        ? "bottom-6 border-b border-r"
        : "top-6 border-r border-t"
      : placement === "up"
        ? "bottom-6 border-b border-l"
        : "top-6 border-l border-t";
  const motionClass = open
    ? "translate-y-0 opacity-100"
    : placement === "up"
      ? "-translate-y-1 opacity-0"
      : "translate-y-1 opacity-0";

  return (
    <aside
      className={
        `pointer-events-none absolute ${sideClass} ${placementClass} z-30 w-72 transition-all duration-200 ease-out ` +
        motionClass
      }
      aria-hidden={!open}
    >
      <div className="pointer-events-auto relative flex max-h-[360px] flex-col overflow-hidden rounded-2xl border border-outline-muted bg-surface-raised/95 shadow-xl shadow-[var(--shadow-pane)] backdrop-blur">
        <span
          className={`pointer-events-none absolute ${pointerSideClass} block h-4 w-4 rotate-45 rounded-sm ${pointerBorderClass} border-outline-muted bg-surface-raised/95 shadow-lg shadow-[var(--shadow-pane)]`}
        />
        <header className="flex items-start justify-between gap-3 border-b border-outline-muted bg-surface-muted px-4 py-3">
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-widest text-status-success">Preview</div>
            <h2 className="mt-1 text-base font-semibold text-ink-primary">{displayEvent.title}</h2>
            {calendar && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs text-ink-subtle">
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
              className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-muted text-ink-primary transition hover:bg-surface-muted hover:text-ink-primary"
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
              className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-muted text-ink-primary transition hover:bg-surface-muted hover:text-ink-primary"
              aria-label="Edit event"
            >
              <EditIcon className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="space-y-4 overflow-y-auto px-4 py-3 text-sm text-ink-primary">
          <div className="rounded-lg border border-outline-muted bg-surface-muted p-3 text-[13px] text-ink-subtle">
            <div>{dateLabel}</div>
            <div>{timeLabel}</div>
            {displayEvent.location && (
              <div className="mt-2 text-xs uppercase tracking-wide text-ink-subtle">{displayEvent.location}</div>
            )}
            {displayEvent.assigneeProfile && assigneeName && (
              <div className="mt-2 text-xs text-ink-muted">
                Assigned to <span className="font-medium text-ink-primary">{assigneeName}</span>
              </div>
            )}
            {totalLoggedMinutes > 0 && (
              <div className="mt-1 text-xs text-ink-muted">
                Logged <span className="font-semibold text-ink-primary">{totalLoggedHours.toFixed(2)}h</span>
              </div>
            )}
          </div>

          {displayEvent.description && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">At a glance</div>
              <p className="max-h-28 overflow-hidden whitespace-pre-line text-sm leading-relaxed text-ink-subtle">
                {displayEvent.description}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Quick actions</div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md border border-outline-muted px-3 py-1.5 text-xs font-medium text-ink-primary transition hover:bg-surface-muted hover:text-ink-primary">
                Email organizer
              </button>
              <button className="rounded-md border border-outline-muted px-3 py-1.5 text-xs font-medium text-ink-subtle transition hover:bg-surface-muted hover:text-ink-primary">
                Add note
              </button>
            </div>
          </div>
        </div>
        <footer className="border-t border-outline-muted bg-surface-muted px-4 py-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            className="w-full rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
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
