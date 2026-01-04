"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { addDays, startOfDay } from "../utils/date";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import { ChevronDownIcon, EditIcon, XIcon } from "~/app/_components/icons";

const MIN_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_TIME_VALUE = "06:30";

type Segment = {
  id: string;
  start: Date;
  end: Date;
};

type HourLogDraft = {
  id: string;
  start: Date | null;
  end: Date | null;
  sourceId?: number | null;
};

const randomId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const REQUEST_CATEGORY_OPTIONS = [
  {
    value: "university_affiliated_request_to_university_business",
    label: "University affiliated request to university business",
  },
  {
    value: "university_affiliated_nonrequest_to_university_business",
    label: "University affiliated non-request to university business",
  },
  {
    value: "fgcu_student_affiliated_event",
    label: "FGCU student-affiliated activity/event",
  },
  {
    value: "non_affiliated_or_revenue_generating_event",
    label: "Non-affiliated or revenue generating event",
  },
] as const;

type RequestCategoryValue = (typeof REQUEST_CATEGORY_OPTIONS)[number]["value"];
type InfoField = "eventStart" | "eventEnd" | "setup";
type LocationMatch = RouterOutputs["facility"]["searchRooms"][number];

function makeSegment(base: Date) {
  const start = new Date(base);
  if (start.getHours() === 0 && start.getMinutes() === 0) {
    start.setHours(6, 30, 0, 0);
  }
  const end = new Date(base.getTime() + MIN_DURATION_MS);
  if (end <= start) {
    end.setTime(start.getTime() + MIN_DURATION_MS);
  }
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

function formatHourLogTime(date: Date | null) {
  if (!date) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatTimeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function parseLocationInput(raw: string) {
  const value = (raw ?? "").trim();
  if (!value) return { acronym: null, room: null };
  const upper = value.toUpperCase();
  const compact = upper.replace(/\s+|-/g, "");
  let acronym: string | null = null;
  let room: string | null = null;
  const m1 = /^([A-Z]{1,16})([0-9][A-Z0-9]*)$/.exec(compact);
  if (m1) {
    acronym = m1[1] ?? null;
    room = m1[2] ?? null;
  } else {
    const m2 = /^\s*([A-Z]{1,16})\s*[- ]?\s*([0-9][A-Z0-9]*)\s*$/.exec(upper);
    if (m2) {
      acronym = m2[1] ?? null;
      room = m2[2] ?? null;
    } else {
      const onlyAcr = /^\s*([A-Z]{1,16})\s*$/.exec(upper);
      const onlyRoom = /^\s*([0-9][A-Z0-9]*)\s*$/.exec(upper);
      if (onlyAcr) acronym = onlyAcr[1] ?? null;
      if (onlyRoom) room = onlyRoom[1] ?? null;
    }
  }
  return { acronym, room };
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
                ref={active ? activeOptionRef : shouldDefault ? defaultOptionRef : null}
                className={
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition " +
                  (active ? "bg-accent-muted text-ink-primary" : "text-ink-subtle hover:bg-surface-muted")
                }
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {active && <span className="text-xs text-status-success">Selected</span>}
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const width = 14 * 16; // matches w-56
    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const gap = 8;
      let left = rect.right - width;
      const maxLeft = window.innerWidth - width - gap;
      if (left > maxLeft) left = maxLeft;
      if (left < gap) left = gap;
      const top = Math.min(window.innerHeight - 200, rect.bottom + gap);
      setPosition({ top, left });
    };
    updatePosition();
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setInputValue(value);
      setError(null);
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      setInputValue(value);
    }
  }, [value, open]);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const commit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      if (allowEmpty) {
        onChange("");
        close();
      } else {
        setError("Enter a time.");
      }
      return;
    }
    const normalized = normalizeTimeInput(trimmed);
    if (!normalized) {
      setError("Enter a valid time, e.g., 7:30 PM.");
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
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md border border-outline-muted bg-surface-muted p-2 text-ink-subtle transition hover:text-ink-primary"
        aria-label="Type a custom time"
      >
        <EditIcon className="h-3.5 w-3.5" />
      </button>
      {open && position && (
        createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[999] w-56 rounded-lg border border-outline-muted bg-surface-overlay p-3 text-sm shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur"
          style={{ top: position.top, left: position.left }}
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</div>
          <input
            ref={inputRef}
            type="text"
            placeholder="e.g. 7:30pm or 1330"
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
          <div className="mt-1 text-xs text-ink-muted">Press Enter to apply.</div>
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
        , document.body)
      )}
    </>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  defaultDate: Date;
  calendarId?: number;
  visibleCalendarIds?: number[];
  calendars?: Array<{ id: number; name: string; color: string; isPersonal: boolean; canWrite: boolean }>;
  event?: RouterOutputs["event"]["list"][number] | null;
};

type AssigneeSelection = {
  profileId: number;
  displayName: string;
  email: string;
  username?: string | null;
};
type ProfileDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

const emptyProfileDraft: ProfileDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
};

function deriveProfileDraft(raw: string): ProfileDraft {
  const trimmed = raw.trim();
  const emailMatch = /[^\s,;]+@[^\s,;]+/.exec(trimmed);
  const email = emailMatch?.[0] ?? "";
  const withoutEmail = email ? trimmed.replace(email, "").trim() : trimmed;
  const phoneMatch = /\+?[\d\-\s().]{7,}/.exec(trimmed);
  const phoneNumber = phoneMatch?.[0]?.replace(/[^\d+]/g, "") ?? "";
  const parts = withoutEmail.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return {
    firstName,
    lastName,
    email,
    phoneNumber,
  };
}

function resolveProfileLabel(profile: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}) {
  const displayName = profile.displayName?.trim();
  if (displayName) return displayName;
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return profile.email;
}

