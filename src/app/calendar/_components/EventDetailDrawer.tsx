"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ChevronDownIcon, ChevronLeftIcon, EditIcon, XIcon } from "~/app/_components/icons";

type CalendarInfo = { name: string; color: string } | null;

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

function resolvePersonDisplay(profile: { firstName?: string | null; lastName?: string | null; email?: string | null }) {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (name.length > 0) return name;
  const email = profile.email?.trim();
  return email && email.length > 0 ? email : null;
}

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!event) {
      setHourLogs([]);
      setHourLogError(null);
      setShowDeleteConfirm(false);
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
  }, [event]);

  const logBaseDate = useMemo(() => {
    const base = event ? new Date(event.startDatetime) : new Date();
    base.setHours(0, 0, 0, 0);
    return base;
  }, [event]);

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
  const hourLogsIncomplete = hourLogs.some((log) => Boolean(log.start) !== Boolean(log.end));
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
    if (!event) return;
    if (!canSaveHourLogs) {
      setHourLogError("Please complete or remove invalid hour log entries.");
      return;
    }
    try {
      const payloadHourLogs = hourLogs
        .filter((log) => log.start && log.end)
        .map((log) => ({
          id: log.sourceId ?? undefined,
          startTime: log.start!,
          endTime: log.end!,
        }));
      await updateHourLogsMutation.mutateAsync({
        id: event.id,
        calendarId: event.calendarId,
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        isAllDay: event.isAllDay,
        startDatetime: new Date(event.startDatetime),
        endDatetime: new Date(event.endDatetime),
        recurrenceRule: event.recurrenceRule ?? undefined,
        assigneeProfileId: event.assigneeProfileId ?? null,
        attendeeProfileIds: event.attendees
          .map((attendee) => attendee.profileId)
          .filter((profileId): profileId is number => profileId !== null),
        hourLogs: payloadHourLogs,
        participantCount: event.participantCount ?? null,
        technicianNeeded: event.technicianNeeded ?? false,
        requestCategory: event.requestCategory ?? null,
        equipmentNeeded: event.equipmentNeeded ?? null,
        requestDetails: event.requestDetails ?? null,
        eventStartTime: event.eventStartTime ? new Date(event.eventStartTime) : null,
        eventEndTime: event.eventEndTime ? new Date(event.eventEndTime) : null,
        setupTime: event.setupTime ? new Date(event.setupTime) : null,
        zendeskTicketNumber: event.zendeskTicketNumber ?? null,
      });
    } catch (err) {
      setHourLogError(err instanceof Error ? err.message : "Failed to save hour logs.");
    }
  };

  const handleDelete = () => {
    if (deleteMutation.isPending) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!event || deleteMutation.isPending) return;
    await deleteMutation.mutateAsync({ id: event.id });
  };

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("[data-scroll-lock='allow']")) return;
      event.preventDefault();
    };
    const options: AddEventListenerOptions = { passive: false, capture: true };
    window.addEventListener("wheel", handler, options);
    window.addEventListener("touchmove", handler, options);
    return () => {
      window.removeEventListener("wheel", handler, options);
      window.removeEventListener("touchmove", handler, options);
    };
  }, [open]);



  if (!open || !event) return null;

  const start = new Date(event.startDatetime);
  const end = new Date(event.endDatetime);
  const dateLabel = formatDatePart(start, end);
  const timeLabel = formatTimePart(start, end);
  const assigneeName = event.assigneeProfile ? resolvePersonDisplay(event.assigneeProfile) : null;
  const eventCode = event.eventCode ?? String(event.id).padStart(7, "0");

  return (
    <div className="fixed inset-x-0 top-0 bottom-16 z-50 flex flex-col bg-surface-raised text-ink-primary md:bottom-0 md:left-16 md:z-[10010]">
      {showDeleteConfirm ? (
        <div className="fixed inset-0 z-[10021] flex items-center justify-center bg-[var(--color-overlay-backdrop)]/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-status-danger bg-surface-raised p-5 text-sm shadow-2xl shadow-[var(--shadow-pane)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-status-danger">Confirm delete</div>
            <div className="mt-2 text-ink-primary">Delete this event? This cannot be undone.</div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-outline-muted px-3 py-1.5 text-sm text-ink-primary hover:bg-surface-muted"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-status-danger px-3 py-1.5 text-sm font-semibold text-ink-inverted transition hover:bg-status-danger-strong disabled:opacity-60"
                onClick={() => void confirmDelete()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
      <main data-scroll-lock="allow" className="flex-1 overflow-y-auto px-5 pb-16 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <section className="space-y-2">
            <h1 className="text-2xl font-semibold">{event.title}</h1>
            <div className="text-sm text-ink-subtle">
              <div>{dateLabel}</div>
              <div>{timeLabel}</div>
              {event.location && <div className="mt-1 text-ink-muted">{event.location}</div>}
              <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-faint">Event ID #{eventCode}</div>
              {calendar && (
                <div className="mt-2 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-ink-subtle">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: calendar.color }} />
                  {calendar.name}
                </div>
              )}
              {event.scopeType && event.scopeId ? (
                <div className="mt-2 text-xs text-ink-subtle">
                  Scope: {event.scopeType.replace("_", " ")} #{event.scopeId}
                </div>
              ) : null}
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
              {event.coOwners && event.coOwners.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-ink-subtle">Co-owners</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {event.coOwners.map((owner) => (
                      <span
                        key={owner.profileId}
                        className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-muted px-3 py-1 text-xs text-ink-primary"
                      >
                        <span className="font-medium">
                          {(() => {
                            const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
                            return ownerName.length > 0 ? ownerName : owner.email ?? "";
                          })()}
                        </span>
                        <span className="text-ink-muted">{owner.email}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
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
                      const incomplete = Boolean(log.start) !== Boolean(log.end);
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
                                  allowEmpty
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
                                  allowEmpty
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
                onClick={handleDelete}
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
  allowEmpty?: boolean;
};

function TimeSelect({ value, onChange, placeholder, options, invalid, allowEmpty = false }: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editMeridiem, setEditMeridiem] = useState<"AM" | "PM">("AM");
  const [editError, setEditError] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editPopoverRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const defaultOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (editPopoverRef.current?.contains(e.target as Node)) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditOpen(false);
        setEditError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!editOpen) return;
    const width = 16 * 16; // matches w-64
    const gap = 8;
    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let left = rect.left;
      const maxLeft = window.innerWidth - width - gap;
      if (left > maxLeft) left = maxLeft;
      if (left < gap) left = gap;
      const top = Math.min(window.innerHeight - 220, rect.bottom + gap);
      setEditPosition({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [editOpen]);

  const optionLabel = value ? options.find((opt) => opt.value === value)?.label ?? null : null;
  const label = value ? optionLabel ?? formatTimeLabel(value) : placeholder;
  const hasCustomValue = Boolean(value && !optionLabel);
  const customOptionLabel = value ? `${formatTimeLabel(value)} (custom)` : null;
  activeOptionRef.current = null;

  return (
    <div className="relative min-w-[9rem]" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={
          "flex w-full items-center justify-between gap-2 rounded-md border border-outline-muted bg-surface-muted px-3 py-1.5 text-sm text-ink-primary transition hover:border-outline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong " +
          (invalid ? "border-status-danger text-status-danger" : "")
        }
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const parts = formatTimeInputParts(value);
          setEditValue(parts.time);
          setEditMeridiem(parts.meridiem);
          setEditError(null);
          setEditOpen(true);
          setOpen(false);
        }}
      >
        <span className={value ? "text-ink-primary" : "text-ink-muted"}>{label}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-60 overflow-y-auto rounded-lg border border-outline-muted bg-surface-overlay shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur scrollbar-hidden">
          {hasCustomValue && customOptionLabel && (
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-ink-primary"
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
            >
              <span>{customOptionLabel}</span>
            </button>
          )}
          {options.map((option) => {
            const active = option.value === value;
            const shouldDefault = !value && option.value === DEFAULT_TIME_VALUE;
            return (
              <button
                key={option.value}
                type="button"
                className={
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition " +
                  (active ? "text-ink-primary" : "text-ink-subtle hover:bg-surface-muted")
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
              </button>
            );
          })}
        </div>
      )}
      {editOpen && editPosition &&
        createPortal(
        <div
          ref={editPopoverRef}
          className="fixed z-[10000] w-64 rounded-lg border border-outline-muted bg-surface-overlay p-3 text-sm shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur"
          style={{ top: editPosition.top, left: editPosition.left }}
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Edit time</div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="8:15"
              value={editValue}
              onChange={(event) => {
                setEditValue(formatTimeInputDraft(event.target.value));
                if (editError) setEditError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const normalized = normalizeTimeInputParts(editValue, editMeridiem);
                  if (!normalized) {
                    if (!allowEmpty || editValue.trim().length > 0) {
                      setEditError("Enter time as h:mm.");
                    } else {
                      onChange("");
                      setEditOpen(false);
                    }
                    return;
                  }
                  onChange(normalized);
                  setEditOpen(false);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditOpen(false);
                  setEditError(null);
                }
              }}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
            <select
              value={editMeridiem}
              onChange={(event) => setEditMeridiem(event.target.value as "AM" | "PM")}
              className="rounded-md border border-outline-muted bg-surface-muted px-2 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <div className="mt-1 text-xs text-ink-muted">Enter time as h:mm.</div>
          {editError && <div className="mt-1 text-xs text-status-danger">{editError}</div>}
          <div className="mt-3 flex items-center justify-end gap-2 text-xs">
            {allowEmpty && (
              <button
                type="button"
                className="text-ink-muted transition hover:text-ink-primary"
                onClick={() => {
                  onChange("");
                  setEditOpen(false);
                  setEditError(null);
                }}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="rounded-md bg-accent-soft px-3 py-1 font-semibold text-surface-primary transition hover:bg-accent-strong"
              onClick={() => {
                const normalized = normalizeTimeInputParts(editValue, editMeridiem);
                if (!normalized) {
                  if (!allowEmpty || editValue.trim().length > 0) {
                    setEditError("Enter time as h:mm.");
                  } else {
                    onChange("");
                    setEditOpen(false);
                  }
                  return;
                }
                onChange(normalized);
                setEditOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
        , document.body)}
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
  return sameDay ? dateFormatter.format(start) : `${dateFormatter.format(start)} - ${dateFormatter.format(end)}`;
}

function formatTimePart(start: Date, end: Date) {
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function formatTimeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
  const meridiemMatch = /\s*(am|pm|a|p)$/.exec(numericPart);
  if (meridiemMatch) {
    const token = meridiemMatch[1];
    if (!token) return null;
    meridiem = token.startsWith("p") ? "pm" : "am";
    numericPart = numericPart.slice(0, numericPart.length - meridiemMatch[0].length).trim();
  }
  if (!numericPart) return null;
  let hours: number | null = null;
  let minutes: number | null = null;
  if (numericPart.includes(":")) {
    const [h, m = "0"] = numericPart.split(":");
    if (!h || !/^\d+$/.test(h) || !/^\d+$/.test(m)) return null;
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

function formatTimeInputParts(value: string): { time: string; meridiem: "AM" | "PM" } {
  if (!value) return { time: "", meridiem: "AM" };
  const parts = value.split(":");
  if (parts.length < 2) return { time: "", meridiem: "AM" };
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return { time: "", meridiem: "AM" };
  const meridiem = hours >= 12 ? "PM" : "AM";
  const hours12 = ((hours + 11) % 12) + 1;
  return { time: `${hours12}:${String(minutes).padStart(2, "0")}`, meridiem };
}

function normalizeTimeInputParts(value: string, meridiem: "AM" | "PM") {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 1 || hours > 12) return null;
  if (minutes < 0 || minutes > 59) return null;
  let normalizedHours = hours % 12;
  if (meridiem === "PM") normalizedHours += 12;
  return `${String(normalizedHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTimeInputDraft(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits[0]}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
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
  const name = resolvePersonDisplay(profile);
  if (name) return name;
  return "Unknown";
}
