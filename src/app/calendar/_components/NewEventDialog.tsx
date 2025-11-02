"use client";

import { useEffect, useState } from "react";
import { DateTimePicker } from "./DateTimePicker";
import { api } from "~/trpc/react";

type Props = {
  open: boolean;
  onClose: () => void;
  defaultDate: Date;
  calendarId?: number;
};

export function NewEventDialog({ open, onClose, defaultDate, calendarId }: Props) {
  const utils = api.useUtils();
  const create = api.event.create.useMutation({
    onSuccess: async () => {
      await utils.event.invalidate();
      onClose();
    },
  });

  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const [start, setStart] = useState(new Date(defaultDate));
  const [end, setEnd] = useState(new Date(defaultDate.getTime() + 30 * 60000));
  const [allDay, setAllDay] = useState(false);
  const [inPerson, setInPerson] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [recurring, setRecurring] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setAttendees("");
      setStart(new Date(defaultDate));
      setEnd(new Date(defaultDate.getTime() + 30 * 60000));
      setAllDay(false);
      setInPerson(false);
      setLocation("");
      setDescription("");
      setRecurring(false);
    }
  }, [open, defaultDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/50">
      <div className="h-full w-[520px] overflow-auto border-l border-white/10 bg-neutral-950 p-4 text-white">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-lg font-semibold">Create event</div>
          <button className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-3">
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

          <div className="flex flex-wrap items-center gap-2">
            <DateTimePicker label="Start" value={start} onChange={(d) => { setStart(d); if (d > end) setEnd(new Date(d.getTime() + 30*60000)); }} />
            <DateTimePicker label="End" value={end} onChange={(d) => setEnd(d)} />
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

          <div className="mt-2 flex items-center gap-2">
            <button
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
              disabled={!title || start >= end}
              onClick={() =>
                create.mutate({
                  calendarId,
                  title,
                  description,
                  location,
                  isAllDay: allDay,
                  startDatetime: start,
                  endDatetime: end,
                  recurrenceRule: recurring ? "FREQ=DAILY" : null,
                })
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