function fallbackSearchLabel(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function NewEventDialog({ open, onClose, defaultDate, calendarId, visibleCalendarIds, calendars, event }: Props) {
  const utils = api.useUtils();
  const create = api.event.create.useMutation();
  const update = api.event.update.useMutation();
  const deleteMutation = api.event.delete.useMutation({
    onSuccess: async () => {
      await utils.event.invalidate();
      onClose();
    },
  });
  const isEditing = Boolean(event);

  const [title, setTitle] = useState("");
  const [selectedCalendarId, setSelectedCalendarId] = useState<number | null>(calendarId ?? null);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<number[]>([]);
  const [segments, setSegments] = useState<Segment[]>(() => [makeSegment(defaultDate)]);
  const [allDay, setAllDay] = useState(false);
  const [inPerson, setInPerson] = useState(false);
  const [location, setLocation] = useState("");
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(null);
  const [selectedBuildingAcronym, setSelectedBuildingAcronym] = useState<string>("");
  const [roomNumber, setRoomNumber] = useState<string>("");
  const [description, setDescription] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [participantCount, setParticipantCount] = useState("");
  const [technicianNeeded, setTechnicianNeeded] = useState(false);
  const [requestCategory, setRequestCategory] = useState<RequestCategoryValue | "">("");
  const [equipmentNeeded, setEquipmentNeeded] = useState("");
  const [zendeskTicket, setZendeskTicket] = useState("");
  const [eventInfoStart, setEventInfoStart] = useState<Date | null>(null);
  const [eventInfoEnd, setEventInfoEnd] = useState<Date | null>(null);
  const [setupInfoTime, setSetupInfoTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<AssigneeSelection | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [selectedAttendees, setSelectedAttendees] = useState<AssigneeSelection[]>([]);
  const [selectedCoOwners, setSelectedCoOwners] = useState<AssigneeSelection[]>([]);
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [attendeeQuery, setAttendeeQuery] = useState("");
  const [coOwnerSearch, setCoOwnerSearch] = useState("");
  const [coOwnerQuery, setCoOwnerQuery] = useState("");
  const [assigneeHighlight, setAssigneeHighlight] = useState(-1);
  const [attendeeHighlight, setAttendeeHighlight] = useState(-1);
  const [coOwnerHighlight, setCoOwnerHighlight] = useState(-1);
  const [quickCreateTarget, setQuickCreateTarget] = useState<"assignee" | "attendee" | "coOwner" | null>(null);
  const [quickCreateDraft, setQuickCreateDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [hourLogs, setHourLogs] = useState<HourLogDraft[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const logBaseDate = useMemo(() => startOfDay(event ? new Date(event.startDatetime) : defaultDate), [event, defaultDate]);
  const infoBaseDate = useMemo(() => (segments[0] ? new Date(segments[0].start) : new Date(defaultDate)), [segments, defaultDate]);
  const calendarOptions = useMemo(() => {
    return (calendars ?? [])
      .filter((c) => c.canWrite)
      .sort((a, b) => {
        if (a.isPersonal === b.isPersonal) return a.name.localeCompare(b.name);
        return a.isPersonal ? 1 : -1;
      });
  }, [calendars]);
  useEffect(() => {
    if (selectedCalendarIds.length === 0) {
      if (selectedCalendarId !== null) setSelectedCalendarId(null);
      return;
    }
    if (!selectedCalendarIds.includes(selectedCalendarId ?? -1)) {
      setSelectedCalendarId(selectedCalendarIds[0] ?? null);
    }
  }, [selectedCalendarIds, selectedCalendarId]);

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
  const timeOptionValues = useMemo(() => new Set(timeOptions.map((option) => option.value)), [timeOptions]);

  useEffect(() => {
    if (!open) return;
    setShowDeleteConfirm(false);
    if (event) {
      setTitle(event.title);
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
      setSelectedBuildingId(event.buildingId ?? null);
      const parsed = parseLocationInput(event.location ?? "");
      if (parsed.acronym) setSelectedBuildingAcronym(parsed.acronym);
      if (parsed.room) setRoomNumber(parsed.room);
      setDescription(event.description ?? "");
      setRecurring(Boolean(event.recurrenceRule));
      setParticipantCount(typeof event.participantCount === "number" ? String(event.participantCount) : "");
      setTechnicianNeeded(Boolean(event.technicianNeeded));
      setRequestCategory(event.requestCategory ?? "");
      setEquipmentNeeded(event.equipmentNeeded ?? "");
      setZendeskTicket(event.zendeskTicketNumber ?? "");
      setEventInfoStart(event.eventStartTime ? new Date(event.eventStartTime) : null);
      setEventInfoEnd(event.eventEndTime ? new Date(event.eventEndTime) : null);
      setSetupInfoTime(event.setupTime ? new Date(event.setupTime) : null);
      setError(null);
      if (event.assigneeProfile) {
        setAssignee({
          profileId: event.assigneeProfile.id,
          displayName: resolveProfileLabel(event.assigneeProfile),
          email: event.assigneeProfile.email,
        });
      } else {
        setAssignee(null);
      }
      setAssigneeSearch("");
      setAssigneeQuery("");
      if (event.attendees && event.attendees.length > 0) {
        setSelectedAttendees(
          event.attendees
            .filter((attendee) => attendee.profileId !== null)
            .map((attendee) => ({
              profileId: attendee.profileId!,
              displayName: resolveProfileLabel(attendee),
              email: attendee.email,
            })),
        );
      } else {
        setSelectedAttendees([]);
      }
      if (event.coOwners && event.coOwners.length > 0) {
        setSelectedCoOwners(
          event.coOwners.map((coOwner) => ({
            profileId: coOwner.profileId,
            displayName: resolveProfileLabel(coOwner),
            email: coOwner.email,
          })),
        );
      } else {
        setSelectedCoOwners([]);
      }
      setAttendeeSearch("");
      setAttendeeQuery("");
      setCoOwnerSearch("");
      setCoOwnerQuery("");
      setQuickCreateTarget(null);
      setQuickCreateDraft(emptyProfileDraft);
      setQuickCreateError(null);
      const eventCalendar = event.calendarId ?? calendarId ?? null;
      setSelectedCalendarId(eventCalendar);
      setSelectedCalendarIds(eventCalendar ? [eventCalendar] : []);
      if (event.hourLogs && event.hourLogs.length > 0) {
        setHourLogs(
          event.hourLogs.map((log) => ({
            id: randomId(),
            sourceId: log.id,
            start: log.startTime ? new Date(log.startTime) : null,
            end: log.endTime ? new Date(log.endTime) : null,
          })),
        );
      } else {
        setHourLogs([]);
      }
      return;
    }
    setTitle("");
    setSegments([makeSegment(defaultDate)]);
    setAllDay(false);
    setInPerson(false);
    setLocation("");
    setSelectedBuildingId(null);
    setSelectedBuildingAcronym("");
    setRoomNumber("");
    setDescription("");
    setRecurring(false);
    setParticipantCount("");
    setTechnicianNeeded(false);
    setRequestCategory("");
    setEquipmentNeeded("");
    setZendeskTicket("");
    setEventInfoStart(null);
    setEventInfoEnd(null);
    setSetupInfoTime(null);
    setError(null);
    setAssignee(null);
    setAssigneeSearch("");
    setAssigneeQuery("");
    setSelectedAttendees([]);
    setAttendeeSearch("");
    setAttendeeQuery("");
    setSelectedCoOwners([]);
    setCoOwnerSearch("");
    setCoOwnerQuery("");
    setQuickCreateTarget(null);
    setQuickCreateDraft(emptyProfileDraft);
    setQuickCreateError(null);
    const preferred = (calendarOptions ?? [])
      .map((c) => c.id)
      .filter((id) => (calendars ?? []).some((c) => c.id === id && c.canWrite));
    const visiblePreferred = (preferred ?? []).filter((id) => (visibleCalendarIds ?? []).includes(id));
    const fallbackCalendarId = calendarId ?? visiblePreferred[0] ?? preferred[0] ?? null;
    const initialSelections =
      visiblePreferred.length > 0 ? visiblePreferred : fallbackCalendarId ? [fallbackCalendarId] : [];
    setSelectedCalendarId(fallbackCalendarId);
    setSelectedCalendarIds(initialSelections);
    setHourLogs([]);
  }, [open, defaultDate, event, calendarId, calendarOptions, calendars, visibleCalendarIds]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setAssigneeQuery(assigneeSearch.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [assigneeSearch]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setAttendeeQuery(attendeeSearch.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [attendeeSearch]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setCoOwnerQuery(coOwnerSearch.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [coOwnerSearch]);

  // Location search + sync effects are defined after facility hooks

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
    const normalized = normalizeTimeInput(value);
    if (!normalized) return;
    const [hours, minutes] = normalized.split(":").map(Number);
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
    const normalized = normalizeTimeInput(value);
    if (!normalized) return;
    const [hours, minutes] = normalized.split(":").map(Number);
    updateSegment(id, (segment) => {
      const end = new Date(segment.end);
      end.setHours(hours ?? 0, minutes ?? 0, 0, 0);
      if (end <= segment.start) {
        end.setTime(segment.start.getTime() + MIN_DURATION_MS);
      }
      return { ...segment, end };
    });
  };

  const getInfoFieldState = (field: InfoField) => {
    switch (field) {
      case "eventStart":
        return [eventInfoStart, setEventInfoStart] as const;
      case "eventEnd":
        return [eventInfoEnd, setEventInfoEnd] as const;
      case "setup":
      default:
        return [setupInfoTime, setSetupInfoTime] as const;
    }
  };

  const handleInfoDateChange = (field: InfoField, value: string) => {
    const [, setter] = getInfoFieldState(field);
    if (!value) {
      setter(null);
      return;
    }
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return;
    setter((prev) => {
      const next = prev ? new Date(prev) : new Date(infoBaseDate);
      next.setFullYear(year, month - 1, day);
      return next;
    });
  };

  const handleInfoTimeChange = (field: InfoField, value: string) => {
    const [, setter] = getInfoFieldState(field);
    if (!value) {
      setter(null);
      return;
    }
    const normalized = normalizeTimeInput(value);
    if (!normalized) return;
    const [hours, minutes] = normalized.split(":").map(Number);
    setter((prev) => {
      const next = prev ? new Date(prev) : new Date(infoBaseDate);
      next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
      return next;
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
          start: new Date(last.start),
          end: new Date(last.end),
        },
      ];
    });
  };

  const removeSegment = (id: string) => {
    setSegments((prev) => (prev.length === 1 ? prev : prev.filter((segment) => segment.id !== id)));
  };

  const segmentsInvalid = segments.some((segment) => segment.start >= segment.end);
  const isSaving = isEditing ? update.isPending : create.isPending;
  const hourLogsIncomplete = hourLogs.some((log) => Boolean(log.start) !== Boolean(log.end));
  const hourLogsInvalid = hourLogs.some((log) => log.start && log.end && log.end <= log.start);
  const trimmedParticipantCount = participantCount.trim();
  const parsedParticipantCount =
    trimmedParticipantCount === ""
      ? null
      : /^[0-9]+$/.test(trimmedParticipantCount)
        ? Number.parseInt(trimmedParticipantCount, 10)
        : NaN;
  const participantCountInvalid =
    parsedParticipantCount !== null &&
    (Number.isNaN(parsedParticipantCount) || parsedParticipantCount < 0 || parsedParticipantCount > 100000);
  const hasCalendar = Boolean(selectedCalendarId ?? calendarId ?? event?.calendarId);
  const canSave =
    Boolean(title.trim()) &&
    hasCalendar &&
    !segmentsInvalid &&
    !hourLogsInvalid &&
    !hourLogsIncomplete &&
    !participantCountInvalid &&
    !isSaving &&
    !deleteMutation.isPending;
  const dialogTitle = isEditing ? "Edit event" : "Create event";
  const primaryButtonLabel = isSaving ? "Saving..." : isEditing ? "Save changes" : "Save";
  const assigneeResults = api.profile.search.useQuery(
    { query: assigneeQuery, limit: 7 },
    { enabled: open && assigneeQuery.length > 1 },
  );
  const assigneeMatches = assigneeResults.data ?? [];
  const shouldShowAssigneeResults = assigneeQuery.length > 1;
  const attendeeResults = api.profile.search.useQuery(
    { query: attendeeQuery, limit: 7 },
    { enabled: open && attendeeQuery.length > 1 },
  );
  const attendeeMatches = attendeeResults.data ?? [];
  const shouldShowAttendeeResults = attendeeQuery.length > 1;
  const coOwnerResults = api.profile.search.useQuery(
    { query: coOwnerQuery, limit: 7 },
    { enabled: open && coOwnerQuery.length > 1 },
  );
  const coOwnerMatches = coOwnerResults.data ?? [];
  const shouldShowCoOwnerResults = coOwnerQuery.length > 1;
  const createProfile = api.profile.create.useMutation();
  // Facilities data
  const buildingList = api.facility.listBuildings.useQuery(undefined, { enabled: open });
  const [locationQuery, setLocationQuery] = useState("");
  const locationResults = api.facility.searchRooms.useQuery(
    { query: locationQuery, limit: 7 },
    { enabled: open && locationQuery.length > 0 },
  );
  const locationMatches = locationResults.data ?? [];
  const [locationHighlight, setLocationHighlight] = useState(-1);

  useEffect(() => {
    if (!selectedBuildingId) return;
    const list = buildingList.data ?? [];
    const found = list.find((b) => b.id === selectedBuildingId);
    if (found) setSelectedBuildingAcronym(found.acronym);
  }, [selectedBuildingId, buildingList.data]);

  // Location search + sync effects
  useEffect(() => {
    setLocationHighlight(-1);
  }, [location, locationMatches.length]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = location.trim();
      if (trimmed.length === 0) {
        setLocationQuery("");
        return;
      }
      setLocationQuery(trimmed);
      const { acronym, room } = parseLocationInput(trimmed);
      if (acronym) setSelectedBuildingAcronym(acronym);
      if (room) setRoomNumber(room);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [location]);

  useEffect(() => {
    if (selectedBuildingAcronym) {
      const next = roomNumber ? `${selectedBuildingAcronym} ${roomNumber}` : `${selectedBuildingAcronym}`;
      setLocation(next);
    }
  }, [selectedBuildingAcronym, roomNumber]);
  const totalLoggedHours = hourLogs.reduce((sum, log) => sum + diffHours(log.start, log.end), 0);
  const hourLogsValidationMessage = hourLogsInvalid
    ? "Each log's end time must be after its start time."
    : hourLogsIncomplete
      ? "Provide both a start and end time or remove the log."
      : null;
  const primarySegment = segments[0] ?? null;
  const fallbackEventInfoStart = eventInfoStart ?? (primarySegment ? new Date(primarySegment.start) : null);
  const fallbackEventInfoEnd = eventInfoEnd ?? (primarySegment ? new Date(primarySegment.end) : null);
  const fallbackSetupInfoTime = setupInfoTime ?? (primarySegment ? new Date(primarySegment.start) : null);
  const fallbackEventInfoStartValue = fallbackEventInfoStart ? formatTimeValue(fallbackEventInfoStart) : "";
  const fallbackEventInfoEndValue = fallbackEventInfoEnd ? formatTimeValue(fallbackEventInfoEnd) : "";
  const fallbackSetupInfoValue = fallbackSetupInfoTime ? formatTimeValue(fallbackSetupInfoTime) : "";
  const fallbackEventInfoStartIsCustom = Boolean(fallbackEventInfoStartValue && !timeOptionValues.has(fallbackEventInfoStartValue));
  const fallbackEventInfoEndIsCustom = Boolean(fallbackEventInfoEndValue && !timeOptionValues.has(fallbackEventInfoEndValue));
  const fallbackSetupInfoIsCustom = Boolean(fallbackSetupInfoValue && !timeOptionValues.has(fallbackSetupInfoValue));

  useEffect(() => {
    setAssigneeHighlight(-1);
  }, [assigneeSearch, assigneeMatches.length]);

  useEffect(() => {
    setAttendeeHighlight(-1);
  }, [attendeeSearch, attendeeMatches.length]);

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleLocationSelect = (match: LocationMatch) => {
    setSelectedBuildingId(match.buildingId);
    setSelectedBuildingAcronym(match.acronym);
    setRoomNumber(match.roomNumber);
    setLocation(`${match.acronym} ${match.roomNumber}`);
    setLocationQuery("");
  };

  const addHourLogRow = () => {
    setHourLogs((prev) => {
      const last = prev[prev.length - 1];
      const fallbackStart = last?.end ?? logBaseDate;
      const start = fallbackStart ? new Date(fallbackStart) : new Date(logBaseDate);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return [
        ...prev,
        {
          id: randomId(),
          sourceId: null,
          start,
          end,
        },
      ];
    });
  };

  const handleHourLogChange = (id: string, field: "start" | "end", value: string) => {
    setHourLogs((prev) =>
      prev.map((log) =>
        log.id === id
          ? {
              ...log,
              [field]: parseHourLogTime(value, logBaseDate),
            }
          : log,
      ),
    );
  };

  const removeHourLogRow = (id: string) => {
    setHourLogs((prev) => prev.filter((log) => log.id !== id));
  };

  const handleSelectAssignee = (option: RouterOutputs["profile"]["search"][number]) => {
    setAssignee({
      profileId: option.profileId,
      displayName: resolveProfileLabel(option),
      email: option.email,
      username: option.username,
    });
    setAssigneeSearch("");
    setAssigneeQuery("");
  };

  const handleClearAssignee = () => {
    setAssignee(null);
    setAssigneeSearch("");
    setAssigneeQuery("");
  };

  const handleAddAttendee = (option: RouterOutputs["profile"]["search"][number] | AssigneeSelection) => {
    setSelectedAttendees((prev) => {
      if (prev.some((entry) => entry.profileId === option.profileId)) return prev;
      const displayName = resolveProfileLabel(option);
      return [
        ...prev,
        {
          profileId: option.profileId,
          displayName,
          email: option.email,
          username: "username" in option ? option.username : undefined,
        },
      ];
    });
    setAttendeeSearch("");
    setAttendeeQuery("");
  };

  const handleRemoveAttendee = (profileId: number) => {
    setSelectedAttendees((prev) => prev.filter((entry) => entry.profileId !== profileId));
  };

  const handleAddCoOwner = (option: RouterOutputs["profile"]["search"][number] | AssigneeSelection) => {
    setSelectedCoOwners((prev) => {
      if (prev.some((entry) => entry.profileId === option.profileId)) return prev;
      const displayName = resolveProfileLabel(option);
      return [
        ...prev,
        {
          profileId: option.profileId,
          displayName,
          email: option.email,
          username: "username" in option ? option.username : undefined,
        },
      ];
    });
    setCoOwnerSearch("");
    setCoOwnerQuery("");
  };

  const handleRemoveCoOwner = (profileId: number) => {
    setSelectedCoOwners((prev) => prev.filter((entry) => entry.profileId !== profileId));
  };

  const closeQuickCreate = () => {
    setQuickCreateTarget(null);
    setQuickCreateDraft(emptyProfileDraft);
    setQuickCreateError(null);
  };

  const openQuickCreate = (target: "assignee" | "attendee" | "coOwner", seed?: string) => {
    const source =
      seed ??
      (target === "assignee" ? assigneeSearch : target === "coOwner" ? coOwnerSearch : attendeeSearch);
    const derived = deriveProfileDraft(source);
    setQuickCreateTarget(target);
    setQuickCreateDraft({
      ...emptyProfileDraft,
      ...derived,
    });
    setQuickCreateError(null);
  };

  const handleQuickCreateSubmit = async () => {
    setQuickCreateError(null);
    const firstName = quickCreateDraft.firstName.trim();
    const lastName = quickCreateDraft.lastName.trim();
    const email = quickCreateDraft.email.trim();
    if (!firstName || !lastName || !email) {
      setQuickCreateError("Add a first name, last name, and email.");
      return;
    }
    try {
      const created = await createProfile.mutateAsync({
        firstName,
        lastName,
        email,
        phoneNumber: quickCreateDraft.phoneNumber.trim(),
      });
      if (!created.profileId) {
        throw new Error("Profile could not be created.");
      }
      const selection: AssigneeSelection = {
        profileId: created.profileId,
        displayName: resolveProfileLabel(created),
        email: created.email,
        username: created.username,
      };
      if (quickCreateTarget === "assignee") {
        setAssignee(selection);
        setAssigneeSearch("");
        setAssigneeQuery("");
      } else if (quickCreateTarget === "attendee") {
        handleAddAttendee(selection);
      } else if (quickCreateTarget === "coOwner") {
        handleAddCoOwner(selection);
      }
      closeQuickCreate();
    } catch (err) {
      setQuickCreateError(err instanceof Error ? err.message : "Failed to create profile.");
    }
  };

  function renderQuickCreateForm() {
    if (quickCreateTarget === null) return null;
    return (
      <div className="mt-2 rounded-md border border-outline-muted bg-surface-muted p-3">
        <div className="flex items-center justify-between text-sm font-semibold text-ink-primary">
          <span>
            Create{" "}
            {quickCreateTarget === "assignee" ? "assignee" : quickCreateTarget === "coOwner" ? "co-owner" : "attendee"} profile
          </span>
          <button
            type="button"
            onClick={closeQuickCreate}
            className="text-xs font-medium text-ink-muted transition hover:text-ink-primary"
          >
            Cancel
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <input
              placeholder="First name"
              value={quickCreateDraft.firstName}
              onChange={(e) => setQuickCreateDraft((prev) => ({ ...prev, firstName: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
            />
            <input
              placeholder="Last name"
              value={quickCreateDraft.lastName}
              onChange={(e) => setQuickCreateDraft((prev) => ({ ...prev, lastName: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
            />
          </div>
          <div className="space-y-2">
            <input
              placeholder="Email"
              value={quickCreateDraft.email}
              onChange={(e) => setQuickCreateDraft((prev) => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
            />
            <input
              placeholder="Phone (optional)"
              value={quickCreateDraft.phoneNumber}
              onChange={(e) => setQuickCreateDraft((prev) => ({ ...prev, phoneNumber: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
            />
          </div>
        </div>
        {quickCreateError && <div className="mt-2 text-xs text-status-danger">{quickCreateError}</div>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="text-xs font-medium text-ink-muted transition hover:text-ink-primary"
            onClick={closeQuickCreate}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="rounded-md bg-accent-strong px-3 py-1.5 text-sm font-medium text-ink-inverted disabled:opacity-50"
            disabled={createProfile.isPending}
            onClick={handleQuickCreateSubmit}
          >
            {createProfile.isPending
              ? "Saving..."
              : quickCreateTarget === "assignee"
                ? "Save & assign"
                : "Save & add"}
          </button>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setError(null);
    try {
      if (hourLogsInvalid || hourLogsIncomplete) {
        setError("Please complete or remove invalid hour log entries.");
        return;
      }
      const payloadHourLogs = hourLogs
        .map((log) => {
          if (!log.start || !log.end) return null;
          const base = { startTime: log.start, endTime: log.end };
          return log.sourceId ? { ...base, id: log.sourceId } : base;
        })
        .filter((log): log is { id?: number; startTime: Date; endTime: Date } => Boolean(log));
      const participantCountValue =
        trimmedParticipantCount === ""
          ? isEditing
            ? null
            : undefined
          : parsedParticipantCount ?? undefined;
      const equipmentValue = equipmentNeeded.trim();
      const equipmentPayload =
        equipmentValue.length > 0 ? equipmentValue : isEditing ? null : undefined;
      const requestCategoryValue = requestCategory ? requestCategory : isEditing ? null : undefined;
      const eventInfoStartValue = eventInfoStart ? new Date(eventInfoStart) : isEditing ? null : undefined;
      const eventInfoEndValue = eventInfoEnd ? new Date(eventInfoEnd) : isEditing ? null : undefined;
      const setupInfoValue = setupInfoTime ? new Date(setupInfoTime) : isEditing ? null : undefined;
      const zendeskTicketValueRaw = zendeskTicket.replace(/[^a-zA-Z0-9]/g, "");
      const zendeskTicketPayload =
        zendeskTicketValueRaw.length > 0 ? zendeskTicketValueRaw : isEditing ? null : undefined;
      const attendeeProfileIds = selectedAttendees.map((entry) => entry.profileId).filter((id) => id > 0);
      const coOwnerProfileIds = selectedCoOwners.map((entry) => entry.profileId).filter((id) => id > 0);
      const targetCalendarIds = Array.from(new Set(selectedCalendarIds));
      if (targetCalendarIds.length === 0) {
        setError("Select at least one calendar before saving.");
        return;
      }
      const targetCalendarId = targetCalendarIds[0] ?? null;

      if (isEditing && event) {
        const segment = segments[0];
        if (!segment) {
          throw new Error("Unable to determine event time range.");
        }
        const dayStart = allDay ? startOfDay(segment.start) : segment.start;
        const dayEnd = allDay ? addDays(startOfDay(segment.start), 1) : segment.end;
        await update.mutateAsync({
          id: event.id,
          calendarId: targetCalendarId ?? targetCalendarIds[0]!,
          title,
          description,
          location,
          buildingId: selectedBuildingId,
          isAllDay: allDay,
          startDatetime: dayStart,
          endDatetime: dayEnd,
          recurrenceRule: recurring ? event.recurrenceRule ?? "FREQ=DAILY" : null,
          assigneeProfileId: assignee ? assignee.profileId : null,
          coOwnerProfileIds,
          hourLogs: payloadHourLogs,
          attendeeProfileIds,
          participantCount: participantCountValue,
          technicianNeeded,
          requestCategory: requestCategoryValue,
          equipmentNeeded: equipmentPayload,
          eventStartTime: eventInfoStartValue,
          eventEndTime: eventInfoEndValue,
          setupTime: setupInfoValue,
          zendeskTicketNumber: zendeskTicketPayload,
        });

        const additionalCalendarIds = targetCalendarIds.slice(1);
        if (additionalCalendarIds.length > 0) {
          const participantCountPayload = participantCountValue ?? undefined;
          const requestCategoryPayload = requestCategoryValue ?? undefined;
          const equipmentPayloadCreate = equipmentPayload ?? undefined;
          const eventInfoStartPayload = eventInfoStartValue ?? undefined;
          const eventInfoEndPayload = eventInfoEndValue ?? undefined;
          const setupInfoPayload = setupInfoValue ?? undefined;
          const zendeskTicketPayloadCreate = zendeskTicketPayload ?? undefined;
          for (const calendarId of additionalCalendarIds) {
            await create.mutateAsync({
              calendarId,
              title,
              description,
              location,
              buildingId: selectedBuildingId ?? undefined,
              isAllDay: allDay,
              startDatetime: dayStart,
              endDatetime: dayEnd,
              recurrenceRule: recurring ? event.recurrenceRule ?? "FREQ=DAILY" : null,
              assigneeProfileId: assignee?.profileId ?? undefined,
              coOwnerProfileIds,
              hourLogs: payloadHourLogs,
              attendeeProfileIds,
              participantCount: participantCountPayload,
              technicianNeeded,
              requestCategory: requestCategoryPayload,
              equipmentNeeded: equipmentPayloadCreate,
              eventStartTime: eventInfoStartPayload,
              eventEndTime: eventInfoEndPayload,
              setupTime: setupInfoPayload,
              zendeskTicketNumber: zendeskTicketPayloadCreate,
            });
          }
        }
      } else {
        const participantCountPayload = participantCountValue ?? undefined;
        const requestCategoryPayload = requestCategoryValue ?? undefined;
        const equipmentPayloadCreate = equipmentPayload ?? undefined;
        const eventInfoStartPayload = eventInfoStartValue ?? undefined;
        const eventInfoEndPayload = eventInfoEndValue ?? undefined;
        const setupInfoPayload = setupInfoValue ?? undefined;
        const zendeskTicketPayloadCreate = zendeskTicketPayload ?? undefined;
        for (const segment of segments) {
          const dayStart = allDay ? startOfDay(segment.start) : segment.start;
          const dayEnd = allDay ? addDays(startOfDay(segment.start), 1) : segment.end;
          for (const calendarId of targetCalendarIds) {
            await create.mutateAsync({
              calendarId,
              title,
              description,
              location,
              buildingId: selectedBuildingId ?? undefined,
              isAllDay: allDay,
              startDatetime: dayStart,
              endDatetime: dayEnd,
              recurrenceRule: recurring ? "FREQ=DAILY" : null,
              assigneeProfileId: assignee?.profileId ?? undefined,
              coOwnerProfileIds,
              hourLogs: payloadHourLogs,
              attendeeProfileIds,
              participantCount: participantCountPayload,
              technicianNeeded,
              requestCategory: requestCategoryPayload,
              equipmentNeeded: equipmentPayloadCreate,
              eventStartTime: eventInfoStartPayload,
              eventEndTime: eventInfoEndPayload,
              setupTime: setupInfoPayload,
              zendeskTicketNumber: zendeskTicketPayloadCreate,
            });
          }
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

  const handleDelete = async () => {
    if (!event || deleteMutation.isPending) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!event || deleteMutation.isPending) return;
    setError(null);
    try {
      await deleteMutation.mutateAsync({ id: event.id });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to delete event");
    }
  };

  if (!open) return null;

  return (
    <div
      data-scroll-lock="allow"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--color-overlay-backdrop)] px-4"
      onMouseDown={handleBackdropMouseDown}
    >
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-[var(--color-overlay-backdrop)] p-4">
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
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="relative max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-outline-muted bg-surface-raised p-6 text-ink-primary shadow-2xl shadow-[var(--shadow-pane)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">{dialogTitle}</div>
          <button className="rounded-md border border-outline-muted px-2 py-1 hover:bg-surface-muted" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <input
            placeholder="Add a title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none placeholder:text-ink-faint"
          />

          <div>
            <div className="mb-1 text-xs text-ink-muted">Calendars</div>
            {calendarOptions.length === 0 ? (
              <div className="rounded-md border border-outline-muted bg-surface-muted p-3 text-xs text-ink-muted">
                No writable calendars available.
              </div>
            ) : (
              <>
                <div className="rounded-md border border-outline-muted bg-surface-muted p-2">
                  {selectedCalendarIds.length === 0 ? (
                    <div className="text-xs text-ink-muted">Select at least one calendar.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {calendarOptions
                        .filter((option) => selectedCalendarIds.includes(option.id))
                        .map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setSelectedCalendarIds((prev) => prev.filter((id) => id !== option.id))}
                            className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-raised px-3 py-1 text-xs text-ink-primary hover:bg-surface-muted"
                          >
                            <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: option.color }} />
                            <span className="max-w-[12rem] truncate">{option.name}</span>
                            <span className="text-ink-faint">x</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const nextId = Number(e.target.value);
                    if (!Number.isFinite(nextId)) return;
                    setSelectedCalendarIds((prev) => (prev.includes(nextId) ? prev : [...prev, nextId]));
                    setSelectedCalendarId(nextId);
                  }}
                  className="mt-2 w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
                >
                  <option value="">Add calendar</option>
                  {calendarOptions
                    .filter((option) => !selectedCalendarIds.includes(option.id))
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-xs text-ink-subtle">
                  {selectedCalendarIds.length} selected
                </p>
              </>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-muted">Zendesk ticket number</div>
            <input
              type="text"
              inputMode="text"
              maxLength={64}
              value={zendeskTicket}
              onChange={(e) => setZendeskTicket(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
              placeholder="e.g., 123456"
            />
            <p className="mt-1 text-xs text-ink-subtle">Only letters and numbers are kept.</p>
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-muted">Invite attendees</div>
            <div className="flex flex-wrap gap-2">
              {selectedAttendees.length === 0 ? (
                <span className="text-xs text-ink-muted">No attendees selected.</span>
              ) : (
                selectedAttendees.map((attendee) => (
                  <span
                    key={attendee.profileId}
                    className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-muted px-3 py-1 text-sm text-ink-primary"
                  >
                    <span className="font-medium">{attendee.displayName}</span>
                    <span className="text-xs text-ink-muted">{attendee.email}</span>
                    <button
                      type="button"
                      className="text-ink-faint transition hover:text-status-danger"
                      onClick={() => handleRemoveAttendee(attendee.profileId)}
                      aria-label="Remove attendee"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="relative mt-2">
              <input
                placeholder="Search by name, email, or phone"
                value={attendeeSearch}
                onChange={(e) => setAttendeeSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAttendeeHighlight((prev) => Math.min(prev + 1, attendeeMatches.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAttendeeHighlight((prev) => Math.max(prev - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (attendeeMatches.length === 1) {
                      handleAddAttendee(attendeeMatches[0]!);
                    } else if (attendeeHighlight >= 0 && attendeeHighlight < attendeeMatches.length) {
                      handleAddAttendee(attendeeMatches[attendeeHighlight]!);
                    }
                  }
                }}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none placeholder:text-ink-faint"
              />
              {shouldShowAttendeeResults && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-outline-muted bg-surface-overlay shadow-xl">
                  {attendeeResults.isFetching ? (
                    <div className="px-3 py-2 text-sm text-ink-muted">Searching...</div>
                  ) : attendeeMatches.length > 0 ? (
                    <>
                      {attendeeMatches.map((match, index) => {
                        const isActive = index === attendeeHighlight;
                        return (
                        <button
                          key={match.profileId}
                          type="button"
                          className={
                            "flex w-full flex-col items-start gap-0.5 border-b border-outline-muted px-3 py-2 text-left text-sm text-ink-primary last:border-b-0 " +
                            (isActive ? "bg-accent-muted" : "hover:bg-surface-muted")
                          }
                          onClick={() => handleAddAttendee(match)}
                          onMouseEnter={() => setAttendeeHighlight(index)}
                        >
                          <span className="font-medium">{match.displayName}</span>
                          <span className="text-xs text-ink-muted">{match.email}</span>
                        </button>
                        );
                      })}
                      <div className="px-3 py-2 text-sm text-ink-muted">
                        <button
                          type="button"
                          className="text-accent-soft hover:text-accent-strong"
                          onClick={() => openQuickCreate("attendee")}
                        >
                          Create new profile for &quot;{fallbackSearchLabel(attendeeSearch, "attendee")}&quot;
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2 px-3 py-2 text-sm text-ink-muted">
                      <div>No profiles found</div>
                      <button
                        type="button"
                        className="text-accent-soft hover:text-accent-strong"
                        onClick={() => openQuickCreate("attendee")}
                      >
                        Create profile for &quot;{fallbackSearchLabel(attendeeSearch, "attendee")}&quot;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {quickCreateTarget === "attendee" ? renderQuickCreateForm() : null}
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-muted">Co-owners</div>
            <div className="flex flex-wrap gap-2">
              {selectedCoOwners.length === 0 ? (
                <span className="text-xs text-ink-muted">No co-owners selected.</span>
              ) : (
                selectedCoOwners.map((owner) => (
                  <span
                    key={owner.profileId}
                    className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-muted px-3 py-1 text-sm text-ink-primary"
                  >
                    <span className="font-medium">{owner.displayName}</span>
                    <span className="text-xs text-ink-muted">{owner.email}</span>
                    <button
                      type="button"
                      className="text-ink-faint transition hover:text-status-danger"
                      onClick={() => handleRemoveCoOwner(owner.profileId)}
                      aria-label="Remove co-owner"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="relative mt-2">
              <input
                placeholder="Search by name, email, or phone"
                value={coOwnerSearch}
                onChange={(e) => setCoOwnerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCoOwnerHighlight((prev) => Math.min(prev + 1, coOwnerMatches.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCoOwnerHighlight((prev) => Math.max(prev - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (coOwnerMatches.length === 1) {
                      handleAddCoOwner(coOwnerMatches[0]!);
                    } else if (coOwnerHighlight >= 0 && coOwnerHighlight < coOwnerMatches.length) {
                      handleAddCoOwner(coOwnerMatches[coOwnerHighlight]!);
                    }
                  }
                }}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none placeholder:text-ink-faint"
              />
              {shouldShowCoOwnerResults && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-outline-muted bg-surface-overlay shadow-xl">
                  {coOwnerResults.isFetching ? (
                    <div className="px-3 py-2 text-sm text-ink-muted">Searching...</div>
                  ) : coOwnerMatches.length > 0 ? (
                    <>
                      {coOwnerMatches.map((match, index) => {
                        const isActive = index === coOwnerHighlight;
                        return (
                          <button
                            key={match.profileId}
                            type="button"
                            className={
                              "flex w-full flex-col items-start gap-0.5 border-b border-outline-muted px-3 py-2 text-left text-sm text-ink-primary last:border-b-0 " +
                              (isActive ? "bg-accent-muted" : "hover:bg-surface-muted")
                            }
                            onClick={() => handleAddCoOwner(match)}
                            onMouseEnter={() => setCoOwnerHighlight(index)}
                          >
                            <span className="font-medium">{match.displayName}</span>
                            <span className="text-xs text-ink-muted">{match.email}</span>
                          </button>
                        );
                      })}
                      <div className="px-3 py-2 text-sm text-ink-muted">
                        <button
                          type="button"
                          className="text-accent-soft hover:text-accent-strong"
                          onClick={() => openQuickCreate("coOwner")}
                        >
                          Create new profile for &quot;{fallbackSearchLabel(coOwnerSearch, "co-owner")}&quot;
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2 px-3 py-2 text-sm text-ink-muted">
                      <div>No profiles found</div>
                      <button
                        type="button"
                        className="text-accent-soft hover:text-accent-strong"
                        onClick={() => openQuickCreate("coOwner")}
                      >
                        Create profile for &quot;{fallbackSearchLabel(coOwnerSearch, "co-owner")}&quot;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {quickCreateTarget === "coOwner" ? renderQuickCreateForm() : null}
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-muted">Assign to</div>
            <div className="space-y-2">
              {assignee && (
                <div className="flex items-center justify-between rounded-md border border-outline-accent bg-accent-muted px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-ink-primary">{assignee.displayName}</div>
                    <div className="text-xs text-ink-muted">{assignee.email}</div>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-status-success hover:text-accent-soft"
                    onClick={handleClearAssignee}
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="relative">
              <input
                placeholder={assignee ? "Search to reassign" : "Search by name, username, or email"}
                value={assigneeSearch}
                onChange={(e) => setAssigneeSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAssigneeHighlight((prev) => Math.min(prev + 1, assigneeMatches.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAssigneeHighlight((prev) => Math.max(prev - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (assigneeMatches.length === 1) {
                      handleSelectAssignee(assigneeMatches[0]!);
                    } else if (assigneeHighlight >= 0 && assigneeHighlight < assigneeMatches.length) {
                      handleSelectAssignee(assigneeMatches[assigneeHighlight]!);
                    }
                  }
                }}
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none placeholder:text-ink-faint"
              />
                {shouldShowAssigneeResults && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-outline-muted bg-surface-overlay shadow-xl">
                    {assigneeResults.isFetching ? (
                      <div className="px-3 py-2 text-sm text-ink-muted">Searching...</div>
                    ) : assigneeMatches.length > 0 ? (
                      <>
                        {assigneeMatches.map((match, index) => {
                          const isActive = index === assigneeHighlight;
                          return (
                            <button
                              key={match.profileId}
                              type="button"
                              className={
                                "flex w-full flex-col items-start gap-0.5 border-b border-outline-muted px-3 py-2 text-left text-sm text-ink-primary last:border-b-0 " +
                                (isActive ? "bg-accent-muted" : "hover:bg-surface-muted")
                              }
                              onClick={() => handleSelectAssignee(match)}
                              onMouseEnter={() => setAssigneeHighlight(index)}
                            >
                              <span className="font-medium">{match.displayName}</span>
                              <span className="text-xs text-ink-muted">{match.email}</span>
                            </button>
                          );
                        })}
                        <div className="px-3 py-2 text-sm text-ink-muted">
                          <button
                            type="button"
                            className="text-accent-soft hover:text-accent-strong"
                            onClick={() => openQuickCreate("assignee")}
                          >
                            Create new profile for &quot;{fallbackSearchLabel(assigneeSearch, "assignee")}&quot;
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-2 px-3 py-2 text-sm text-ink-muted">
                        <div>No profiles found</div>
                        <button
                          type="button"
                          className="text-accent-soft hover:text-accent-strong"
                          onClick={() => openQuickCreate("assignee")}
                        >
                          Create profile for &quot;{fallbackSearchLabel(assigneeSearch, "assignee")}&quot;
                        </button>
                      </div>
                    )}
                  </div>
              )}
            </div>
            {quickCreateTarget === "assignee" ? renderQuickCreateForm() : null}
          </div>
          </div>

          <div className="space-y-4 border-t border-outline-muted pt-4">
            {segments.map((segment, index) => {
              const startValue = formatTimeValue(segment.start);
              const endValue = formatTimeValue(segment.end);
              const hasStartOption = timeOptionValues.has(startValue);
              const hasEndOption = timeOptionValues.has(endValue);
              return (
              <div key={segment.id} className="space-y-2 border-b border-outline-muted pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <span>Day {index + 1}</span>
                  {!isEditing && segments.length > 1 && (
                    <button
                      type="button"
                      className="text-status-danger transition hover:text-status-danger"
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
                    className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                  />
                  {allDay ? (
                    <span className="rounded-md border border-outline-muted px-3 py-2 text-sm text-ink-subtle">All day</span>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <select
                          className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                          value={startValue}
                          onChange={(e) => handleStartTimeChange(segment.id, e.target.value)}
                        >
                          {timeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                          {!hasStartOption && (
                            <option value={startValue}>{`${formatTimeLabel(startValue)} (custom)`}</option>
                          )}
                        </select>
                        <ManualTimeEntryButton value={startValue} onChange={(next) => handleStartTimeChange(segment.id, next)} />
                      </div>
                      <span className="text-sm text-ink-subtle">to</span>
                      <div className="flex items-center gap-1">
                        <select
                          className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                          value={endValue}
                          onChange={(e) => handleEndTimeChange(segment.id, e.target.value)}
                        >
                          {timeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                          {!hasEndOption && (
                            <option value={endValue}>{`${formatTimeLabel(endValue)} (custom)`}</option>
                          )}
                        </select>
                        <ManualTimeEntryButton value={endValue} onChange={(next) => handleEndTimeChange(segment.id, next)} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
            })}
            {!isEditing && (
              <button
                type="button"
                onClick={addSegmentRow}
                className="text-sm font-medium text-accent-soft transition hover:text-status-success"
              >
                + Add another day
              </button>
            )}
          </div>

          <div className="space-y-4 border-t border-outline-muted pt-4">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Event request details</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-ink-muted">Number of participants</label>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  inputMode="numeric"
                  value={participantCount}
                  onChange={(e) => setParticipantCount(e.target.value)}
                  className={
                    "w-full rounded-md border bg-surface-muted px-3 py-2 text-ink-primary outline-none placeholder:text-ink-faint " +
                    (participantCountInvalid ? "border-status-danger text-status-danger" : "border-outline-muted")
                  }
                  placeholder="Estimated attendance"
                />
                {participantCountInvalid && (
                  <div className="mt-1 text-xs text-status-danger">Enter a whole number up to 100,000.</div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-muted">Technician needed?</label>
                <select
                  className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none"
                  value={technicianNeeded ? "yes" : "no"}
                  onChange={(e) => setTechnicianNeeded(e.target.value === "yes")}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Request category</label>
              <select
                className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none"
                value={requestCategory}
                onChange={(e) => setRequestCategory(e.target.value as RequestCategoryValue | "")}
              >
                <option value="">Select a category</option>
                {REQUEST_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Equipment needed</label>
              <textarea
                rows={3}
                value={equipmentNeeded}
                onChange={(e) => setEquipmentNeeded(e.target.value)}
                className="w-full rounded-md border border-outline-muted bg-surface-muted p-3 text-ink-primary outline-none placeholder:text-ink-faint"
                placeholder="List staging, audio, lighting, or other needs"
              />
            </div>
          </div>

          <div className="space-y-4 border-t border-outline-muted pt-4">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Event timeline (informational)</div>
            <div className="text-xs text-ink-muted">These fields do not change the calendar block.</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-outline-muted p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Event start</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={fallbackEventInfoStart ? formatDateInputValue(fallbackEventInfoStart) : ""}
                    onChange={(e) => handleInfoDateChange("eventStart", e.target.value)}
                    className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                  />
                  <div className="flex items-center gap-1">
                    <select
                      className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                      value={fallbackEventInfoStartValue}
                      onChange={(e) => handleInfoTimeChange("eventStart", e.target.value)}
                    >
                      <option value="">Select time</option>
                      {timeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      {fallbackEventInfoStartIsCustom && fallbackEventInfoStartValue && (
                        <option value={fallbackEventInfoStartValue}>{`${formatTimeLabel(fallbackEventInfoStartValue)} (custom)`}</option>
                      )}
                    </select>
                    <ManualTimeEntryButton
                      value={fallbackEventInfoStartValue}
                      onChange={(next) => handleInfoTimeChange("eventStart", next)}
                      allowEmpty
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-outline-muted p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Event end</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={fallbackEventInfoEnd ? formatDateInputValue(fallbackEventInfoEnd) : ""}
                    onChange={(e) => handleInfoDateChange("eventEnd", e.target.value)}
                    className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                  />
                  <div className="flex items-center gap-1">
                    <select
                      className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                      value={fallbackEventInfoEndValue}
                      onChange={(e) => handleInfoTimeChange("eventEnd", e.target.value)}
                    >
                      <option value="">Select time</option>
                      {timeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      {fallbackEventInfoEndIsCustom && fallbackEventInfoEndValue && (
                        <option value={fallbackEventInfoEndValue}>{`${formatTimeLabel(fallbackEventInfoEndValue)} (custom)`}</option>
                      )}
                    </select>
                    <ManualTimeEntryButton
                      value={fallbackEventInfoEndValue}
                      onChange={(next) => handleInfoTimeChange("eventEnd", next)}
                      allowEmpty
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-outline-muted p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Setup time</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={fallbackSetupInfoTime ? formatDateInputValue(fallbackSetupInfoTime) : ""}
                  onChange={(e) => handleInfoDateChange("setup", e.target.value)}
                  className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                />
                <div className="flex items-center gap-1">
                  <select
                    className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent-strong"
                    value={fallbackSetupInfoValue}
                    onChange={(e) => handleInfoTimeChange("setup", e.target.value)}
                  >
                    <option value="">Select time</option>
                    {timeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {fallbackSetupInfoIsCustom && fallbackSetupInfoValue && (
                      <option value={fallbackSetupInfoValue}>{`${formatTimeLabel(fallbackSetupInfoValue)} (custom)`}</option>
                    )}
                  </select>
                  <ManualTimeEntryButton
                    value={fallbackSetupInfoValue}
                    onChange={(next) => handleInfoTimeChange("setup", next)}
                    allowEmpty
                  />
                </div>
              </div>
            </div>
          </div>


          <div className="space-y-3 border-t border-outline-muted pt-4 text-sm text-ink-subtle">
            <div className="text-xs uppercase tracking-wide text-ink-subtle">Hour logging</div>
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
                              className={
                                "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " + pillClass
                              }
                            >
                              {pillText}
                            </span>
                          </div>
                          {(invalid || incomplete) && (
                            <div className="text-xs text-status-danger">
                              {invalid ? "End time must be after start time." : "Provide both a start and end time."}
                            </div>
                          )}
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
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
                  <div>
                    Total logged: <span className="font-semibold text-ink-primary">{totalLoggedHours.toFixed(2)} hours</span>
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
              <div className="text-xs text-status-danger">{hourLogsValidationMessage}</div>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-ink-muted">Add a room or location</div>
            <div className="mb-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-ink-muted">Building</div>
                <div className="relative">
                  <select
                    value={selectedBuildingAcronym}
                    onChange={(e) => {
                      const acr = e.target.value;
                      setSelectedBuildingAcronym(acr);
                      const b = (buildingList.data ?? []).find((x) => x.acronym === acr) ?? null;
                      setSelectedBuildingId(b ? b.id : null);
                    }}
                    className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none"
                  >
                    <option value="">Select building</option>
                    {(buildingList.data ?? []).map((b) => (
                      <option key={b.id} value={b.acronym}>
                        {b.acronym} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-ink-muted">Room</div>
                <input
                  placeholder="e.g., 210 or 210A"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value.toUpperCase())}
                  className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
                />
              </div>
            </div>
            <input
              placeholder="Location (try: BHG 210 or just 210)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setLocationHighlight((prev) => Math.min(prev + 1, Math.max(0, locationMatches.length - 1)));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setLocationHighlight((prev) => Math.max(prev - 1, 0));
                } else if (e.key === "Enter") {
                  if (locationMatches.length > 0 && locationHighlight >= 0) {
                    e.preventDefault();
                    const match = locationMatches[locationHighlight]!;
                    handleLocationSelect(match);
                  }
                }
              }}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-ink-primary outline-none placeholder:text-ink-faint"
            />
            {locationQuery.length > 0 && (
              <div className="relative">
                <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-outline-muted bg-surface-overlay shadow-xl">
                  {locationResults.isFetching ? (
                    <div className="px-3 py-2 text-sm text-ink-muted">Searching...</div>
                  ) : locationMatches.length > 0 ? (
                    <>
                      {locationMatches.map((match, index) => {
                        const isActive = index === locationHighlight;
                        return (
                          <button
                            key={`${match.acronym}:${match.roomNumber}:${match.buildingId}`}
                            type="button"
                            className={
                              "flex w-full items-center justify-between gap-2 border-b border-outline-muted px-3 py-2 text-left text-sm text-ink-primary last:border-b-0 " +
                              (isActive ? "bg-accent-muted" : "hover:bg-surface-muted")
                            }
                            onMouseEnter={() => setLocationHighlight(index)}
                            onClick={() => handleLocationSelect(match)}
                          >
                            <span>
                              <span className="font-semibold">{match.acronym}</span> {match.roomNumber}
                            </span>
                            <span className="text-xs text-ink-subtle">{match.buildingName}</span>
                          </button>
                        );
                      })}
                    </>
                  ) : (
                    <div className="px-3 py-2 text-sm text-ink-muted">No rooms found</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-ink-muted">Description</div>
            <textarea
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-md border border-outline-muted bg-surface-muted p-3 text-ink-primary outline-none placeholder:text-ink-faint"
              placeholder="Notes"
            />
          </div>

          {error && <div className="rounded-md border border-status-danger bg-status-danger-surface px-3 py-2 text-sm text-status-danger">{error}</div>}

          <div className="mt-2 flex items-center justify-between gap-2">
            {isEditing && event && (
              <button
                type="button"
                className="rounded-md border border-status-danger px-3 py-1.5 text-sm font-medium text-status-danger transition hover:bg-status-danger-surface disabled:border-status-danger/60 disabled:text-status-danger/60"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            )}
            <button
              className="rounded-md bg-accent-strong px-3 py-1.5 text-sm font-medium text-ink-inverted disabled:opacity-50"
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
