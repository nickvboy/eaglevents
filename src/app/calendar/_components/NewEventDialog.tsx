"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { addDays, startOfDay } from "../utils/date";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";

const MIN_DURATION_MS = 30 * 60 * 1000;

type Segment = {
  id: string;
  start: Date;
  end: Date;
};

const randomId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function makeSegment(base: Date) {
  const start = new Date(base);
  const end = new Date(base.getTime() + MIN_DURATION_MS);
  return { id: randomId(), start, end };
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  defaultDate: Date;
  calendarId?: number;
  event?: RouterOutputs["event"]["list"][number] | null;
};

export function NewEventDialog({ open, onClose, defaultDate, calendarId, event }: Props) {
  const utils = api.useUtils();
  const create = api.event.create.useMutation();
  const update = api.event.update.useMutation();
  const isEditing = Boolean(event);

  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const [segments, setSegments] = useState<Segment[]>(() => [makeSegment(defaultDate)]);
  const [allDay, setAllDay] = useState(false);
  const [inPerson, setInPerson] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let mins = 0; mins < 24 * 60; mins += 30) {
      const hours = Math.floor(mins / 60);
      const minutes = mins % 60;
      const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      const label = new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      opts.push({ value, label });
    }
    return opts;
  }, []);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setAttendees("");
      setSegments([
        {
          id: randomId(),
          start: new Date(event.startDatetime),
          end: new Date(event.endDatetime),
        },
      ]);
      setAllDay(event.isAllDay);
      setInPerson(false);
      setLocation(event.location ?? "");
      setDescription(event.description ?? "");
      setRecurring(Boolean(event.recurrenceRule));
      setError(null);
      return;
    }
    setTitle("");
    setAttendees("");
    setSegments([makeSegment(defaultDate)]);
    setAllDay(false);
    setInPerson(false);
    setLocation("");
    setDescription("");
    setRecurring(false);
    setError(null);
  }, [open, defaultDate, event]);

  const updateSegment = (id: string, updater: (current: Segment) => Segment) => {
    setSegments((prev) => prev.map((segment) => (segment.id === id ? updater(segment) : segment)));
  };

  const handleDateChange = (id: string, value: string) => {
    if (!value) return;
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return;
    updateSegment(id, (segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      start.setFullYear(year, month - 1, day);
      end.setFullYear(year, month - 1, day);
      if (end <= start) {
        end.setTime(start.getTime() + MIN_DURATION_MS);
      }
      return { ...segment, start, end };
    });
  };

  const handleStartTimeChange = (id: string, value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    updateSegment(id, (segment) => {
      const start = new Date(segment.start);
      start.setHours(hours ?? 0, minutes ?? 0, 0, 0);
      let end = new Date(segment.end);
      if (end <= start) {
        end = new Date(start.getTime() + MIN_DURATION_MS);
      }
      return { ...segment, start, end };
    });
  };

  const handleEndTimeChange = (id: string, value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    updateSegment(id, (segment) => {
      const end = new Date(segment.end);
      end.setHours(hours ?? 0, minutes ?? 0, 0, 0);
      if (end <= segment.start) {
        end.setTime(segment.start.getTime() + MIN_DURATION_MS);
      }
      return { ...segment, end };
    });
  };

  const addSegmentRow = () => {
    setSegments((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return [makeSegment(defaultDate)];
      return [
        ...prev,
        {
          id: randomId(),
          start: addDays(last.start, 1),
          end: addDays(last.end, 1),
        },
      ];
    });
  };

  const removeSegment = (id: string) => {
    setSegments((prev) => (prev.length === 1 ? prev : prev.filter((segment) => segment.id !== id)));
  };

  const segmentsInvalid = segments.some((segment) => segment.start >= segment.end);
  const isSaving = isEditing ? update.isPending : create.isPending;
  const canSave = Boolean(title.trim()) && !segmentsInvalid && !isSaving;
  const dialogTitle = isEditing ? "Edit event" : "Create event";
  const primaryButtonLabel = isSaving ? "Saving..." : isEditing ? "Save changes" : "Save";

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleSave = async () => {
    setError(null);
    try {
      if (isEditing && event) {
        const segment = segments[0];
        if (!segment) {
          throw new Error("Unable to determine event time range.");
        }
        const dayStart = allDay ? startOfDay(segment.start) : segment.start;
        const dayEnd = allDay ? addDays(startOfDay(segment.start), 1) : segment.end;
        await update.mutateAsync({
          id: event.id,
          calendarId: calendarId ?? event.calendarId,
          title,
          description,
          location,
          isAllDay: allDay,
          startDatetime: dayStart,
          endDatetime: dayEnd,
          recurrenceRule: recurring ? event.recurrenceRule ?? "FREQ=DAILY" : null,
        });
      } else {
        for (const segment of segments) {
          const dayStart = allDay ? startOfDay(segment.start) : segment.start;
          const dayEnd = allDay ? addDays(startOfDay(segment.start), 1) : segment.end;
          await create.mutateAsync({
            calendarId,
            title,
            description,
            location,
            isAllDay: allDay,
            startDatetime: dayStart,
            endDatetime: dayEnd,
            recurrenceRule: recurring ? "FREQ=DAILY" : null,
          });
        }
      }
      await utils.event.invalidate();
      onClose();
    } catch (err) {
      console.error(err);
      const fallback = isEditing ? "Failed to update event" : "Failed to create event";
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onMouseDown={handleBackdropMouseDown}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-white/10 bg-neutral-950 p-6 text-white shadow-2xl shadow-black/60">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">{dialogTitle}</div>
          <button className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <input
            placeholder="Add a title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-white/20 bg-black/30 px-3 py-2 text-white outline-none placeholder:text-white/40"
          />

          <div>
            <div className="mb-1 text-xs text-white/60">Invite attendees</div>
            <input
              placeholder="Emails, comma separated"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              className="w-full rounded-md border border-white/20 bg-black/30 px-3 py-2 text-white outline-none placeholder:text-white/40"
            />
          </div>

          <div className="space-y-3">
            {segments.map((segment, index) => (
              <div key={segment.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-white/50">
                  <span>Day {index + 1}</span>
                  {!isEditing && segments.length > 1 && (
                    <button
                      type="button"
                      className="text-red-300 transition hover:text-red-200"
                      onClick={() => removeSegment(segment.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={formatDateInputValue(segment.start)}
                    onChange={(e) => handleDateChange(segment.id, e.target.value)}
                    className="rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  />
                  {allDay ? (
                    <span className="rounded-md border border-white/20 px-3 py-2 text-sm text-white/80">All day</span>
                  ) : (
                    <>
                      <select
                        className="rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        value={formatTimeValue(segment.start)}
                        onChange={(e) => handleStartTimeChange(segment.id, e.target.value)}
                      >
                        {timeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-white/50">to</span>
                      <select
                        className="rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        value={formatTimeValue(segment.end)}
                        onChange={(e) => handleEndTimeChange(segment.id, e.target.value)}
                      >
                        {timeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!isEditing && (
              <button
                type="button"
                onClick={addSegmentRow}
                className="text-sm font-medium text-emerald-400 transition hover:text-emerald-300"
              >
                + Add another day
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 border-y border-white/5 py-3">
            <label className="ml-2 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-emerald-500" />
              All day
            </label>
            <label className="ml-2 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} className="accent-emerald-500" />
              In-person event
            </label>
            <label className="ml-2 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-emerald-500" />
              Make recurring
            </label>
          </div>

          <div>
            <div className="mb-1 text-xs text-white/60">Add a room or location</div>
            <input
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-white/20 bg-black/30 px-3 py-2 text-white outline-none placeholder:text-white/40"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-white/60">Description</div>
            <textarea
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-md border border-white/20 bg-black/30 p-3 text-white outline-none placeholder:text-white/40"
              placeholder="Notes"
            />
          </div>

          {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

          <div className="mt-2 flex items-center gap-2">
            <button
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
              disabled={!canSave}
              onClick={handleSave}
            >
              {primaryButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
