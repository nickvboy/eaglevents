"use client";

import { useEffect, type ReactNode } from "react";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ChevronLeftIcon, EditIcon } from "~/app/_components/icons";

type CalendarInfo = { name: string; color: string } | null;

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <header className="flex items-center gap-3 border-b border-white/10 bg-black/80 px-4 py-3">
        <button
          type="button"
          aria-label="Close details"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 hover:bg-white/10"
          onClick={onClose}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </button>
        <div className="text-sm uppercase tracking-wide text-white/60">Meeting details</div>
      </header>
      <main className="flex-1 overflow-y-auto px-5 pb-16 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <section className="space-y-2">
            <h1 className="text-2xl font-semibold">{event.title}</h1>
            <div className="text-sm text-white/70">
              <div>{dateLabel}</div>
              <div>{timeLabel}</div>
              {event.location && <div className="mt-1 text-white/60">{event.location}</div>}
              {calendar && (
                <div className="mt-2 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-white/50">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: calendar.color }}
                  />
                  {calendar.name}
                </div>
              )}
            </div>
          </section>

          {event.description && (
            <section className="space-y-2">
              <SectionHeading>Details</SectionHeading>
              <p className="rounded-xl border border-white/10 bg-black/50 p-4 text-sm text-white/80 whitespace-pre-line">
                {event.description}
              </p>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionHeading>Participants</SectionHeading>
              <button className="text-xs font-medium text-emerald-300 hover:text-emerald-200">See more</button>
            </div>
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/80">
              <div className="flex items-center justify-between">
                <span className="font-medium">Organizer</span>
                <span className="text-xs text-white/50">{calendar?.name ?? "Calendar"}</span>
              </div>
              <div className="text-xs text-white/50">
                Event created {start.toLocaleString()}
              </div>
              {event.assigneeProfile && (
                <div className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80">
                  <div className="text-xs uppercase tracking-wide text-white/50">Assigned to</div>
                  <div className="font-medium">{assigneeName}</div>
                  <div className="text-xs text-white/60">{event.assigneeProfile.email}</div>
                </div>
              )}
              <div className="mt-3 text-xs text-white/60">
                Attendee details are not available for this event.
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <SectionHeading>Actions</SectionHeading>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                onClick={() => onEdit(event.id)}
              >
                <span className="inline-flex items-center gap-2">
                  <EditIcon className="h-4 w-4" />
                  Edit
                </span>
              </button>
              <button
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:border-red-500/60 disabled:text-red-400/60"
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
  return <div className="text-xs font-semibold uppercase tracking-wide text-white/50">{children}</div>;
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
    <div className="rounded-xl border border-white/10 bg-black/50 p-4">
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className={"mt-1 text-sm text-white/90 " + (multiline ? "whitespace-pre-line" : "")}>{value}</div>
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
    : `${dateFormatter.format(start)} â€“ ${dateFormatter.format(end)}`;
}

function formatTimePart(start: Date, end: Date) {
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${timeFormatter.format(start)} â€” ${timeFormatter.format(end)}`;
}



