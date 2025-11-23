"use client";

import { useEffect, type ReactNode } from "react";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ChevronLeftIcon, EditIcon } from "~/app/_components/icons";

type CalendarInfo = { name: string; swatchClass: string } | null;

type EventDetailDrawerProps = {
  event: RouterOutputs["event"]["list"][number] | null;
  calendar: CalendarInfo;
  open: boolean;
  onClose: () => void;
  onEdit: (eventId: number) => void;
};

export function EventDetailDrawer({ event, calendar, open, onClose, onEdit }: EventDetailDrawerProps) {
  const utils = api.useUtils();
  const deleteMutation = api.event.delete.useMutation({
    onSuccess: async () => {
      await utils.event.invalidate();
      onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !event) return null;

  const start = new Date(event.startDatetime);
  const end = new Date(event.endDatetime);
  const dateLabel = formatDatePart(start, end);
  const timeLabel = formatTimePart(start, end);
  const assigneeName = event.assigneeProfile
    ? [event.assigneeProfile.firstName, event.assigneeProfile.lastName].filter(Boolean).join(" ").trim() ||
      event.assigneeProfile.email
    : null;
  const totalLoggedMinutes = event.totalLoggedMinutes ?? 0;
  const totalLoggedHours = Math.round((totalLoggedMinutes / 60) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-raised text-ink-primary">
      <header className="flex items-center gap-3 border-b border-outline-muted bg-surface-overlay px-4 py-3">
        <button
          type="button"
          aria-label="Close details"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-muted hover:bg-surface-muted"
          onClick={onClose}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </button>
        <div className="text-sm uppercase tracking-wide text-ink-muted">Meeting details</div>
      </header>
      <main className="flex-1 overflow-y-auto px-5 pb-16 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <section className="space-y-2">
            <h1 className="text-2xl font-semibold">{event.title}</h1>
            <div className="text-sm text-ink-subtle">
              <div>{dateLabel}</div>
              <div>{timeLabel}</div>
              {event.location && <div className="mt-1 text-ink-muted">{event.location}</div>}
              {calendar && (
                <div className="mt-2 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-ink-subtle">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${calendar.swatchClass}`} />
                  {calendar.name}
                </div>
              )}
              {assigneeName && (
                <div className="mt-3 rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-xs">
                  <div className="text-ink-subtle">Assigned to</div>
                  <div className="font-medium text-ink-primary">{assigneeName}</div>
                  <div className="text-ink-subtle">{event.assigneeProfile?.email}</div>
                </div>
              )}
            </div>
          </section>

          {event.description && (
            <section className="space-y-2">
              <SectionHeading>Details</SectionHeading>
              <p className="rounded-xl border border-outline-muted bg-surface-sunken/50 p-4 text-sm text-ink-primary whitespace-pre-line">
                {event.description}
              </p>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionHeading>Participants</SectionHeading>
              <button className="text-xs font-medium text-status-success hover:text-accent-soft">See more</button>
            </div>
            <div className="space-y-2 rounded-xl border border-outline-muted bg-surface-muted p-4 text-sm text-ink-primary">
              <div className="flex items-center justify-between">
                <span className="font-medium">Organizer</span>
                <span className="text-xs text-ink-subtle">{calendar?.name ?? "Calendar"}</span>
              </div>
              <div className="text-xs text-ink-subtle">Event created {start.toLocaleString()}</div>
              <div className="mt-3 text-xs text-ink-muted">Attendee details are not available for this event.</div>
            </div>
          </section>

          {totalLoggedMinutes > 0 && event.hourLogs && event.hourLogs.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <SectionHeading>Hour logs</SectionHeading>
                <div className="text-xs text-ink-muted">{totalLoggedHours.toFixed(2)} hours total</div>
              </div>
              <div className="space-y-2 rounded-xl border border-outline-muted bg-surface-muted p-4 text-sm text-ink-primary">
                {event.hourLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-muted pb-2 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <div className="font-medium">{formatLogRange(log.startTime, log.endTime)}</div>
                      <div className="text-xs text-ink-subtle">{formatLogDate(log.startTime)}</div>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {(log.durationHours ?? log.durationMinutes / 60).toFixed(2)}h
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <SectionHeading>Actions</SectionHeading>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-outline-muted px-3 py-1.5 text-sm text-ink-primary hover:bg-surface-muted"
                onClick={() => onEdit(event.id)}
              >
                <span className="inline-flex items-center gap-2">
                  <EditIcon className="h-4 w-4" />
                  Edit
                </span>
              </button>
              <button
                className="rounded-md border border-status-danger px-3 py-1.5 text-sm text-status-danger transition hover:bg-status-danger-surface disabled:border-status-danger/60 disabled:text-status-danger/60"
                onClick={() => deleteMutation.mutate({ id: event.id })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{children}</div>;
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: ReactNode;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-xl border border-outline-muted bg-surface-sunken/50 p-4">
      <div className="text-xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={"mt-1 text-sm text-ink-primary " + (multiline ? "whitespace-pre-line" : "")}>{value}</div>
    </div>
  );
}

function formatDatePart(start: Date, end: Date) {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  return sameDay
    ? dateFormatter.format(start)
    : `${dateFormatter.format(start)} - ${dateFormatter.format(end)}`;
}

function formatTimePart(start: Date, end: Date) {
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function formatLogRange(startInput: string | Date, endInput: string | Date) {
  const start = new Date(startInput);
  const end = new Date(endInput);
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function formatLogDate(input: string | Date) {
  const date = new Date(input);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
