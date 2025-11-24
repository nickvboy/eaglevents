"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ChevronDownIcon, ChevronLeftIcon, EditIcon, XIcon } from "~/app/_components/icons";

type CalendarInfo = { name: string; swatchClass: string } | null;

type EventDetailDrawerProps = {
  event: RouterOutputs["event"]["list"][number] | null;
  calendar: CalendarInfo;
  open: boolean;
  onClose: () => void;
  onEdit: (eventId: number) => void;
};

type HourLogDraft = {
  id: string;
  sourceId: number | null;
  start: Date | null;
  end: Date | null;
  loggedByProfile?: {
    id: number | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
};

const DEFAULT_TIME_VALUE = "06:30";

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

export function EventDetailDrawer({ event, calendar, open, onClose, onEdit }: EventDetailDrawerProps) {
  const utils = api.useUtils();
  const deleteMutation = api.event.delete.useMutation({
    onSuccess: async () => {
      await utils.event.invalidate();
      onClose();
    },
  });
  const updateHourLogsMutation = api.event.update.useMutation({
    onSuccess: async () => {
      await utils.event.invalidate();
    },
  });

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
  const [hourLogs, setHourLogs] = useState<HourLogDraft[]>([]);
  const [hourLogError, setHourLogError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) {
      setHourLogs([]);
      setHourLogError(null);
      return;
    }
    const nextLogs =
      event.hourLogs?.map((log) => ({
        id: `existing-${log.id}`,
        sourceId: log.id,
        start: new Date(log.startTime),
        end: new Date(log.endTime),
        loggedByProfile: log.loggedByProfile ?? null,
      })) ?? [];
    setHourLogs(nextLogs);
    setHourLogError(null);
  }, [event?.id, event?.hourLogs]);

  const logBaseDate = useMemo(() => {
    const base = event ? new Date(event.startDatetime) : new Date();
    base.setHours(0, 0, 0, 0);
    return base;
  }, [event?.startDatetime]);

  const addHourLogRow = () => {
    setHourLogs((prev) => [...prev, { id: randomId(), sourceId: null, start: null, end: null }]);
  };
  const handleHourLogChange = (id: string, field: "start" | "end", value: string) => {
    setHourLogs((prev) =>
      prev.map((log) => (log.id === id ? { ...log, [field]: parseHourLogTime(value, logBaseDate) } : log)),
    );
  };
  const removeHourLogRow = (id: string) => {
    setHourLogs((prev) => prev.filter((log) => log.id !== id));
  };

  const hourLogsInvalid = hourLogs.some((log) => log.start && log.end && log.end <= log.start);
  const hourLogsIncomplete = hourLogs.some((log) => (log.start && !log.end) || (!log.start && log.end));
  const combinedLoggedHours = hourLogs.reduce((sum, log) => sum + diffHours(log.start, log.end), 0);
  const hourLogsValidationMessage =
    hourLogError ??
    (hourLogsInvalid
      ? "End time must be after start time."
      : hourLogsIncomplete
        ? "Provide both a start and end time."
        : null);
  const canSaveHourLogs = !hourLogsInvalid && !hourLogsIncomplete && !updateHourLogsMutation.isPending;

  const handleSaveHourLogs = async () => {
    setHourLogError(null);
    if (!canSaveHourLogs) {
      setHourLogError("Please complete or remove invalid hour log entries.");
      return;
    }
    try {
      const payloadHourLogs = hourLogs
        .filter((log) => log.start && log.end)
        .map((log) => ({
          id: log.sourceId ?? undefined,
          startTime: log.start as Date,
          endTime: log.end as Date,
        }));
      await updateHourLogsMutation.mutateAsync({
        id: event!.id,
        calendarId: event!.calendarId,
        title: event!.title,
        description: event!.description ?? undefined,
        location: event!.location ?? undefined,
        isAllDay: event!.isAllDay,
        startDatetime: new Date(event!.startDatetime),
        endDatetime: new Date(event!.endDatetime),
        recurrenceRule: event!.recurrenceRule ?? undefined,
        assigneeProfileId: event!.assigneeProfileId ?? null,
        hourLogs: payloadHourLogs,
        participantCount: event!.participantCount ?? null,
        technicianNeeded: event!.technicianNeeded ?? false,
        requestCategory: event!.requestCategory ?? null,
        equipmentNeeded: event!.equipmentNeeded ?? null,
        eventStartTime: event!.eventStartTime ? new Date(event!.eventStartTime) : null,
        eventEndTime: event!.eventEndTime ? new Date(event!.eventEndTime) : null,
        setupTime: event!.setupTime ? new Date(event!.setupTime) : null,
        zendeskTicketNumber: event!.zendeskTicketNumber ?? null,
      });
    } catch (err) {
      setHourLogError(err instanceof Error ? err.message : "Failed to save hour logs.");
    }
  };

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

          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Hour logging</div>
            <div className="rounded-xl border border-outline-muted bg-surface-muted/60 p-4 text-sm text-ink-primary">
              {hourLogs.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-ink-muted">No intervals have been added.</span>
                  <button
                    type="button"
                    onClick={addHourLogRow}
                    className="inline-flex items-center gap-2 rounded-lg border border-outline-accent px-3 py-1.5 text-sm font-semibold text-accent-soft transition hover:bg-accent-muted"
                  >
                    <span className="text-base leading-none">+</span>
                    Add interval
                  </button>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-outline-muted">
                    {hourLogs.map((log, index) => {
                      const hours = diffHours(log.start, log.end);
                      const invalid = Boolean(log.start && log.end && log.end <= log.start);
                      const incomplete = (log.start && !log.end) || (!log.start && log.end);
                      const pillClass = invalid
                        ? "border border-status-danger bg-status-danger-surface text-status-danger"
                        : hours > 0
                          ? "border border-outline-accent bg-accent-muted text-accent-soft"
                          : "border border-outline-muted bg-surface-muted text-ink-subtle";
                      const pillText = hours > 0 ? `${hours.toFixed(2)}h` : invalid ? "Invalid" : "-";
                      return (
                        <div key={log.id} className="flex flex-wrap items-start gap-3 py-3 transition hover:bg-surface-muted">
                          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                            #{index + 1}
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1">
                                <TimeSelect
                                  value={formatHourLogTime(log.start)}
                                  onChange={(value) => handleHourLogChange(log.id, "start", value)}
                                  placeholder="Start"
                                  options={timeOptions}
                                  invalid={invalid}
                                />
                                <ManualTimeEntryButton
                                  value={formatHourLogTime(log.start)}
                                  onChange={(value) => handleHourLogChange(log.id, "start", value)}
                                  allowEmpty
                                  label="Manual start time"
                                />
                              </div>
                              <span className="text-xs text-ink-subtle">to</span>
                              <div className="flex items-center gap-1">
                                <TimeSelect
                                  value={formatHourLogTime(log.end)}
                                  onChange={(value) => handleHourLogChange(log.id, "end", value)}
                                  placeholder="End"
                                  options={timeOptions}
                                  invalid={invalid}
                                />
                                <ManualTimeEntryButton
                                  value={formatHourLogTime(log.end)}
                                  onChange={(value) => handleHourLogChange(log.id, "end", value)}
                                  allowEmpty
                                  label="Manual end time"
                                />
                              </div>
                              <span
                                className={"inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " + pillClass}
                              >
                                {pillText}
                              </span>
                            </div>
                            {(invalid || incomplete) && (
                              <div className="text-xs text-status-danger">
                                {invalid ? "End time must be after start time." : "Provide both a start and end time."}
                              </div>
                            )}
                            <div className="text-xs text-ink-muted">
                              Logged by{" "}
                              {log.sourceId
                                ? formatLoggedByProfile(log.loggedByProfile ?? null)
                                : "You (pending)"}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="mt-1 rounded-full p-1 text-ink-faint transition hover:bg-surface-muted hover:text-ink-primary"
                            onClick={() => removeHourLogRow(log.id)}
                            aria-label="Remove interval"
                          >
                            <XIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
                    <div>
                      Total logged:{" "}
                      <span className="font-semibold text-ink-primary">{combinedLoggedHours.toFixed(2)} hours</span>
                    </div>
                    <button
                      type="button"
                      onClick={addHourLogRow}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-ink-subtle transition hover:text-ink-primary"
                    >
                      <span className="text-base leading-none">+</span>
                      Add interval
                    </button>
                  </div>
                </>
              )}
              {hourLogsValidationMessage && (
                <div className="mt-3 text-xs text-status-danger">{hourLogsValidationMessage}</div>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  className="rounded-md bg-accent-strong px-3 py-1.5 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleSaveHourLogs}
                  disabled={!canSaveHourLogs}
                >
                  {updateHourLogsMutation.isPending ? "Saving..." : "Save logs"}
                </button>
              </div>
            </div>
          </section>

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

type TimeSelectProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  invalid?: boolean;
};

function TimeSelect({ value, onChange, placeholder, options, invalid }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const defaultOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const target = activeOptionRef.current ?? defaultOptionRef.current;
    if (target) target.scrollIntoView({ block: "start" });
  }, [open]);

  const label = value ? options.find((opt) => opt.value === value)?.label ?? value : placeholder;
  activeOptionRef.current = null;

  return (
    <div className="relative min-w-[9rem]" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={
          "flex w-full items-center justify-between gap-2 rounded-md border border-outline-muted bg-surface-muted px-3 py-1.5 text-sm text-ink-primary transition hover:border-outline-strong " +
          (invalid ? "border-status-danger text-status-danger" : "")
        }
      >
        <span className={value ? "text-ink-primary" : "text-ink-muted"}>{label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-60 overflow-y-auto rounded-lg border border-outline-muted bg-surface-overlay shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur">
          {options.map((option) => {
            const active = option.value === value;
            const shouldDefault = !value && option.value === DEFAULT_TIME_VALUE;
            return (
              <button
                key={option.value}
                type="button"
                className={
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition " +
                  (active ? "bg-surface-muted text-ink-primary" : "text-ink-subtle hover:bg-surface-muted")
                }
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                ref={(el) => {
                  if (active) activeOptionRef.current = el;
                  else if (shouldDefault) defaultOptionRef.current = el;
                }}
              >
                <span>{option.label}</span>
                {active && <span className="text-xs text-ink-muted">Selected</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ManualTimeEntryButtonProps = {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  label?: string;
};

function ManualTimeEntryButton({ value, onChange, allowEmpty = false, label = "Manual time" }: ManualTimeEntryButtonProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!panelRef.current || panelRef.current.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = () => {
    const normalized = normalizeTimeInput(inputValue);
    if (!normalized && !allowEmpty) {
      setError('Enter a time like "3:30p".');
      return;
    }
    if (normalized === null) {
      if (allowEmpty) onChange("");
      close();
      return;
    }
    onChange(normalized);
    close();
  };

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-outline-muted text-ink-muted transition hover:border-outline-strong hover:text-ink-primary"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={label}
      >
        <EditIcon className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (panelRef.current && !panelRef.current.contains(e.target as Node)) close();
            }}
          >
            <div
              className="mt-20 w-full max-w-sm rounded-xl border border-outline-muted bg-surface-overlay p-4 text-sm text-ink-primary shadow-2xl shadow-[var(--shadow-pane)]"
              onMouseDown={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</div>
              <input
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                className="mt-2 w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                placeholder="e.g., 1:30pm"
                autoFocus
              />
              <div className="mt-1 text-xs text-ink-muted">Enter time like 1:15pm or 1330.</div>
              {error && <div className="mt-1 text-xs text-status-danger">{error}</div>}
              <div className="mt-3 flex items-center justify-end gap-2 text-xs">
                {allowEmpty && (
                  <button
                    type="button"
                    className="text-ink-muted transition hover:text-ink-primary"
                    onClick={() => {
                      onChange("");
                      close();
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md bg-accent-soft px-3 py-1 font-semibold text-surface-primary transition hover:bg-accent-strong"
                  onClick={commit}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
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
  return sameDay ? dateFormatter.format(start) : `${dateFormatter.format(start)} - ${dateFormatter.format(end)}`;
}

function formatTimePart(start: Date, end: Date) {
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function formatHourLogTime(date: Date | null) {
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function normalizeTimeInput(value: string) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  let numericPart = trimmed.replace(/\./g, ":");
  let meridiem: "am" | "pm" | null = null;
  const meridiemMatch = numericPart.match(/\s*(am|pm|a|p)$/);
  if (meridiemMatch) {
    const token = meridiemMatch[1];
    meridiem = token.startsWith("p") ? "pm" : "am";
    numericPart = numericPart.slice(0, numericPart.length - meridiemMatch[0]!.length).trim();
  }
  if (!numericPart) return null;
  let hours: number | null = null;
  let minutes: number | null = null;
  if (numericPart.includes(":")) {
    const [h, m = "0"] = numericPart.split(":");
    if (!/^\d+$/.test(h) || !/^\d+$/.test(m)) return null;
    hours = Number(h);
    minutes = Number(m);
  } else if (/^\d{3,4}$/.test(numericPart)) {
    const str = numericPart;
    hours = Number(str.slice(0, str.length - 2));
    minutes = Number(str.slice(-2));
  } else if (/^\d{1,2}$/.test(numericPart)) {
    hours = Number(numericPart);
    minutes = 0;
  } else {
    return null;
  }
  if (hours === null || minutes === null) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (meridiem) {
    if (hours > 12) return null;
    if (hours === 12) {
      hours = meridiem === "am" ? 0 : 12;
    } else if (meridiem === "pm") {
      hours += 12;
    }
  }
  if (hours < 0 || hours > 23) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseHourLogTime(value: string, baseDate: Date) {
  if (!value) return null;
  const normalized = normalizeTimeInput(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const next = new Date(baseDate);
  next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return next;
}

function diffHours(start: Date | null, end: Date | null) {
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
}

function formatLoggedByProfile(
  profile: { firstName?: string | null; lastName?: string | null; email?: string | null } | null,
) {
  if (!profile) return "Unknown";
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return name || profile.email || "Unknown";
}
