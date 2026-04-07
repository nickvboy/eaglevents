"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { TRPCClientError } from "@trpc/client";
import { useSession } from "next-auth/react";
import { addDays, startOfDay } from "../utils/date";
import {
  EQUIPMENT_NEEDED_OPTIONS,
  EVENT_TYPE_OPTIONS,
  buildEventRequestDetailsV2,
  formatLegacyEquipmentNeededText,
  toEventRequestFormState,
  type EquipmentNeededOption,
  type EventRequestDetails,
  type EventTypeOption,
} from "~/types/event-request";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";
import type { AppRouter } from "~/server/api/root";
import { ChevronDownIcon, XIcon } from "~/app/_components/icons";

const MIN_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_TIME_VALUE = "06:30";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZENDESK_TICKET_REGEX = /^\d{6}$/;
const DRAFT_STORAGE_KEY = "eaglevents:new-event-draft:v2";
const LEGACY_DRAFT_STORAGE_KEY = "eaglevents:new-event-draft:v1";
const EDIT_DRAFT_STORAGE_PREFIX = "eaglevents:edit-event-draft:v2";
const LEGACY_EDIT_DRAFT_STORAGE_PREFIX = "eaglevents:edit-event-draft:v1";
const FOCUSABLE_FIELD_CLASS =
  "transition focus-visible:border-outline-strong focus-visible:ring-accent-strong focus-visible:ring-2";
const DATE_FIELD_CLASS =
  "border-outline-muted bg-surface-muted text-ink-primary focus-visible:ring-accent-strong rounded-md border px-3 py-2 text-sm transition outline-none focus-visible:ring-2";
const INLINE_TIME_FIELD_ROW_CLASS = "flex flex-wrap items-center gap-2";

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

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

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
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function splitOptionsIntoColumns<T>(
  options: readonly T[],
  columnCount: number,
) {
  if (columnCount <= 1) return [Array.from(options)];
  const rowsPerColumn = Math.ceil(options.length / columnCount);
  return Array.from({ length: columnCount }, (_, index) =>
    options.slice(index * rowsPerColumn, (index + 1) * rowsPerColumn),
  );
}

function normalizeEmailInput(value: string) {
  return value.trim();
}

function sanitizeEmailDraft(value: string) {
  return normalizeEmailInput(value).replace(/\s+/g, "");
}

function isValidEmailAddress(value: string) {
  return EMAIL_REGEX.test(normalizeEmailInput(value));
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
    numericPart = numericPart
      .slice(0, numericPart.length - meridiemMatch[0].length)
      .trim();
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

type TimeSegmentDraft = {
  hour: string;
  minute: string;
  meridiem: "AM" | "PM" | "";
};

function getTimeSegmentDraft(value: string): TimeSegmentDraft {
  const normalized = normalizeTimeInput(value);
  if (!normalized) {
    return { hour: "", minute: "", meridiem: "" };
  }
  const [hoursPart, minutesPart] = normalized.split(":");
  const hoursValue = hoursPart ? Number(hoursPart) : Number.NaN;
  const minutesValue = minutesPart ? Number(minutesPart) : Number.NaN;
  if (Number.isNaN(hoursValue) || Number.isNaN(minutesValue)) {
    return { hour: "", minute: "", meridiem: "" };
  }
  const meridiem = hoursValue >= 12 ? "PM" : "AM";
  const normalizedHour = hoursValue % 12 || 12;
  return {
    hour: String(normalizedHour),
    minute: String(minutesValue).padStart(2, "0"),
    meridiem,
  };
}

function normalizeSegmentedTimeInput(draft: TimeSegmentDraft) {
  const hourValue = draft.hour.trim();
  const minuteValue = draft.minute.trim();
  const meridiemValue = draft.meridiem.trim().toUpperCase();
  if (!hourValue && !minuteValue && !meridiemValue) return "";
  if (!/^\d{1,2}$/.test(hourValue) || !/^\d{2}$/.test(minuteValue)) {
    return null;
  }
  if (meridiemValue !== "AM" && meridiemValue !== "PM") {
    return null;
  }
  const hours = Number(hourValue);
  const minutes = Number(minuteValue);
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
    return null;
  }
  let normalizedHours = hours % 12;
  if (meridiemValue === "PM") normalizedHours += 12;
  return `${String(normalizedHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function cycleTimeSegmentValue(
  draft: TimeSegmentDraft,
  segment: keyof TimeSegmentDraft,
  direction: 1 | -1,
): TimeSegmentDraft {
  if (segment === "hour") {
    const currentValue = Number(draft.hour || "12");
    const normalizedValue =
      Number.isNaN(currentValue) || currentValue < 1 || currentValue > 12
        ? 12
        : currentValue;
    const nextValue =
      direction === 1
        ? normalizedValue === 12
          ? 1
          : normalizedValue + 1
        : normalizedValue === 1
          ? 12
          : normalizedValue - 1;
    return { ...draft, hour: String(nextValue) };
  }
  if (segment === "minute") {
    const currentValue = Number(draft.minute || "00");
    const normalizedValue =
      Number.isNaN(currentValue) || currentValue < 0 || currentValue > 59
        ? 0
        : currentValue;
    const nextValue =
      direction === 1
        ? (normalizedValue + 1) % 60
        : (normalizedValue + 59) % 60;
    return { ...draft, minute: String(nextValue).padStart(2, "0") };
  }
  return {
    ...draft,
    meridiem: draft.meridiem === "PM" ? "AM" : "PM",
  };
}

function parseLocationInput(raw: string) {
  const value = (raw ?? "").trim();
  if (!value) return { acronym: null, room: null };
  const upper = value.toUpperCase();
  const compact = upper.replace(/\s+|-/g, "");
  let acronym: string | null = null;
  let room: string | null = null;
  const m2 = /^\s*([A-Z][A-Z0-9]{0,15})\s*[- ]\s*([0-9][A-Z0-9]*)\s*$/.exec(
    upper,
  );
  if (m2) {
    acronym = m2[1] ?? null;
    room = m2[2] ?? null;
  } else {
    const m1 = /^([A-Z]{1,16})([0-9][A-Z0-9]*)$/.exec(compact);
    if (m1) {
      acronym = m1[1] ?? null;
      room = m1[2] ?? null;
    } else {
      const onlyAcr = /^\s*([A-Z][A-Z0-9]{0,15})\s*$/.exec(upper);
      const onlyRoom = /^\s*([0-9][A-Z0-9]*)\s*$/.exec(upper);
      if (onlyAcr) acronym = onlyAcr[1] ?? null;
      if (onlyRoom) room = onlyRoom[1] ?? null;
    }
  }
  return { acronym, room };
}

function formatLocationSummaryFromRooms(rooms: LocationMatch[]) {
  if (rooms.length === 0) return "";
  const grouped = new Map<number, { acronym: string; rooms: string[] }>();
  for (const entry of rooms) {
    const existing = grouped.get(entry.buildingId);
    if (existing) {
      existing.rooms.push(entry.roomNumber);
    } else {
      grouped.set(entry.buildingId, {
        acronym: entry.acronym,
        rooms: [entry.roomNumber],
      });
    }
  }
  const segments = Array.from(grouped.values()).map((group) => {
    const uniqueRooms = Array.from(new Set(group.rooms));
    return uniqueRooms.length === 1
      ? `${group.acronym} ${uniqueRooms[0]}`
      : `${group.acronym} ${uniqueRooms.join(", ")}`;
  });
  return segments.join("; ");
}

function getNextHighlightedIndex(
  currentIndex: number,
  itemCount: number,
  direction: 1 | -1,
) {
  if (itemCount <= 0) return -1;
  if (direction === 1) {
    return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, itemCount - 1);
  }
  return currentIndex < 0 ? itemCount - 1 : Math.max(currentIndex - 1, 0);
}

function getHighlightedItem<T>(items: T[], highlightedIndex: number) {
  if (items.length === 0) return null;
  if (highlightedIndex >= 0 && highlightedIndex < items.length) {
    return items[highlightedIndex] ?? null;
  }
  return items.length === 1 ? (items[0] ?? null) : null;
}

function handleCheckboxEnterKey(
  event: ReactKeyboardEvent<HTMLInputElement>,
  onToggle: () => void,
) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  onToggle();
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
  allowEmpty?: boolean;
};

type DropdownSelectOption = {
  value: string;
  label: string;
};

function DropdownSelect({
  value,
  onChange,
  options,
  placeholder,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly DropdownSelectOption[];
  placeholder?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const selectedOption =
    options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, options, value]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  const commitSelection = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div
      className="relative"
      ref={containerRef}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          containerRef.current?.contains(nextTarget)
        ) {
          return;
        }
        setOpen(false);
      }}
    >
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined
        }
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((prev) =>
              getNextHighlightedIndex(prev, options.length, 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setHighlightedIndex((prev) =>
              getNextHighlightedIndex(prev, options.length, -1),
            );
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            const highlightedOption = getHighlightedItem(
              options as DropdownSelectOption[],
              highlightedIndex,
            );
            if (highlightedOption) {
              commitSelection(highlightedOption.value);
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "Tab") {
            setOpen(false);
          }
        }}
        className={
          `bg-surface-muted text-ink-primary flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm outline-none ${FOCUSABLE_FIELD_CLASS} ` +
          (invalid ? "border-status-danger" : "border-outline-muted")
        }
      >
        <span className={selectedOption ? "" : "text-ink-faint"}>
          {selectedOption?.label ?? placeholder ?? ""}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
      </button>
      {open && options.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className="border-outline-strong bg-surface-overlay/95 absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
        >
          {options.map((option, index) => {
            const isActive = index === highlightedIndex;
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={isActive}
                tabIndex={-1}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                className={
                  "border-outline-muted text-ink-primary flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                  (isActive || isSelected
                    ? "bg-accent-muted"
                    : "hover:bg-surface-muted")
                }
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => commitSelection(option.value)}
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  placeholder,
  options,
  invalid,
  allowEmpty = false,
}: TimeSelectProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimeSegmentDraft>(() =>
    getTimeSegmentDraft(value),
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRefs = useRef<
    Partial<Record<keyof TimeSegmentDraft, HTMLInputElement | null>>
  >({});
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listboxId = useId();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditError(null);
        setDraft(getTimeSegmentDraft(value));
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [value]);

  useEffect(() => {
    setDraft(getTimeSegmentDraft(value));
  }, [value]);

  const optionLabel = value
    ? (options.find((opt) => opt.value === value)?.label ?? null)
    : null;
  const hasCustomValue = Boolean(value && !optionLabel);
  const customOptionLabel = value ? `${formatTimeLabel(value)} (custom)` : null;
  const selectableOptions = useMemo(() => {
    const nextOptions = options.map((option) => ({
      label: option.label,
      value: option.value,
    }));
    if (hasCustomValue && customOptionLabel && value) {
      nextOptions.unshift({
        label: customOptionLabel,
        value,
      });
    }
    return nextOptions;
  }, [customOptionLabel, hasCustomValue, options, value]);

  useEffect(() => {
    if (!open) return;
    const defaultHighlightedValue =
      value ??
      selectableOptions.find((option) => option.value === DEFAULT_TIME_VALUE)
        ?.value ??
      selectableOptions[0]?.value ??
      null;
    setHighlightedValue(defaultHighlightedValue);
  }, [open, selectableOptions, value]);

  useEffect(() => {
    if (!open || !highlightedValue) return;
    optionRefs.current[highlightedValue]?.scrollIntoView({ block: "nearest" });
  }, [highlightedValue, open]);

  const commitSelection = (nextValue: string) => {
    onChange(nextValue);
    setDraft(getTimeSegmentDraft(nextValue));
    setEditError(null);
    setOpen(false);
  };

  const focusSegment = (segment: keyof TimeSegmentDraft) => {
    const nextInput = inputRefs.current[segment];
    nextInput?.focus();
    nextInput?.select();
  };

  const commitDraft = (nextDraft: TimeSegmentDraft) => {
    const normalized = normalizeSegmentedTimeInput(nextDraft);
    if (normalized === "") {
      if (allowEmpty) {
        onChange("");
        setDraft({ hour: "", minute: "", meridiem: "" });
        setEditError(null);
        setOpen(false);
        return;
      }
      setEditError("Enter time as HH:MM A/P.");
      return;
    }
    if (!normalized) {
      setEditError("Enter time as HH:MM A/P.");
      return;
    }
    onChange(normalized);
    setDraft(getTimeSegmentDraft(normalized));
    setEditError(null);
    setOpen(false);
  };

  const resetDraft = () => {
    setDraft(getTimeSegmentDraft(value));
    setEditError(null);
    setOpen(false);
  };

  const commitDraftOnExit = () => {
    const normalized = normalizeSegmentedTimeInput(draft);
    if (normalized === "") {
      if (allowEmpty) {
        onChange("");
        setDraft({ hour: "", minute: "", meridiem: "" });
      } else {
        setDraft(getTimeSegmentDraft(value));
      }
      setEditError(null);
      setOpen(false);
      return;
    }
    if (!normalized) {
      resetDraft();
      return;
    }
    onChange(normalized);
    setDraft(getTimeSegmentDraft(normalized));
    setEditError(null);
    setOpen(false);
  };

  const updateDraftSegment = (
    segment: keyof TimeSegmentDraft,
    nextRawValue: string,
  ) => {
    const sanitizedValue =
      segment === "meridiem"
        ? nextRawValue
            .replace(/[^ap]/gi, "")
            .slice(-1)
            .toUpperCase()
            .replace("A", "AM")
            .replace("P", "PM")
        : nextRawValue.replace(/\D/g, "").slice(0, 2);
    const nextDraft: TimeSegmentDraft = {
      ...draft,
      [segment]: sanitizedValue,
    };
    setDraft(nextDraft);
    setEditError(null);
    setOpen(true);

    if (segment === "hour" && sanitizedValue.length === 2) {
      focusSegment("minute");
    }
    if (segment === "minute" && sanitizedValue.length === 2) {
      focusSegment("meridiem");
    }

    const normalized = normalizeSegmentedTimeInput(nextDraft);
    if (normalized) {
      onChange(normalized);
      setDraft(getTimeSegmentDraft(normalized));
    }
  };

  const nudgeSegment = (segment: keyof TimeSegmentDraft, direction: 1 | -1) => {
    const nextDraft = cycleTimeSegmentValue(draft, segment, direction);
    setDraft(nextDraft);
    setEditError(null);
    setOpen(true);
    const normalized = normalizeSegmentedTimeInput(nextDraft);
    if (normalized) {
      onChange(normalized);
      setDraft(getTimeSegmentDraft(normalized));
    }
  };

  const commitAndClose = (activeElement?: HTMLInputElement | null) => {
    commitDraft(draft);
    if (normalizeSegmentedTimeInput(draft)) {
      activeElement?.blur();
    }
  };

  return (
    <div className="relative inline-flex min-w-0" ref={containerRef}>
      <div
        className={
          "border-outline-muted bg-surface-muted text-ink-primary hover:border-outline-strong focus-within:ring-accent-strong inline-flex min-h-[2.5rem] items-center gap-0.5 rounded-md border px-1.5 py-1 text-sm transition focus-within:ring-2 " +
          (invalid ? "border-status-danger text-status-danger" : "")
        }
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            nextTarget instanceof Node &&
            containerRef.current?.contains(nextTarget)
          ) {
            return;
          }
          commitDraftOnExit();
        }}
      >
        <input
          ref={(node) => {
            inputRefs.current.hour = node;
          }}
          type="text"
          inputMode="numeric"
          placeholder="HH"
          value={draft.hour}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => updateDraftSegment("hour", event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowRight" &&
              event.currentTarget.selectionStart ===
                event.currentTarget.value.length
            ) {
              event.preventDefault();
              focusSegment("minute");
            } else if (event.key === "Backspace" && !draft.hour) {
              event.preventDefault();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              nudgeSegment("hour", event.key === "ArrowUp" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              commitAndClose(event.currentTarget);
            } else if (event.key === "Tab") {
              setOpen(false);
            } else if (event.key === "Escape") {
              event.preventDefault();
              resetDraft();
              event.currentTarget.blur();
            }
          }}
          aria-label={`${placeholder} hour`}
          className="focus-visible:bg-accent-muted/70 text-ink-primary placeholder:text-ink-muted w-4 rounded px-0 py-1.5 text-center leading-tight tabular-nums outline-none"
        />
        <span className="text-ink-subtle shrink-0">:</span>
        <input
          ref={(node) => {
            inputRefs.current.minute = node;
          }}
          type="text"
          inputMode="numeric"
          placeholder="MM"
          value={draft.minute}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => updateDraftSegment("minute", event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowLeft" &&
              event.currentTarget.selectionStart === 0
            ) {
              event.preventDefault();
              focusSegment("hour");
            } else if (
              event.key === "ArrowRight" &&
              event.currentTarget.selectionStart ===
                event.currentTarget.value.length
            ) {
              event.preventDefault();
              focusSegment("meridiem");
            } else if (event.key === "Backspace" && !draft.minute) {
              event.preventDefault();
              focusSegment("hour");
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              nudgeSegment("minute", event.key === "ArrowUp" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              commitAndClose(event.currentTarget);
            } else if (event.key === "Tab") {
              setOpen(false);
            } else if (event.key === "Escape") {
              event.preventDefault();
              resetDraft();
              event.currentTarget.blur();
            }
          }}
          aria-label={`${placeholder} minute`}
          className="focus-visible:bg-accent-muted/70 text-ink-primary placeholder:text-ink-muted w-5 rounded px-0 py-1.5 text-center leading-tight tabular-nums outline-none"
        />
        <input
          ref={(node) => {
            inputRefs.current.meridiem = node;
          }}
          type="text"
          inputMode="text"
          placeholder="AM"
          value={draft.meridiem}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) =>
            updateDraftSegment("meridiem", event.target.value)
          }
          onKeyDown={(event) => {
            if (
              event.key === "ArrowLeft" &&
              event.currentTarget.selectionStart === 0
            ) {
              event.preventDefault();
              focusSegment("minute");
            } else if (event.key === "Backspace" && !draft.meridiem) {
              event.preventDefault();
              focusSegment("minute");
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              nudgeSegment("meridiem", event.key === "ArrowUp" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              commitAndClose(event.currentTarget);
            } else if (event.key === "Tab") {
              setOpen(false);
            } else if (event.key === "Escape") {
              event.preventDefault();
              resetDraft();
              event.currentTarget.blur();
            }
          }}
          aria-label={`${placeholder} meridiem`}
          className="focus-visible:bg-accent-muted/70 text-ink-primary placeholder:text-ink-muted w-6.5 rounded px-0 py-1.5 text-center leading-tight font-medium outline-none"
        />
        <button
          type="button"
          className="text-ink-muted hover:text-ink-primary shrink-0 transition"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              resetDraft();
              return;
            }
            setOpen(true);
            focusSegment("hour");
          }}
          aria-label={`Toggle ${placeholder} time options`}
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {editError && (
        <div className="text-status-danger mt-1 text-xs">{editError}</div>
      )}
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="border-outline-strong bg-surface-overlay/95 scrollbar-hidden absolute top-full left-0 z-40 mt-1 max-h-60 min-w-full overflow-y-auto rounded-lg border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
        >
          {selectableOptions.map((option) => {
            const active = option.value === value;
            const highlighted = option.value === highlightedValue;
            return (
              <button
                key={option.value}
                type="button"
                id={`${listboxId}-${option.value}`}
                role="option"
                aria-selected={highlighted}
                tabIndex={-1}
                ref={(node) => {
                  optionRefs.current[option.value] = node;
                }}
                className={
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition " +
                  (highlighted || active
                    ? "bg-accent-muted text-ink-primary font-medium"
                    : "text-ink-subtle hover:bg-surface-muted")
                }
                onMouseEnter={() => setHighlightedValue(option.value)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setHighlightedValue(option.value);
                  commitSelection(option.value);
                }}
              >
                <span>
                  {option.value === value && hasCustomValue && customOptionLabel
                    ? customOptionLabel
                    : option.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  defaultDate: Date;
  calendarId?: number;
  visibleCalendarIds?: number[];
  calendars?: Array<{
    id: number;
    name: string;
    color: string;
    isPersonal: boolean;
    canWrite: boolean;
  }>;
  event?: RouterOutputs["event"]["list"][number] | null;
};

type AssigneeSelection = {
  profileId: number;
  displayName: string;
  email: string;
  username?: string | null;
};
type ProfileEditTarget =
  | { type: "assignee"; profile: AssigneeSelection }
  | { type: "attendee"; profile: AssigneeSelection }
  | { type: "coOwner"; profile: AssigneeSelection };
type ContactConflict = RouterOutputs["profile"]["findContactConflicts"][number];
const profileAffiliationOptions = [
  { value: "staff", label: "Staff" },
  { value: "faculty", label: "Faculty" },
  { value: "student", label: "Student" },
] as const;
type ProfileDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  affiliation: (typeof profileAffiliationOptions)[number]["value"];
};

type NewEventDraft = {
  version: 2;
  title: string;
  selectedCalendarId: number | null;
  selectedCalendarIds: number[];
  segments: Array<{ start: string; end: string }>;
  allDay: boolean;
  location: string;
  isVirtual: boolean;
  selectedBuildingId: number | null;
  selectedBuildingAcronym: string;
  roomNumber: string;
  locationRooms: Array<{
    roomId: number;
    buildingId: number;
    buildingName: string;
    acronym: string;
    roomNumber: string;
  }>;
  description: string;
  recurring: boolean;
  participantCount: string;
  technicianNeeded: boolean;
  requestCategory: RequestCategoryValue | "";
  requestDetails: EventRequestDetails | null;
  zendeskTicket: string;
  eventInfoStart: string | null;
  eventInfoEnd: string | null;
  setupInfoTime: string | null;
  assignee: AssigneeSelection | null;
  selectedAttendees: AssigneeSelection[];
  selectedCoOwners: AssigneeSelection[];
  hourLogs: Array<{ start: string | null; end: string | null }>;
};

type LegacyNewEventDraft = Omit<NewEventDraft, "version" | "requestDetails"> & {
  version: 1;
  equipmentNeeded: string;
};

const emptyProfileDraft: ProfileDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  affiliation: "staff",
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
    affiliation: "staff",
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
  const fullName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) return fullName;
  return profile.email;
}

function fallbackSearchLabel(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toAssigneeSelection(profile: {
  profileId: number;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email: string;
  username?: string | null;
}): AssigneeSelection {
  return {
    profileId: profile.profileId,
    displayName: resolveProfileLabel(profile),
    email: profile.email,
    username: profile.username ?? null,
  };
}

function formatPhoneInput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return hasPlus ? "+" : "";
  const normalized =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length <= 3) return (hasPlus ? "+" : "") + normalized;
  if (normalized.length <= 6) {
    return (
      (hasPlus ? "+" : "") +
      `(${normalized.slice(0, 3)}) ${normalized.slice(3)}`
    );
  }
  const line = normalized.slice(6, 10);
  return (
    (hasPlus ? "+" : "") +
    `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${line}`
  );
}

function parseDraftDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getWritableCalendarIds(
  calendars?: Array<{ id: number; canWrite: boolean }>,
) {
  return (calendars ?? [])
    .filter((calendar) => calendar.canWrite)
    .map((calendar) => calendar.id);
}

function getVisibleWritableCalendarIds(
  writableCalendarIds: number[],
  visibleCalendarIds?: number[],
) {
  return writableCalendarIds.filter((id) =>
    (visibleCalendarIds ?? []).includes(id),
  );
}

function readNewEventDraft(): NewEventDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const currentRaw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw) as Partial<NewEventDraft>;
      if (parsed.version === 2) return parsed as NewEventDraft;
    }
    const legacyRaw = window.sessionStorage.getItem(LEGACY_DRAFT_STORAGE_KEY);
    if (!legacyRaw) return null;
    const parsed = JSON.parse(legacyRaw) as Partial<LegacyNewEventDraft>;
    if (parsed.version !== 1) return null;
    const legacyDraft = parsed as LegacyNewEventDraft;
    return {
      ...legacyDraft,
      version: 2,
      requestDetails: legacyDraft.equipmentNeeded
        ? {
            version: 1,
            equipmentNeededText: legacyDraft.equipmentNeeded,
          }
        : null,
    };
  } catch {
    return null;
  }
}

function getEditEventDraftKey(eventId: number) {
  return `${EDIT_DRAFT_STORAGE_PREFIX}:${eventId}`;
}

function readEditEventDraft(eventId: number): NewEventDraft | null {
  if (typeof window === "undefined") return null;
  if (!Number.isFinite(eventId)) return null;
  try {
    const currentRaw = window.sessionStorage.getItem(
      getEditEventDraftKey(eventId),
    );
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw) as Partial<NewEventDraft>;
      if (parsed.version === 2) return parsed as NewEventDraft;
    }
    const legacyRaw = window.sessionStorage.getItem(
      `${LEGACY_EDIT_DRAFT_STORAGE_PREFIX}:${eventId}`,
    );
    if (!legacyRaw) return null;
    const parsed = JSON.parse(legacyRaw) as Partial<LegacyNewEventDraft>;
    if (parsed.version !== 1) return null;
    const legacyDraft = parsed as LegacyNewEventDraft;
    return {
      ...legacyDraft,
      version: 2,
      requestDetails: legacyDraft.equipmentNeeded
        ? {
            version: 1,
            equipmentNeededText: legacyDraft.equipmentNeeded,
          }
        : null,
    };
  } catch {
    return null;
  }
}

function writeNewEventDraft(draft: NewEventDraft) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    window.sessionStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function writeEditEventDraft(eventId: number, draft: NewEventDraft) {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(eventId)) return;
  try {
    window.sessionStorage.setItem(
      getEditEventDraftKey(eventId),
      JSON.stringify(draft),
    );
    window.sessionStorage.removeItem(
      `${LEGACY_EDIT_DRAFT_STORAGE_PREFIX}:${eventId}`,
    );
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function clearNewEventDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    window.sessionStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function clearEditEventDraft(eventId: number) {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(eventId)) return;
  try {
    window.sessionStorage.removeItem(getEditEventDraftKey(eventId));
    window.sessionStorage.removeItem(
      `${LEGACY_EDIT_DRAFT_STORAGE_PREFIX}:${eventId}`,
    );
  } catch {
    // Ignore storage failures.
  }
}

function getQuickCreateErrorMessage(err: unknown) {
  if (err instanceof TRPCClientError) {
    const zodError = (err as TRPCClientError<AppRouter>).data?.zodError;
    const fieldErrors = zodError?.fieldErrors ?? {};
    if (fieldErrors.firstName?.length) return "First name is required.";
    if (fieldErrors.lastName?.length) return "Last name is required.";
    if (fieldErrors.email?.length) return "Enter a valid email address.";
    if (zodError?.formErrors?.length)
      return zodError.formErrors[0] ?? err.message;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Failed to save profile.";
}

export function NewEventDialog({
  open,
  onClose,
  defaultDate,
  calendarId,
  visibleCalendarIds,
  calendars,
  event,
}: Props) {
  const utils = api.useUtils();
  const create = api.event.create.useMutation();
  const update = api.event.update.useMutation();
  const deleteMutation = api.event.delete.useMutation({
    onSuccess: async () => {
      await utils.event.invalidate();
      if (event) {
        clearEditEventDraft(event.id);
      }
      onClose();
    },
  });
  const isEditing = Boolean(event);

  const [title, setTitle] = useState("");
  const [selectedCalendarId, setSelectedCalendarId] = useState<number | null>(
    calendarId ?? null,
  );
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<number[]>([]);
  const [segments, setSegments] = useState<Segment[]>(() => [
    makeSegment(defaultDate),
  ]);
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [isVirtual, setIsVirtual] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(
    null,
  );
  const [selectedBuildingAcronym, setSelectedBuildingAcronym] =
    useState<string>("");
  const [roomNumber, setRoomNumber] = useState<string>("");
  const [generalLocationSearch, setGeneralLocationSearch] = useState("");
  const [selectedRooms, setSelectedRooms] = useState<LocationMatch[]>([]);
  const [description, setDescription] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [participantCount, setParticipantCount] = useState("");
  const [technicianNeeded, setTechnicianNeeded] = useState(false);
  const [requestCategory, setRequestCategory] = useState<
    RequestCategoryValue | ""
  >("");
  const [selectedEquipmentNeeded, setSelectedEquipmentNeeded] = useState<
    EquipmentNeededOption[]
  >([]);
  const [equipmentOtherDetails, setEquipmentOtherDetails] = useState("");
  const [selectedEventTypes, setSelectedEventTypes] = useState<
    EventTypeOption[]
  >([]);
  const [eventTypeOtherDetails, setEventTypeOtherDetails] = useState("");
  const [zendeskTicket, setZendeskTicket] = useState("");
  const [eventInfoStart, setEventInfoStart] = useState<Date | null>(null);
  const [eventInfoEnd, setEventInfoEnd] = useState<Date | null>(null);
  const [setupInfoTime, setSetupInfoTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<AssigneeSelection | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [selectedAttendees, setSelectedAttendees] = useState<
    AssigneeSelection[]
  >([]);
  const [selectedCoOwners, setSelectedCoOwners] = useState<AssigneeSelection[]>(
    [],
  );
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [attendeeQuery, setAttendeeQuery] = useState("");
  const [coOwnerSearch, setCoOwnerSearch] = useState("");
  const [coOwnerQuery, setCoOwnerQuery] = useState("");
  const [assigneeHighlight, setAssigneeHighlight] = useState(-1);
  const [attendeeHighlight, setAttendeeHighlight] = useState(-1);
  const [coOwnerHighlight, setCoOwnerHighlight] = useState(-1);
  const [assigneeFocused, setAssigneeFocused] = useState(false);
  const [attendeeFocused, setAttendeeFocused] = useState(false);
  const [coOwnerFocused, setCoOwnerFocused] = useState(false);
  const [autoAssignPending, setAutoAssignPending] = useState(false);
  const [quickCreateTarget, setQuickCreateTarget] = useState<
    "assignee" | "attendee" | "coOwner" | null
  >(null);
  const [profileEditTarget, setProfileEditTarget] =
    useState<ProfileEditTarget | null>(null);
  const [quickCreateDraft, setQuickCreateDraft] =
    useState<ProfileDraft>(emptyProfileDraft);
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [duplicateContactMatches, setDuplicateContactMatches] = useState<
    ContactConflict[]
  >([]);
  const [showDuplicateContactConfirm, setShowDuplicateContactConfirm] =
    useState(false);
  const [hourLogs, setHourLogs] = useState<HourLogDraft[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [addRoomError, setAddRoomError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const specificLocationWrapRef = useRef<HTMLDivElement | null>(null);
  const generalLocationWrapRef = useRef<HTMLDivElement | null>(null);
  const attendeeSearchWrapRef = useRef<HTMLDivElement | null>(null);
  const assigneeSearchWrapRef = useRef<HTMLDivElement | null>(null);
  const coOwnerSearchWrapRef = useRef<HTMLDivElement | null>(null);
  const quickCreatePanelRef = useRef<HTMLDivElement | null>(null);
  const deleteConfirmRef = useRef<HTMLDivElement | null>(null);
  const duplicateConfirmRef = useRef<HTMLDivElement | null>(null);
  const skipNextDraftPersistRef = useRef(false);
  const logBaseDate = useMemo(
    () => startOfDay(event ? new Date(event.startDatetime) : defaultDate),
    [event, defaultDate],
  );
  const infoBaseDate = useMemo(
    () => (segments[0] ? new Date(segments[0].start) : new Date(defaultDate)),
    [segments, defaultDate],
  );
  const zendeskTicketError =
    zendeskTicket.trim().length > 0 &&
    !ZENDESK_TICKET_REGEX.test(zendeskTicket.trim())
      ? "Zendesk ticket must be exactly 6 digits."
      : null;
  const { status: sessionStatus } = useSession();
  const hasAuthenticatedSession = sessionStatus === "authenticated";
  const currentProfile = api.profile.me.useQuery(undefined, {
    enabled: open && hasAuthenticatedSession,
  });
  const editingProfileDetails = api.profile.getById.useQuery(
    {
      profileId: profileEditTarget?.profile.profileId ?? 0,
    },
    {
      enabled: open && hasAuthenticatedSession && profileEditTarget !== null,
    },
  );
  const requestDetails = useMemo(
    () =>
      buildEventRequestDetailsV2({
        selectedEquipment: selectedEquipmentNeeded,
        equipmentOtherDetails,
        selectedEventTypes,
        eventTypeOtherDetails,
      }),
    [
      equipmentOtherDetails,
      eventTypeOtherDetails,
      selectedEquipmentNeeded,
      selectedEventTypes,
    ],
  );
  const equipmentNeeded = useMemo(
    () => formatLegacyEquipmentNeededText(requestDetails) ?? "",
    [requestDetails],
  );
  const equipmentOptionColumns = useMemo(
    () => splitOptionsIntoColumns(EQUIPMENT_NEEDED_OPTIONS, 2),
    [],
  );
  const eventTypeOptionColumns = useMemo(
    () => splitOptionsIntoColumns(EVENT_TYPE_OPTIONS, 2),
    [],
  );
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
      const label = new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(
        [],
        { hour: "numeric", minute: "2-digit" },
      );
      opts.push({ value, label });
    }
    return opts;
  }, []);
  const showEquipmentAdditionalInformation =
    selectedEquipmentNeeded.includes("Other");
  const showEventTypeOtherDetails = selectedEventTypes.includes("Other");

  function toggleEquipmentNeeded(option: EquipmentNeededOption) {
    setSelectedEquipmentNeeded((current) => {
      if (current.includes(option)) {
        return current.filter((value) => value !== option);
      }
      return [...current, option];
    });
    if (option === "Other" && showEquipmentAdditionalInformation) {
      setEquipmentOtherDetails("");
    }
  }

  function toggleEventType(option: EventTypeOption) {
    setSelectedEventTypes((current) => {
      if (current.includes(option)) {
        return current.filter((value) => value !== option);
      }
      return [...current, option];
    });
    if (option === "Other" && showEventTypeOtherDetails) {
      setEventTypeOtherDetails("");
    }
  }

  useEffect(() => {
    if (!open) return;
    skipNextDraftPersistRef.current = true;
    setSubmitAttempted(false);
    setShowDeleteConfirm(false);
    setShowDuplicateContactConfirm(false);
    setDuplicateContactMatches([]);
    const preferred = getWritableCalendarIds(calendars);
    const visiblePreferred = getVisibleWritableCalendarIds(
      preferred,
      visibleCalendarIds,
    );
    if (event) {
      const editDraft = readEditEventDraft(event.id);
      if (editDraft) {
        const writableIds = new Set(
          (calendars ?? []).filter((c) => c.canWrite).map((c) => c.id),
        );
        const draftCalendarIds = Array.isArray(editDraft.selectedCalendarIds)
          ? editDraft.selectedCalendarIds.filter((id) => writableIds.has(id))
          : [];
        const draftCalendarId =
          typeof editDraft.selectedCalendarId === "number" &&
          writableIds.has(editDraft.selectedCalendarId)
            ? editDraft.selectedCalendarId
            : (draftCalendarIds[0] ?? null);
        const fallbackCalendarId =
          draftCalendarId ??
          event.calendarId ??
          calendarId ??
          visiblePreferred[0] ??
          preferred[0] ??
          null;
        const initialSelections =
          draftCalendarIds.length > 0
            ? draftCalendarIds
            : fallbackCalendarId
              ? [fallbackCalendarId]
              : [];
        const nextSegments = Array.isArray(editDraft.segments)
          ? editDraft.segments
              .map((segment) => {
                const start = parseDraftDate(segment?.start);
                const end = parseDraftDate(segment?.end);
                if (!start || !end) return null;
                return { id: randomId(), start, end };
              })
              .filter((segment): segment is Segment => Boolean(segment))
          : [];
        const nextRequestCategory = REQUEST_CATEGORY_OPTIONS.some(
          (opt) => opt.value === editDraft.requestCategory,
        )
          ? editDraft.requestCategory
          : "";
        setTitle(editDraft.title ?? "");
        setSegments(
          nextSegments.length > 0
            ? nextSegments
            : [
                {
                  id: randomId(),
                  start: new Date(event.startDatetime),
                  end: new Date(event.endDatetime),
                },
              ],
        );
        setAllDay(Boolean(editDraft.allDay));
        setLocation(editDraft.location ?? "");
        setGeneralLocationSearch(editDraft.location ?? "");
        setIsVirtual(Boolean(editDraft.isVirtual));
        setSelectedBuildingId(
          typeof editDraft.selectedBuildingId === "number"
            ? editDraft.selectedBuildingId
            : null,
        );
        setSelectedBuildingAcronym(editDraft.selectedBuildingAcronym ?? "");
        setRoomNumber(editDraft.roomNumber ?? "");
        setSelectedRooms(
          Array.isArray(editDraft.locationRooms) ? editDraft.locationRooms : [],
        );
        setDescription(editDraft.description ?? "");
        setRecurring(Boolean(editDraft.recurring));
        setParticipantCount(editDraft.participantCount ?? "");
        setTechnicianNeeded(Boolean(editDraft.technicianNeeded));
        setRequestCategory(nextRequestCategory);
        const parsedEquipmentDetails = toEventRequestFormState(
          editDraft.requestDetails,
        );
        setSelectedEquipmentNeeded(parsedEquipmentDetails.selectedEquipment);
        setEquipmentOtherDetails(parsedEquipmentDetails.equipmentOtherDetails);
        setSelectedEventTypes(parsedEquipmentDetails.selectedEventTypes);
        setEventTypeOtherDetails(parsedEquipmentDetails.eventTypeOtherDetails);
        setZendeskTicket(editDraft.zendeskTicket ?? "");
        setEventInfoStart(parseDraftDate(editDraft.eventInfoStart));
        setEventInfoEnd(parseDraftDate(editDraft.eventInfoEnd));
        setSetupInfoTime(parseDraftDate(editDraft.setupInfoTime));
        setError(null);
        setAssignee(editDraft.assignee ?? null);
        setAssigneeSearch("");
        setAssigneeQuery("");
        setSelectedAttendees(
          Array.isArray(editDraft.selectedAttendees)
            ? editDraft.selectedAttendees
            : [],
        );
        setAttendeeSearch("");
        setAttendeeQuery("");
        setSelectedCoOwners(
          Array.isArray(editDraft.selectedCoOwners)
            ? editDraft.selectedCoOwners
            : [],
        );
        setCoOwnerSearch("");
        setCoOwnerQuery("");
        setQuickCreateTarget(null);
        setQuickCreateDraft(emptyProfileDraft);
        setQuickCreateError(null);
        setSelectedCalendarId(fallbackCalendarId);
        setSelectedCalendarIds(initialSelections);
        setHourLogs(
          Array.isArray(editDraft.hourLogs)
            ? editDraft.hourLogs.map((log) => ({
                id: randomId(),
                start: parseDraftDate(log?.start),
                end: parseDraftDate(log?.end),
              }))
            : (event.hourLogs?.map((log) => ({
                id: randomId(),
                sourceId: log.id,
                start: log.startTime ? new Date(log.startTime) : null,
                end: log.endTime ? new Date(log.endTime) : null,
              })) ?? []),
        );
        return;
      }
      setTitle(event.title);
      setSegments([
        {
          id: randomId(),
          start: new Date(event.startDatetime),
          end: new Date(event.endDatetime),
        },
      ]);
      setAllDay(event.isAllDay);
      const eventLocations = Array.isArray(event.locations)
        ? event.locations
        : [];
      const hasLocations = eventLocations.length > 0;
      setLocation(hasLocations ? "" : (event.location ?? ""));
      setGeneralLocationSearch(hasLocations ? "" : (event.location ?? ""));
      setIsVirtual(Boolean(event.isVirtual));
      setSelectedBuildingId(event.buildingId ?? null);
      setSelectedRooms(eventLocations);
      if (!hasLocations) {
        const parsed = parseLocationInput(event.location ?? "");
        if (parsed.acronym) setSelectedBuildingAcronym(parsed.acronym);
        if (parsed.room) setRoomNumber(parsed.room);
      }
      setDescription(event.description ?? "");
      setRecurring(Boolean(event.recurrenceRule));
      setParticipantCount(
        typeof event.participantCount === "number"
          ? String(event.participantCount)
          : "",
      );
      setTechnicianNeeded(Boolean(event.technicianNeeded));
      setRequestCategory(event.requestCategory ?? "");
      const parsedEquipmentDetails = toEventRequestFormState(
        event.requestDetails ?? event.equipmentNeeded,
      );
      setSelectedEquipmentNeeded(parsedEquipmentDetails.selectedEquipment);
      setEquipmentOtherDetails(parsedEquipmentDetails.equipmentOtherDetails);
      setSelectedEventTypes(parsedEquipmentDetails.selectedEventTypes);
      setEventTypeOtherDetails(parsedEquipmentDetails.eventTypeOtherDetails);
      setZendeskTicket(event.zendeskTicketNumber ?? "");
      setEventInfoStart(
        event.eventStartTime ? new Date(event.eventStartTime) : null,
      );
      setEventInfoEnd(event.eventEndTime ? new Date(event.eventEndTime) : null);
      setSetupInfoTime(event.setupTime ? new Date(event.setupTime) : null);
      setError(null);
      if (event.assigneeProfile) {
        setAssignee({
          profileId: event.assigneeProfile.id,
          displayName: resolveProfileLabel(event.assigneeProfile),
          email: event.assigneeProfile.email,
        });
        setAutoAssignPending(false);
      } else {
        setAssignee(null);
        setAutoAssignPending(false);
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
    const draft = readNewEventDraft();
    if (draft) {
      const writableIds = new Set(preferred);
      const draftCalendarIds = Array.isArray(draft.selectedCalendarIds)
        ? draft.selectedCalendarIds.filter((id) => writableIds.has(id))
        : [];
      const draftCalendarId =
        typeof draft.selectedCalendarId === "number" &&
        writableIds.has(draft.selectedCalendarId)
          ? draft.selectedCalendarId
          : (draftCalendarIds[0] ?? null);
      const initialSelections =
        visiblePreferred.length > 0
          ? visiblePreferred
          : draftCalendarIds.length > 0
            ? draftCalendarIds
            : [];
      const fallbackCalendarId =
        initialSelections[0] ??
        draftCalendarId ??
        calendarId ??
        preferred[0] ??
        null;
      const nextSegments = Array.isArray(draft.segments)
        ? draft.segments
            .map((segment) => {
              const start = parseDraftDate(segment?.start);
              const end = parseDraftDate(segment?.end);
              if (!start || !end) return null;
              return { id: randomId(), start, end };
            })
            .filter((segment): segment is Segment => Boolean(segment))
        : [];
      const nextRequestCategory = REQUEST_CATEGORY_OPTIONS.some(
        (opt) => opt.value === draft.requestCategory,
      )
        ? draft.requestCategory
        : "";
      setTitle(draft.title ?? "");
      setSegments(
        nextSegments.length > 0 ? nextSegments : [makeSegment(defaultDate)],
      );
      setAllDay(Boolean(draft.allDay));
      setLocation(draft.location ?? "");
      setGeneralLocationSearch(draft.location ?? "");
      setIsVirtual(Boolean(draft.isVirtual));
      setSelectedBuildingId(
        typeof draft.selectedBuildingId === "number"
          ? draft.selectedBuildingId
          : null,
      );
      setSelectedBuildingAcronym(draft.selectedBuildingAcronym ?? "");
      setRoomNumber(draft.roomNumber ?? "");
      setSelectedRooms(
        Array.isArray(draft.locationRooms) ? draft.locationRooms : [],
      );
      setDescription(draft.description ?? "");
      setRecurring(Boolean(draft.recurring));
      setParticipantCount(draft.participantCount ?? "");
      setTechnicianNeeded(Boolean(draft.technicianNeeded));
      setRequestCategory(nextRequestCategory);
      const parsedEquipmentDetails = toEventRequestFormState(
        draft.requestDetails,
      );
      setSelectedEquipmentNeeded(parsedEquipmentDetails.selectedEquipment);
      setEquipmentOtherDetails(parsedEquipmentDetails.equipmentOtherDetails);
      setSelectedEventTypes(parsedEquipmentDetails.selectedEventTypes);
      setEventTypeOtherDetails(parsedEquipmentDetails.eventTypeOtherDetails);
      setZendeskTicket(draft.zendeskTicket ?? "");
      setEventInfoStart(parseDraftDate(draft.eventInfoStart));
      setEventInfoEnd(parseDraftDate(draft.eventInfoEnd));
      setSetupInfoTime(parseDraftDate(draft.setupInfoTime));
      setError(null);
      setAssignee(draft.assignee ?? null);
      setAutoAssignPending(!draft.assignee);
      setAssigneeSearch("");
      setAssigneeQuery("");
      setSelectedAttendees(
        Array.isArray(draft.selectedAttendees) ? draft.selectedAttendees : [],
      );
      setAttendeeSearch("");
      setAttendeeQuery("");
      setSelectedCoOwners(
        Array.isArray(draft.selectedCoOwners) ? draft.selectedCoOwners : [],
      );
      setCoOwnerSearch("");
      setCoOwnerQuery("");
      setQuickCreateTarget(null);
      setQuickCreateDraft(emptyProfileDraft);
      setQuickCreateError(null);
      setSelectedCalendarId(initialSelections[0] ?? fallbackCalendarId);
      setSelectedCalendarIds(initialSelections);
      setHourLogs(
        Array.isArray(draft.hourLogs)
          ? draft.hourLogs.map((log) => ({
              id: randomId(),
              start: parseDraftDate(log?.start),
              end: parseDraftDate(log?.end),
            }))
          : [],
      );
      return;
    }
    const fallbackCalendarId =
      calendarId ?? visiblePreferred[0] ?? preferred[0] ?? null;
    const initialSelections =
      visiblePreferred.length > 0
        ? visiblePreferred
        : fallbackCalendarId
          ? [fallbackCalendarId]
          : [];
    setTitle("");
    setSegments([makeSegment(defaultDate)]);
    setAllDay(false);
    setLocation("");
    setIsVirtual(false);
    setSelectedBuildingId(null);
    setSelectedBuildingAcronym("");
    setRoomNumber("");
    setSelectedRooms([]);
    setDescription("");
    setRecurring(false);
    setParticipantCount("");
    setTechnicianNeeded(false);
    setRequestCategory("");
    setSelectedEquipmentNeeded([]);
    setEquipmentOtherDetails("");
    setSelectedEventTypes([]);
    setEventTypeOtherDetails("");
    setZendeskTicket("");
    setEventInfoStart(null);
    setEventInfoEnd(null);
    setSetupInfoTime(null);
    setError(null);
    setAssignee(
      currentProfile.data ? toAssigneeSelection(currentProfile.data) : null,
    );
    setAutoAssignPending(!currentProfile.data);
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
    setDuplicateContactMatches([]);
    setShowDuplicateContactConfirm(false);
    setSelectedCalendarId(fallbackCalendarId);
    setSelectedCalendarIds(initialSelections);
    setHourLogs([]);
  }, [
    open,
    defaultDate,
    event,
    calendarId,
    calendarOptions,
    calendars,
    visibleCalendarIds,
    currentProfile.data,
  ]);

  useEffect(() => {
    if (!open || !autoAssignPending || assignee || !currentProfile.data) return;
    setAssignee(toAssigneeSelection(currentProfile.data));
    setAutoAssignPending(false);
  }, [open, autoAssignPending, assignee, currentProfile.data]);

  useEffect(() => {
    if (!open) return;
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }
    const draft: NewEventDraft = {
      version: 2,
      title,
      selectedCalendarId,
      selectedCalendarIds,
      segments: segments.map((segment) => ({
        start: segment.start.toISOString(),
        end: segment.end.toISOString(),
      })),
      allDay,
      location,
      isVirtual,
      selectedBuildingId,
      selectedBuildingAcronym,
      roomNumber,
      locationRooms: selectedRooms.map((entry) => ({
        roomId: entry.roomId,
        buildingId: entry.buildingId,
        buildingName: entry.buildingName,
        acronym: entry.acronym,
        roomNumber: entry.roomNumber,
      })),
      description,
      recurring,
      participantCount,
      technicianNeeded,
      requestCategory,
      requestDetails,
      zendeskTicket,
      eventInfoStart: eventInfoStart ? eventInfoStart.toISOString() : null,
      eventInfoEnd: eventInfoEnd ? eventInfoEnd.toISOString() : null,
      setupInfoTime: setupInfoTime ? setupInfoTime.toISOString() : null,
      assignee,
      selectedAttendees,
      selectedCoOwners,
      hourLogs: hourLogs.map((log) => ({
        start: log.start ? log.start.toISOString() : null,
        end: log.end ? log.end.toISOString() : null,
      })),
    };
    if (event) {
      writeEditEventDraft(event.id, draft);
    } else {
      writeNewEventDraft(draft);
    }
  }, [
    open,
    event,
    title,
    selectedCalendarId,
    selectedCalendarIds,
    segments,
    allDay,
    location,
    isVirtual,
    selectedBuildingId,
    selectedBuildingAcronym,
    roomNumber,
    selectedRooms,
    description,
    recurring,
    participantCount,
    technicianNeeded,
    requestCategory,
    requestDetails,
    zendeskTicket,
    eventInfoStart,
    eventInfoEnd,
    setupInfoTime,
    assignee,
    selectedAttendees,
    selectedCoOwners,
    hourLogs,
  ]);

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

  const updateSegment = (
    id: string,
    updater: (current: Segment) => Segment,
  ) => {
    setSegments((prev) =>
      prev.map((segment) => (segment.id === id ? updater(segment) : segment)),
    );
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
    setSegments((prev) =>
      prev.length === 1 ? prev : prev.filter((segment) => segment.id !== id),
    );
  };

  const segmentsInvalid = segments.some(
    (segment) => segment.start >= segment.end,
  );
  const isSaving = isEditing ? update.isPending : create.isPending;
  const hourLogsIncomplete = hourLogs.some(
    (log) => Boolean(log.start) !== Boolean(log.end),
  );
  const hourLogsInvalid = hourLogs.some(
    (log) => log.start && log.end && log.end <= log.start,
  );
  const trimmedParticipantCount = participantCount.trim();
  const parsedParticipantCount =
    trimmedParticipantCount === ""
      ? null
      : /^[0-9]+$/.test(trimmedParticipantCount)
        ? Number.parseInt(trimmedParticipantCount, 10)
        : NaN;
  const participantCountInvalid =
    parsedParticipantCount !== null &&
    (Number.isNaN(parsedParticipantCount) ||
      parsedParticipantCount < 0 ||
      parsedParticipantCount > 100000);
  const titleMissing = title.trim().length === 0;
  const attendeeSelectionInvalid = selectedAttendees.length === 0;
  const buildingSelectionInvalid = !isVirtual && !selectedBuildingId;
  const showAttendeeSelectionError =
    submitAttempted && attendeeSelectionInvalid;
  const showTitleError = submitAttempted && titleMissing;
  const hasCalendar = Boolean(
    selectedCalendarId ?? calendarId ?? event?.calendarId,
  );
  const showCalendarError = submitAttempted && !hasCalendar;
  const showBuildingError = submitAttempted && buildingSelectionInvalid;
  const canSave =
    !segmentsInvalid &&
    !hourLogsInvalid &&
    !hourLogsIncomplete &&
    !participantCountInvalid &&
    !isSaving &&
    !deleteMutation.isPending;
  const dialogTitle = isEditing ? "Edit event" : "Create event";
  const primaryButtonLabel = isSaving
    ? "Saving..."
    : isEditing
      ? "Save changes"
      : "Save";
  const assigneeResults = api.profile.search.useQuery(
    { query: assigneeQuery, limit: 7 },
    { enabled: open && assigneeQuery.length > 1 },
  );
  const assigneeMatches = assigneeResults.data ?? [];
  const shouldShowAssigneeResults =
    assigneeFocused &&
    assigneeQuery.length > 1 &&
    quickCreateTarget === null &&
    profileEditTarget === null;
  const attendeeResults = api.profile.search.useQuery(
    { query: attendeeQuery, limit: 7 },
    { enabled: open && attendeeQuery.length > 1 },
  );
  const attendeeMatches = attendeeResults.data ?? [];
  const shouldShowAttendeeResults =
    attendeeFocused &&
    attendeeQuery.length > 1 &&
    quickCreateTarget === null &&
    profileEditTarget === null;
  const coOwnerResults = api.profile.search.useQuery(
    { query: coOwnerQuery, limit: 7 },
    { enabled: open && coOwnerQuery.length > 1 },
  );
  const coOwnerMatches = coOwnerResults.data ?? [];
  const shouldShowCoOwnerResults =
    coOwnerFocused &&
    coOwnerQuery.length > 1 &&
    quickCreateTarget === null &&
    profileEditTarget === null;
  const createProfile = api.profile.create.useMutation();
  const updateProfile = api.profile.update.useMutation();
  // Facilities data
  const buildingList = api.facility.listBuildings.useQuery(undefined, {
    enabled: open,
  });
  const [locationQuery, setLocationQuery] = useState("");
  const [activeLocationSearch, setActiveLocationSearch] = useState<
    "all" | "selected-building" | null
  >(null);

  useEffect(() => {
    if (!profileEditTarget || !editingProfileDetails.data) return;
    setQuickCreateDraft({
      firstName: editingProfileDetails.data.firstName,
      lastName: editingProfileDetails.data.lastName,
      email: editingProfileDetails.data.email,
      phoneNumber: formatPhoneInput(
        editingProfileDetails.data.phoneNumber ?? "",
      ),
      affiliation: editingProfileDetails.data.affiliation ?? "staff",
    });
  }, [editingProfileDetails.data, profileEditTarget]);
  const locationResults = api.facility.searchRooms.useQuery(
    {
      query: locationQuery,
      buildingId:
        activeLocationSearch === "selected-building"
          ? (selectedBuildingId ?? undefined)
          : undefined,
      limit: 7,
    },
    { enabled: open && locationQuery.length > 0 },
  );
  const locationMatches = locationResults.data ?? [];
  const [locationHighlight, setLocationHighlight] = useState(-1);
  const attendeeListboxId = useId();
  const assigneeListboxId = useId();
  const coOwnerListboxId = useId();
  const specificLocationListboxId = useId();
  const generalLocationListboxId = useId();
  const attendeeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const assigneeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const coOwnerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const locationOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const createRoom = api.facility.createRoom.useMutation({
    onSuccess: async () => {
      await utils.facility.searchRooms.invalidate();
      setAddRoomError(null);
      setLocationQuery("");
    },
    onError: (err) => {
      setAddRoomError(err.message ?? "Failed to add room.");
    },
  });

  useEffect(() => {
    if (!selectedBuildingId) return;
    const list = buildingList.data ?? [];
    const found = list.find((b) => b.id === selectedBuildingId);
    if (found) setSelectedBuildingAcronym(found.acronym);
  }, [selectedBuildingId, buildingList.data]);

  useEffect(() => {
    if (!selectedBuildingAcronym || selectedBuildingId) return;
    const match = (buildingList.data ?? []).find(
      (b) => b.acronym === selectedBuildingAcronym,
    );
    if (match) setSelectedBuildingId(match.id);
  }, [selectedBuildingAcronym, selectedBuildingId, buildingList.data]);

  // Location search + sync effects
  useEffect(() => {
    setLocationHighlight(-1);
  }, [roomNumber, generalLocationSearch, locationMatches.length]);

  useEffect(() => {
    if (addRoomError) setAddRoomError(null);
  }, [roomNumber, selectedBuildingId, addRoomError]);

  useEffect(() => {
    if (!locationQuery.length || !activeLocationSearch) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const activeWrap =
        activeLocationSearch === "selected-building"
          ? specificLocationWrapRef.current
          : generalLocationWrapRef.current;
      if (!activeWrap) return;
      if (!activeWrap.contains(target)) {
        setLocationQuery("");
        setActiveLocationSearch(null);
        setLocationHighlight(-1);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [locationQuery.length, activeLocationSearch]);

  useEffect(() => {
    const sourceValue =
      activeLocationSearch === "selected-building"
        ? roomNumber
        : activeLocationSearch === "all"
          ? generalLocationSearch
          : "";
    const handle = window.setTimeout(() => {
      const trimmed = sourceValue.trim();
      if (trimmed.length === 0) {
        setLocationQuery("");
        return;
      }
      setLocationQuery(trimmed);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [roomNumber, generalLocationSearch, activeLocationSearch]);
  const totalLoggedHours = hourLogs.reduce(
    (sum, log) => sum + diffHours(log.start, log.end),
    0,
  );
  const hourLogsValidationMessage = hourLogsInvalid
    ? "Each log's end time must be after its start time."
    : hourLogsIncomplete
      ? "Provide both a start and end time or remove the log."
      : null;
  const primarySegment = segments[0] ?? null;
  const fallbackEventInfoStart =
    eventInfoStart ?? (primarySegment ? new Date(primarySegment.start) : null);
  const fallbackEventInfoEnd =
    eventInfoEnd ?? (primarySegment ? new Date(primarySegment.end) : null);
  const fallbackSetupInfoTime =
    setupInfoTime ?? (primarySegment ? new Date(primarySegment.start) : null);
  const fallbackEventInfoStartValue = fallbackEventInfoStart
    ? formatTimeValue(fallbackEventInfoStart)
    : "";
  const fallbackEventInfoEndValue = fallbackEventInfoEnd
    ? formatTimeValue(fallbackEventInfoEnd)
    : "";
  const fallbackSetupInfoValue = fallbackSetupInfoTime
    ? formatTimeValue(fallbackSetupInfoTime)
    : "";

  useEffect(() => {
    setAssigneeHighlight(-1);
  }, [assigneeSearch, assigneeMatches.length]);

  useEffect(() => {
    setAttendeeHighlight(-1);
  }, [attendeeSearch, attendeeMatches.length]);

  useEffect(() => {
    setCoOwnerHighlight(-1);
  }, [coOwnerSearch, coOwnerMatches.length]);

  useEffect(() => {
    if (attendeeHighlight < 0) return;
    attendeeOptionRefs.current[attendeeHighlight]?.scrollIntoView({
      block: "nearest",
    });
  }, [attendeeHighlight]);

  useEffect(() => {
    if (assigneeHighlight < 0) return;
    assigneeOptionRefs.current[assigneeHighlight]?.scrollIntoView({
      block: "nearest",
    });
  }, [assigneeHighlight]);

  useEffect(() => {
    if (coOwnerHighlight < 0) return;
    coOwnerOptionRefs.current[coOwnerHighlight]?.scrollIntoView({
      block: "nearest",
    });
  }, [coOwnerHighlight]);

  useEffect(() => {
    if (locationHighlight < 0) return;
    locationOptionRefs.current[locationHighlight]?.scrollIntoView({
      block: "nearest",
    });
  }, [locationHighlight]);

  useEffect(() => {
    if (quickCreateTarget === null && profileEditTarget === null) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!quickCreatePanelRef.current) return;
      if (quickCreatePanelRef.current.contains(event.target as Node)) return;
      if (profileEditTarget !== null) {
        closeProfileEditor();
        return;
      }
      closeQuickCreate();
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileEditTarget, quickCreateTarget]);

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const addSelectedRoom = (match: LocationMatch) => {
    setSelectedRooms((prev) => {
      if (prev.some((entry) => entry.roomId === match.roomId)) return prev;
      return [...prev, match];
    });
  };

  const handleLocationSelect = (match: LocationMatch) => {
    setSelectedBuildingId(match.buildingId);
    setSelectedBuildingAcronym(match.acronym);
    addSelectedRoom(match);
    setLocation("");
    setGeneralLocationSearch("");
    setRoomNumber("");
    setLocationQuery("");
    setActiveLocationSearch(null);
    setLocationHighlight(-1);
  };

  const handleClearForm = () => {
    const preferred = getWritableCalendarIds(calendars);
    const visiblePreferred = getVisibleWritableCalendarIds(
      preferred,
      visibleCalendarIds,
    );
    const fallbackCalendarId =
      visiblePreferred[0] ?? calendarId ?? preferred[0] ?? null;
    const initialSelections =
      visiblePreferred.length > 0
        ? visiblePreferred
        : fallbackCalendarId
          ? [fallbackCalendarId]
          : [];
    setTitle("");
    setSegments([makeSegment(defaultDate)]);
    setAllDay(false);
    setLocation("");
    setIsVirtual(false);
    setSelectedBuildingId(null);
    setSelectedBuildingAcronym("");
    setRoomNumber("");
    setGeneralLocationSearch("");
    setActiveLocationSearch(null);
    setSelectedRooms([]);
    setDescription("");
    setRecurring(false);
    setParticipantCount("");
    setTechnicianNeeded(false);
    setRequestCategory("");
    setSelectedEquipmentNeeded([]);
    setEquipmentOtherDetails("");
    setSelectedEventTypes([]);
    setEventTypeOtherDetails("");
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
    setSelectedCalendarId(fallbackCalendarId);
    setSelectedCalendarIds(initialSelections);
    setHourLogs([]);
    clearNewEventDraft();
  };

  const handleAddRoom = async () => {
    if (createRoom.isPending) return;
    if (!selectedBuildingId) {
      setAddRoomError("Select a building to add this room.");
      return;
    }
    const nextRoom = roomNumber.trim().toUpperCase();
    if (!nextRoom) {
      setAddRoomError("Enter a room number to add.");
      return;
    }
    setAddRoomError(null);
    const searchQuery = nextRoom;
    const matches = await utils.facility.searchRooms.fetch({
      query: searchQuery,
      buildingId: selectedBuildingId,
      limit: 5,
    });
    const existing = matches.find(
      (match) =>
        match.buildingId === selectedBuildingId &&
        match.roomNumber.toUpperCase() === nextRoom,
    );
    if (existing) {
      addSelectedRoom(existing);
      setRoomNumber("");
      return;
    }
    const created = await createRoom.mutateAsync({
      buildingId: selectedBuildingId,
      roomNumber: nextRoom,
    });
    const building = (buildingList.data ?? []).find(
      (entry) => entry.id === selectedBuildingId,
    );
    if (!building) {
      setAddRoomError("Building could not be resolved for the new room.");
      return;
    }
    addSelectedRoom({
      roomId: created.id,
      buildingId: selectedBuildingId,
      buildingName: building.name,
      acronym: building.acronym,
      roomNumber: nextRoom,
    });
    setRoomNumber("");
  };

  const addHourLogRow = () => {
    setHourLogs((prev) => {
      const last = prev[prev.length - 1];
      const fallbackStart = last?.end ?? logBaseDate;
      const start = fallbackStart
        ? new Date(fallbackStart)
        : new Date(logBaseDate);
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

  const handleHourLogChange = (
    id: string,
    field: "start" | "end",
    value: string,
  ) => {
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

  const handleSelectAssignee = (
    option: RouterOutputs["profile"]["search"][number],
  ) => {
    if (assignee && assignee.profileId !== option.profileId) {
      handleAddCoOwner(option);
      setAssigneeSearch("");
      setAssigneeQuery("");
      return;
    }
    setAutoAssignPending(false);
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
    setAutoAssignPending(false);
    setAssignee(null);
    setAssigneeSearch("");
    setAssigneeQuery("");
  };

  const handleAddAttendee = (
    option: RouterOutputs["profile"]["search"][number] | AssigneeSelection,
  ) => {
    setSelectedAttendees((prev) => {
      if (prev.some((entry) => entry.profileId === option.profileId))
        return prev;
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
    setSelectedAttendees((prev) =>
      prev.filter((entry) => entry.profileId !== profileId),
    );
  };

  const handleAddCoOwner = (
    option: RouterOutputs["profile"]["search"][number] | AssigneeSelection,
  ) => {
    if (assignee?.profileId === option.profileId) {
      setCoOwnerSearch("");
      setCoOwnerQuery("");
      return;
    }
    setSelectedCoOwners((prev) => {
      if (prev.some((entry) => entry.profileId === option.profileId))
        return prev;
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
    setSelectedCoOwners((prev) =>
      prev.filter((entry) => entry.profileId !== profileId),
    );
  };

  const closeQuickCreate = () => {
    setQuickCreateTarget(null);
    setQuickCreateDraft(emptyProfileDraft);
    setQuickCreateError(null);
    setDuplicateContactMatches([]);
    setShowDuplicateContactConfirm(false);
  };

  const closeProfileEditor = () => {
    setProfileEditTarget(null);
    setQuickCreateDraft(emptyProfileDraft);
    setQuickCreateError(null);
  };

  const openQuickCreate = (
    target: "assignee" | "attendee" | "coOwner",
    seed?: string,
  ) => {
    setProfileEditTarget(null);
    const source =
      seed ??
      (target === "assignee"
        ? assigneeSearch
        : target === "coOwner"
          ? coOwnerSearch
          : attendeeSearch);
    const derived = deriveProfileDraft(source);
    setQuickCreateTarget(target);
    setQuickCreateDraft({
      ...emptyProfileDraft,
      ...derived,
    });
    setQuickCreateError(null);
  };

  const openProfileEditor = (target: ProfileEditTarget) => {
    setQuickCreateTarget(null);
    setShowDuplicateContactConfirm(false);
    setDuplicateContactMatches([]);
    const source = target.profile;
    const [firstName = "", ...lastNameParts] = source.displayName
      .trim()
      .split(/\s+/);
    setProfileEditTarget(target);
    setQuickCreateDraft({
      firstName,
      lastName: lastNameParts.join(" "),
      email: source.email,
      phoneNumber: "",
      affiliation: "staff",
    });
    setQuickCreateError(null);
  };

  const applyUpdatedProfileSelection = (selection: AssigneeSelection) => {
    setAssignee((prev) =>
      prev?.profileId === selection.profileId ? selection : prev,
    );
    setSelectedAttendees((prev) =>
      prev.map((entry) =>
        entry.profileId === selection.profileId ? selection : entry,
      ),
    );
    setSelectedCoOwners((prev) =>
      prev.map((entry) =>
        entry.profileId === selection.profileId ? selection : entry,
      ),
    );
  };

  const applyQuickCreateSelection = (selection: AssigneeSelection) => {
    if (quickCreateTarget === "assignee") {
      if (assignee && assignee.profileId !== selection.profileId) {
        handleAddCoOwner(selection);
        setAssigneeSearch("");
        setAssigneeQuery("");
      } else {
        setAutoAssignPending(false);
        setAssignee(selection);
        setAssigneeSearch("");
        setAssigneeQuery("");
      }
    } else if (quickCreateTarget === "attendee") {
      handleAddAttendee(selection);
    } else if (quickCreateTarget === "coOwner") {
      handleAddCoOwner(selection);
    }
  };

  const handleReviewExistingProfile = (profile: ContactConflict) => {
    applyQuickCreateSelection({
      profileId: profile.profileId,
      displayName: resolveProfileLabel(profile),
      email: profile.email,
      username: profile.username,
    });
    closeQuickCreate();
  };

  const submitQuickCreate = async (ignoreDuplicateContactCheck = false) => {
    setQuickCreateError(null);
    const firstName = quickCreateDraft.firstName.trim();
    const lastName = quickCreateDraft.lastName.trim();
    const email = sanitizeEmailDraft(quickCreateDraft.email);
    const phoneNumber = quickCreateDraft.phoneNumber.trim();
    if (!firstName || !lastName || !email) {
      setQuickCreateError("Add a first name, last name, and email.");
      return;
    }
    if (!isValidEmailAddress(email)) {
      setQuickCreateError("Enter a valid email address.");
      return;
    }
    if (email !== quickCreateDraft.email) {
      setQuickCreateDraft((prev) => ({
        ...prev,
        email,
      }));
    }
    try {
      if (!ignoreDuplicateContactCheck) {
        const matches = await utils.profile.findContactConflicts.fetch({
          email,
          phoneNumber: phoneNumber.length > 0 ? phoneNumber : undefined,
        });
        if (matches.length > 0) {
          setDuplicateContactMatches(matches);
          setShowDuplicateContactConfirm(true);
          return;
        }
      }
      const created = await createProfile.mutateAsync({
        firstName,
        lastName,
        email,
        phoneNumber,
        affiliation: quickCreateDraft.affiliation,
        ignoreDuplicateContactCheck,
      });
      if (!created.profileId) {
        throw new Error("Profile could not be created.");
      }
      applyQuickCreateSelection({
        profileId: created.profileId,
        displayName: resolveProfileLabel(created),
        email: created.email,
        username: created.username,
      });
      closeQuickCreate();
    } catch (err) {
      setQuickCreateError(getQuickCreateErrorMessage(err));
    }
  };

  const handleQuickCreateSubmit = async () => {
    await submitQuickCreate(false);
  };

  const handleConfirmDuplicateQuickCreate = async () => {
    await submitQuickCreate(true);
  };

  const handleProfileUpdate = async () => {
    if (!profileEditTarget) return;
    setQuickCreateError(null);
    const firstName = quickCreateDraft.firstName.trim();
    const lastName = quickCreateDraft.lastName.trim();
    const email = sanitizeEmailDraft(quickCreateDraft.email);
    const phoneNumber = quickCreateDraft.phoneNumber.trim();
    if (!firstName || !lastName || !email) {
      setQuickCreateError("Add a first name, last name, and email.");
      return;
    }
    if (!isValidEmailAddress(email)) {
      setQuickCreateError("Enter a valid email address.");
      return;
    }
    if (email !== quickCreateDraft.email) {
      setQuickCreateDraft((prev) => ({
        ...prev,
        email,
      }));
    }

    try {
      const updated = await updateProfile.mutateAsync({
        profileId: profileEditTarget.profile.profileId,
        firstName,
        lastName,
        email,
        phoneNumber,
        affiliation: quickCreateDraft.affiliation,
      });
      const nextSelection = {
        profileId: updated.profileId,
        displayName: resolveProfileLabel(updated),
        email: updated.email,
        username:
          updated.username ?? profileEditTarget.profile.username ?? null,
      };
      applyUpdatedProfileSelection(nextSelection);
      await utils.profile.search.invalidate();
      closeProfileEditor();
    } catch (err) {
      setQuickCreateError(getQuickCreateErrorMessage(err));
    }
  };

  function renderQuickCreateForm() {
    const isEditingProfile = profileEditTarget !== null;
    const isProfileEditLoading =
      isEditingProfile && editingProfileDetails.isLoading;
    if (!isEditingProfile && quickCreateTarget === null) return null;
    return (
      <div
        ref={quickCreatePanelRef}
        className="border-outline-muted bg-surface-muted mt-2 rounded-md border p-3"
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            nextTarget instanceof Node &&
            quickCreatePanelRef.current?.contains(nextTarget)
          ) {
            return;
          }
          if (profileEditTarget !== null) {
            closeProfileEditor();
            return;
          }
          closeQuickCreate();
        }}
      >
        <div className="text-ink-primary flex items-center justify-between text-sm font-semibold">
          <span>
            {isEditingProfile
              ? `Edit ${
                  profileEditTarget.type === "assignee"
                    ? "assignee"
                    : profileEditTarget.type === "coOwner"
                      ? "co-owner"
                      : "attendee"
                } profile`
              : `Create ${
                  quickCreateTarget === "assignee"
                    ? "assignee"
                    : quickCreateTarget === "coOwner"
                      ? "co-owner"
                      : "attendee"
                } profile`}
          </span>
          <button
            type="button"
            onClick={isEditingProfile ? closeProfileEditor : closeQuickCreate}
            className="text-ink-muted hover:text-ink-primary text-xs font-medium transition"
          >
            Cancel
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <input
              placeholder="First name"
              value={quickCreateDraft.firstName}
              onChange={(e) =>
                setQuickCreateDraft((prev) => ({
                  ...prev,
                  firstName: e.target.value,
                }))
              }
              className="border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 text-sm outline-none"
            />
            <input
              placeholder="Last name"
              value={quickCreateDraft.lastName}
              onChange={(e) =>
                setQuickCreateDraft((prev) => ({
                  ...prev,
                  lastName: e.target.value,
                }))
              }
              className="border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="space-y-2">
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              placeholder="Email"
              value={quickCreateDraft.email}
              onChange={(e) =>
                setQuickCreateDraft((prev) => ({
                  ...prev,
                  email: sanitizeEmailDraft(e.target.value),
                }))
              }
              className="border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 text-sm outline-none"
            />
            <DropdownSelect
              value={quickCreateDraft.affiliation}
              onChange={(value) =>
                setQuickCreateDraft((prev) => ({
                  ...prev,
                  affiliation:
                    value as (typeof profileAffiliationOptions)[number]["value"],
                }))
              }
              options={profileAffiliationOptions}
            />
            <input
              placeholder="Phone (optional)"
              value={quickCreateDraft.phoneNumber}
              onChange={(e) =>
                setQuickCreateDraft((prev) => ({
                  ...prev,
                  phoneNumber: formatPhoneInput(e.target.value),
                }))
              }
              className="border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>
        {isProfileEditLoading ? (
          <div className="text-ink-muted mt-2 text-xs">
            Loading profile details...
          </div>
        ) : null}
        {quickCreateError && (
          <div className="text-status-danger mt-2 text-xs">
            {quickCreateError}
          </div>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="text-ink-muted hover:text-ink-primary text-xs font-medium transition"
            onClick={isEditingProfile ? closeProfileEditor : closeQuickCreate}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="bg-accent-strong text-ink-inverted rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            disabled={
              createProfile.isPending ||
              updateProfile.isPending ||
              Boolean(isProfileEditLoading)
            }
            onClick={
              isEditingProfile
                ? () => void handleProfileUpdate()
                : handleQuickCreateSubmit
            }
          >
            {createProfile.isPending || updateProfile.isPending
              ? "Saving..."
              : isEditingProfile
                ? "Save changes"
                : quickCreateTarget === "assignee"
                  ? "Save & assign"
                  : "Save & add"}
          </button>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setSubmitAttempted(true);
    setError(null);
    try {
      if (
        titleMissing ||
        !hasCalendar ||
        attendeeSelectionInvalid ||
        buildingSelectionInvalid
      ) {
        setError("Complete the required fields before saving.");
        return;
      }
      if (hourLogsInvalid || hourLogsIncomplete) {
        setError("Please complete or remove invalid hour log entries.");
        return;
      }
      if (zendeskTicketError) {
        setError(zendeskTicketError);
        return;
      }
      const payloadHourLogs = hourLogs
        .map((log) => {
          if (!log.start || !log.end) return null;
          const base = { startTime: log.start, endTime: log.end };
          return log.sourceId ? { ...base, id: log.sourceId } : base;
        })
        .filter((log): log is { id?: number; startTime: Date; endTime: Date } =>
          Boolean(log),
        );
      const participantCountValue =
        trimmedParticipantCount === ""
          ? isEditing
            ? null
            : undefined
          : (parsedParticipantCount ?? undefined);
      const equipmentValue = equipmentNeeded.trim();
      const equipmentPayload =
        equipmentValue.length > 0
          ? equipmentValue
          : isEditing
            ? null
            : undefined;
      const requestDetailsPayload =
        requestDetails ?? (isEditing ? null : undefined);
      const requestCategoryValue = requestCategory
        ? requestCategory
        : isEditing
          ? null
          : undefined;
      const eventInfoStartValue = eventInfoStart
        ? new Date(eventInfoStart)
        : isEditing
          ? null
          : undefined;
      const eventInfoEndValue = eventInfoEnd
        ? new Date(eventInfoEnd)
        : isEditing
          ? null
          : undefined;
      const setupInfoValue = setupInfoTime
        ? new Date(setupInfoTime)
        : isEditing
          ? null
          : undefined;
      const zendeskTicketValueRaw = zendeskTicket.replace(/\D/g, "");
      const zendeskTicketPayload =
        zendeskTicketValueRaw.length > 0
          ? zendeskTicketValueRaw
          : isEditing
            ? null
            : undefined;
      const attendeeProfileIds = selectedAttendees
        .map((entry) => entry.profileId)
        .filter((id) => id > 0);
      if (attendeeProfileIds.length === 0) {
        setError("Select at least one attendee before saving.");
        return;
      }
      const coOwnerProfileIds = selectedCoOwners
        .map((entry) => entry.profileId)
        .filter((id) => id > 0);
      const targetCalendarIds = Array.from(new Set(selectedCalendarIds));
      if (targetCalendarIds.length === 0) {
        setError("Select at least one calendar before saving.");
        return;
      }
      const targetCalendarId = targetCalendarIds[0] ?? null;
      const selectedRoomIds = selectedRooms.map((entry) => entry.roomId);
      const roomLocationSummary = formatLocationSummaryFromRooms(selectedRooms);
      const locationPayload =
        selectedRoomIds.length > 0 ? roomLocationSummary : location.trim();
      const buildingIdPayload =
        selectedRoomIds.length > 0
          ? (selectedRooms[0]?.buildingId ?? null)
          : selectedBuildingId;

      if (isEditing && event) {
        const segment = segments[0];
        if (!segment) {
          throw new Error("Unable to determine event time range.");
        }
        const dayStart = allDay ? startOfDay(segment.start) : segment.start;
        const dayEnd = allDay
          ? addDays(startOfDay(segment.start), 1)
          : segment.end;
        await update.mutateAsync({
          id: event.id,
          calendarId: targetCalendarId ?? targetCalendarIds[0]!,
          title,
          description,
          location: locationPayload,
          buildingId: buildingIdPayload,
          roomIds: selectedRoomIds,
          isVirtual,
          isAllDay: allDay,
          startDatetime: dayStart,
          endDatetime: dayEnd,
          recurrenceRule: recurring
            ? (event.recurrenceRule ?? "FREQ=DAILY")
            : null,
          assigneeProfileId: assignee ? assignee.profileId : null,
          coOwnerProfileIds,
          hourLogs: payloadHourLogs,
          attendeeProfileIds,
          participantCount: participantCountValue,
          technicianNeeded,
          requestCategory: requestCategoryValue,
          equipmentNeeded: equipmentPayload,
          requestDetails: requestDetailsPayload,
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
          const requestDetailsPayloadCreate =
            requestDetailsPayload ?? undefined;
          const eventInfoStartPayload = eventInfoStartValue ?? undefined;
          const eventInfoEndPayload = eventInfoEndValue ?? undefined;
          const setupInfoPayload = setupInfoValue ?? undefined;
          const zendeskTicketPayloadCreate = zendeskTicketPayload ?? undefined;
          for (const calendarId of additionalCalendarIds) {
            await create.mutateAsync({
              calendarId,
              title,
              description,
              location: locationPayload,
              buildingId: buildingIdPayload ?? undefined,
              roomIds: selectedRoomIds,
              isVirtual,
              isAllDay: allDay,
              startDatetime: dayStart,
              endDatetime: dayEnd,
              recurrenceRule: recurring
                ? (event.recurrenceRule ?? "FREQ=DAILY")
                : null,
              assigneeProfileId: assignee?.profileId ?? undefined,
              coOwnerProfileIds,
              hourLogs: payloadHourLogs,
              attendeeProfileIds,
              participantCount: participantCountPayload,
              technicianNeeded,
              requestCategory: requestCategoryPayload,
              equipmentNeeded: equipmentPayloadCreate,
              requestDetails: requestDetailsPayloadCreate,
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
        const requestDetailsPayloadCreate = requestDetailsPayload ?? undefined;
        const eventInfoStartPayload = eventInfoStartValue ?? undefined;
        const eventInfoEndPayload = eventInfoEndValue ?? undefined;
        const setupInfoPayload = setupInfoValue ?? undefined;
        const zendeskTicketPayloadCreate = zendeskTicketPayload ?? undefined;
        for (const segment of segments) {
          const dayStart = allDay ? startOfDay(segment.start) : segment.start;
          const dayEnd = allDay
            ? addDays(startOfDay(segment.start), 1)
            : segment.end;
          for (const calendarId of targetCalendarIds) {
            await create.mutateAsync({
              calendarId,
              title,
              description,
              location: locationPayload,
              buildingId: buildingIdPayload ?? undefined,
              roomIds: selectedRoomIds,
              isVirtual,
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
              requestDetails: requestDetailsPayloadCreate,
              eventStartTime: eventInfoStartPayload,
              eventEndTime: eventInfoEndPayload,
              setupTime: setupInfoPayload,
              zendeskTicketNumber: zendeskTicketPayloadCreate,
            });
          }
        }
      }
      await utils.event.invalidate();
      if (isEditing && event) {
        clearEditEventDraft(event.id);
      } else {
        clearNewEventDraft();
      }
      onClose();
    } catch (err) {
      console.error(err);
      const fallback = isEditing
        ? "Failed to update event"
        : "Failed to create event";
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
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-[var(--color-overlay-backdrop)]/40 px-4"
      onMouseDown={handleBackdropMouseDown}
    >
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[10021] flex items-center justify-center bg-[var(--color-overlay-backdrop)]/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDeleteConfirm(false);
            }
          }}
        >
          <div
            ref={deleteConfirmRef}
            className="border-status-danger bg-surface-raised w-full max-w-md rounded-2xl border p-5 text-sm shadow-2xl shadow-[var(--shadow-pane)]"
            tabIndex={-1}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget;
              if (
                nextTarget instanceof Node &&
                deleteConfirmRef.current?.contains(nextTarget)
              ) {
                return;
              }
              setShowDeleteConfirm(false);
            }}
          >
            <div className="text-status-danger text-xs font-semibold tracking-wide uppercase">
              Confirm delete
            </div>
            <div className="text-ink-primary mt-2">
              Delete this event? This cannot be undone.
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="border-outline-muted text-ink-primary hover:bg-surface-muted rounded-md border px-3 py-1.5 text-sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bg-status-danger text-ink-inverted hover:bg-status-danger-strong rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60"
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showDuplicateContactConfirm && quickCreateTarget !== null && (
        <div
          className="fixed inset-0 z-[10021] flex items-center justify-center bg-[var(--color-overlay-backdrop)]/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDuplicateContactConfirm(false);
            }
          }}
        >
          <div
            ref={duplicateConfirmRef}
            className="border-status-danger bg-surface-raised w-full max-w-lg rounded-2xl border p-5 text-sm shadow-2xl shadow-[var(--shadow-pane)]"
            tabIndex={-1}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget;
              if (
                nextTarget instanceof Node &&
                duplicateConfirmRef.current?.contains(nextTarget)
              ) {
                return;
              }
              setShowDuplicateContactConfirm(false);
            }}
          >
            <div className="text-status-danger text-xs font-semibold tracking-wide uppercase">
              Possible duplicate profile
            </div>
            <div className="text-ink-primary mt-2">
              A profile with the same email address or phone number already
              exists. Review an existing profile or continue creating a new one
              anyway.
            </div>
            <div className="mt-4 space-y-3">
              {duplicateContactMatches.map((match) => {
                const reasons = [
                  match.matchesEmail ? "email" : null,
                  match.matchesPhoneNumber ? "phone" : null,
                ].filter(Boolean);
                return (
                  <div
                    key={match.profileId}
                    className="border-outline-muted bg-surface-muted rounded-xl border px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-ink-primary font-medium">
                          {match.displayName}
                        </div>
                        <div className="text-ink-muted text-xs">
                          {match.email}
                        </div>
                        {match.phoneNumber ? (
                          <div className="text-ink-muted text-xs">
                            {match.phoneNumber}
                          </div>
                        ) : null}
                        <div className="text-status-danger mt-1 text-[11px] tracking-wide uppercase">
                          Matching {reasons.join(" and ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="border-outline-muted text-ink-primary hover:bg-surface-raised rounded-md border px-3 py-1.5 text-xs font-medium transition"
                        onClick={() => handleReviewExistingProfile(match)}
                        disabled={createProfile.isPending}
                      >
                        Review existing
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="border-outline-muted text-ink-primary hover:bg-surface-muted rounded-md border px-3 py-1.5 text-sm"
                onClick={() => setShowDuplicateContactConfirm(false)}
                disabled={createProfile.isPending}
              >
                Go back
              </button>
              <button
                type="button"
                className="bg-status-danger text-ink-inverted hover:bg-status-danger-strong rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60"
                onClick={handleConfirmDuplicateQuickCreate}
                disabled={createProfile.isPending}
              >
                {createProfile.isPending ? "Saving..." : "Continue creating"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="border-outline-muted bg-surface-raised text-ink-primary relative max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border p-6 shadow-2xl shadow-[var(--shadow-pane)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">{dialogTitle}</div>
          <button
            className="border-outline-muted hover:bg-surface-muted rounded-md border px-2 py-1"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="text-ink-muted mb-1 text-xs">
              Title <span className="text-status-danger">*</span>
            </div>
            <input
              placeholder="Add a title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={
                "bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none " +
                (showTitleError
                  ? "border-status-danger"
                  : "border-outline-muted")
              }
            />
            {showTitleError ? (
              <div className="text-status-danger mt-2 text-xs">
                Title is required.
              </div>
            ) : null}
          </div>

          <div>
            <div className="text-ink-muted mb-1 text-xs">
              Calendars <span className="text-status-danger">*</span>
            </div>
            {calendarOptions.length === 0 ? (
              <div className="border-outline-muted bg-surface-muted text-ink-muted rounded-md border p-3 text-xs">
                No writable calendars available.
              </div>
            ) : (
              <>
                <div className="border-outline-muted bg-surface-muted rounded-md border p-2">
                  {selectedCalendarIds.length === 0 ? (
                    <div
                      className={
                        showCalendarError
                          ? "text-status-danger text-xs"
                          : "text-ink-muted text-xs"
                      }
                    >
                      Select at least one calendar.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {calendarOptions
                        .filter((option) =>
                          selectedCalendarIds.includes(option.id),
                        )
                        .map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              setSelectedCalendarIds((prev) =>
                                prev.filter((id) => id !== option.id),
                              )
                            }
                            className="border-outline-muted bg-surface-raised text-ink-primary hover:bg-surface-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded"
                              style={{ backgroundColor: option.color }}
                            />
                            <span className="max-w-[12rem] truncate">
                              {option.name}
                            </span>
                            <span className="text-ink-faint">x</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <DropdownSelect
                  value=""
                  placeholder="Add calendar"
                  onChange={(value) => {
                    const nextId = Number(value);
                    if (!Number.isFinite(nextId)) return;
                    setSelectedCalendarIds((prev) =>
                      prev.includes(nextId) ? prev : [...prev, nextId],
                    );
                    setSelectedCalendarId(nextId);
                  }}
                  options={calendarOptions
                    .filter(
                      (option) => !selectedCalendarIds.includes(option.id),
                    )
                    .map((option) => ({
                      value: String(option.id),
                      label: option.name,
                    }))}
                />
                <p className="text-ink-subtle mt-1 text-xs">
                  {selectedCalendarIds.length} selected
                </p>
                {showCalendarError ? (
                  <div className="text-status-danger mt-2 text-xs">
                    At least one calendar is required.
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div>
            <div className="text-ink-muted mb-1 text-xs">
              Zendesk ticket number
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={zendeskTicket}
              onChange={(e) =>
                setZendeskTicket(e.target.value.replace(/\D/g, ""))
              }
              className="border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="123456"
            />
            {zendeskTicketError ? (
              <p className="text-status-danger mt-1 text-xs">
                {zendeskTicketError}
              </p>
            ) : (
              <p className="text-ink-subtle mt-1 text-xs">
                Enter a 6-digit Zendesk ticket.
              </p>
            )}
          </div>

          <div className="border-outline-muted space-y-4 border-t pt-4">
            {segments.map((segment, index) => {
              const startValue = formatTimeValue(segment.start);
              const endValue = formatTimeValue(segment.end);
              return (
                <div
                  key={segment.id}
                  className="border-outline-muted space-y-2 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="text-ink-subtle flex items-center justify-between text-xs font-semibold tracking-wide uppercase">
                    <span>Day {index + 1}</span>
                    {!isEditing && segments.length > 1 && (
                      <button
                        type="button"
                        className="text-status-danger hover:text-status-danger transition"
                        onClick={() => removeSegment(segment.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className={INLINE_TIME_FIELD_ROW_CLASS}>
                    <input
                      type="date"
                      value={formatDateInputValue(segment.start)}
                      onChange={(e) =>
                        handleDateChange(segment.id, e.target.value)
                      }
                      className={DATE_FIELD_CLASS}
                    />
                    {allDay ? (
                      <span className="border-outline-muted text-ink-subtle rounded-md border px-3 py-2 text-sm">
                        All day
                      </span>
                    ) : (
                      <>
                        <TimeSelect
                          value={startValue}
                          onChange={(next) =>
                            handleStartTimeChange(segment.id, next)
                          }
                          placeholder="Start"
                          options={timeOptions}
                        />
                        <span className="text-ink-subtle text-sm">to</span>
                        <TimeSelect
                          value={endValue}
                          onChange={(next) =>
                            handleEndTimeChange(segment.id, next)
                          }
                          placeholder="End"
                          options={timeOptions}
                        />
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
                className="text-accent-soft hover:text-status-success text-sm font-medium transition"
              >
                + Add another day
              </button>
            )}
          </div>

          <div>
            <div className="text-ink-muted mb-1 text-xs">
              Invite attendees <span className="text-status-danger">*</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedAttendees.length === 0 ? (
                <span
                  className={
                    showAttendeeSelectionError
                      ? "text-status-danger text-xs"
                      : "text-ink-muted text-xs"
                  }
                >
                  No attendees selected.
                </span>
              ) : (
                selectedAttendees.map((attendee) => (
                  <span
                    key={attendee.profileId}
                    className={
                      "bg-surface-muted text-ink-primary inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm " +
                      (profileEditTarget?.type === "attendee" &&
                      profileEditTarget.profile.profileId === attendee.profileId
                        ? "border-outline-accent ring-accent-strong ring-2"
                        : "border-outline-muted")
                    }
                    onDoubleClick={() =>
                      openProfileEditor({ type: "attendee", profile: attendee })
                    }
                    title="Double-click to edit profile"
                  >
                    <span className="font-medium">{attendee.displayName}</span>
                    <span className="text-ink-muted text-xs">
                      {attendee.email}
                    </span>
                    <button
                      type="button"
                      className="text-ink-faint hover:text-status-danger transition"
                      onClick={() => handleRemoveAttendee(attendee.profileId)}
                      onDoubleClick={(event) => event.stopPropagation()}
                      aria-label="Remove attendee"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div
              className="relative mt-2"
              ref={attendeeSearchWrapRef}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  nextTarget instanceof Node &&
                  attendeeSearchWrapRef.current?.contains(nextTarget)
                ) {
                  return;
                }
                setAttendeeFocused(false);
                setAttendeeHighlight(-1);
              }}
            >
              <input
                placeholder="Search by name, email, or phone"
                value={attendeeSearch}
                onChange={(e) => setAttendeeSearch(e.target.value)}
                onFocus={() => {
                  setAttendeeFocused(true);
                  if (attendeeMatches.length > 0) {
                    setAttendeeHighlight((prev) => (prev >= 0 ? prev : 0));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAttendeeHighlight((prev) =>
                      getNextHighlightedIndex(prev, attendeeMatches.length, 1),
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAttendeeHighlight((prev) =>
                      getNextHighlightedIndex(prev, attendeeMatches.length, -1),
                    );
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const highlightedMatch = getHighlightedItem(
                      attendeeMatches,
                      attendeeHighlight,
                    );
                    if (highlightedMatch) {
                      handleAddAttendee(highlightedMatch);
                    }
                  } else if (e.key === "Escape") {
                    setAttendeeHighlight(-1);
                  } else if (e.key === "Tab") {
                    setAttendeeFocused(false);
                    setAttendeeHighlight(-1);
                  }
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={shouldShowAttendeeResults}
                aria-controls={attendeeListboxId}
                aria-activedescendant={
                  attendeeHighlight >= 0
                    ? `${attendeeListboxId}-${attendeeHighlight}`
                    : undefined
                }
                className={`border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none ${FOCUSABLE_FIELD_CLASS}`}
              />
              {shouldShowAttendeeResults && (
                <div
                  id={attendeeListboxId}
                  role="listbox"
                  className="border-outline-strong bg-surface-overlay/95 absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
                >
                  {attendeeResults.isFetching ? (
                    <div className="text-ink-muted px-3 py-2 text-sm">
                      Searching...
                    </div>
                  ) : attendeeMatches.length > 0 ? (
                    <>
                      {attendeeMatches.map((match, index) => {
                        const isActive = index === attendeeHighlight;
                        return (
                          <button
                            key={match.profileId}
                            type="button"
                            id={`${attendeeListboxId}-${index}`}
                            role="option"
                            aria-selected={isActive}
                            tabIndex={-1}
                            ref={(node) => {
                              attendeeOptionRefs.current[index] = node;
                            }}
                            className={
                              "border-outline-muted text-ink-primary flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                              (isActive
                                ? "bg-accent-muted"
                                : "hover:bg-surface-muted")
                            }
                            onClick={() => handleAddAttendee(match)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setAttendeeHighlight(index)}
                          >
                            <span className="font-medium">
                              {match.displayName}
                            </span>
                            <span className="text-ink-muted text-xs">
                              {match.email}
                            </span>
                          </button>
                        );
                      })}
                      <div className="text-ink-muted px-3 py-2 text-sm">
                        <button
                          type="button"
                          className="text-accent-soft hover:text-accent-strong"
                          onClick={() => openQuickCreate("attendee")}
                        >
                          Create new profile for &quot;
                          {fallbackSearchLabel(attendeeSearch, "attendee")}
                          &quot;
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-ink-muted space-y-2 px-3 py-2 text-sm">
                      <div>No profiles found</div>
                      <button
                        type="button"
                        className="text-accent-soft hover:text-accent-strong"
                        onClick={() => openQuickCreate("attendee")}
                      >
                        Create profile for &quot;
                        {fallbackSearchLabel(attendeeSearch, "attendee")}&quot;
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {showAttendeeSelectionError ? (
              <div className="text-status-danger mt-2 text-xs">
                At least one attendee is required.
              </div>
            ) : null}
            {quickCreateTarget === "attendee" ||
            profileEditTarget?.type === "attendee"
              ? renderQuickCreateForm()
              : null}
          </div>

          <div>
            <div className="text-ink-muted mb-1 text-xs">Assign to</div>
            <div className="space-y-2">
              {assignee && (
                <div
                  className={
                    "flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm " +
                    (profileEditTarget?.type === "assignee" &&
                    profileEditTarget.profile.profileId === assignee.profileId
                      ? "border-outline-accent bg-accent-muted ring-accent-strong ring-2"
                      : "border-outline-accent bg-accent-muted")
                  }
                  onDoubleClick={() =>
                    openProfileEditor({ type: "assignee", profile: assignee })
                  }
                  title="Double-click to edit profile"
                >
                  <div>
                    <div className="text-ink-primary font-medium">
                      {assignee.displayName}
                    </div>
                    <div className="text-ink-muted text-xs">
                      {assignee.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-status-success hover:text-accent-soft text-xs font-medium"
                    onClick={handleClearAssignee}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    Clear
                  </button>
                </div>
              )}
              <div
                className="relative"
                ref={assigneeSearchWrapRef}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    assigneeSearchWrapRef.current?.contains(nextTarget)
                  ) {
                    return;
                  }
                  setAssigneeFocused(false);
                  setAssigneeHighlight(-1);
                }}
              >
                <input
                  placeholder={
                    assignee
                      ? "Search to add co-owners or clear to reassign"
                      : "Search by name, username, email, or phone"
                  }
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  onFocus={() => {
                    setAssigneeFocused(true);
                    if (assigneeMatches.length > 0) {
                      setAssigneeHighlight((prev) => (prev >= 0 ? prev : 0));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setAssigneeHighlight((prev) =>
                        getNextHighlightedIndex(
                          prev,
                          assigneeMatches.length,
                          1,
                        ),
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setAssigneeHighlight((prev) =>
                        getNextHighlightedIndex(
                          prev,
                          assigneeMatches.length,
                          -1,
                        ),
                      );
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const highlightedMatch = getHighlightedItem(
                        assigneeMatches,
                        assigneeHighlight,
                      );
                      if (highlightedMatch) {
                        handleSelectAssignee(highlightedMatch);
                      }
                    } else if (e.key === "Escape") {
                      setAssigneeHighlight(-1);
                    } else if (e.key === "Tab") {
                      setAssigneeFocused(false);
                      setAssigneeHighlight(-1);
                    }
                  }}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={shouldShowAssigneeResults}
                  aria-controls={assigneeListboxId}
                  aria-activedescendant={
                    assigneeHighlight >= 0
                      ? `${assigneeListboxId}-${assigneeHighlight}`
                      : undefined
                  }
                  className={`border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none ${FOCUSABLE_FIELD_CLASS}`}
                />
                {shouldShowAssigneeResults && (
                  <div
                    id={assigneeListboxId}
                    role="listbox"
                    className="border-outline-strong bg-surface-overlay/95 absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
                  >
                    {assigneeResults.isFetching ? (
                      <div className="text-ink-muted px-3 py-2 text-sm">
                        Searching...
                      </div>
                    ) : assigneeMatches.length > 0 ? (
                      <>
                        {assigneeMatches.map((match, index) => {
                          const isActive = index === assigneeHighlight;
                          return (
                            <button
                              key={match.profileId}
                              type="button"
                              id={`${assigneeListboxId}-${index}`}
                              role="option"
                              aria-selected={isActive}
                              tabIndex={-1}
                              ref={(node) => {
                                assigneeOptionRefs.current[index] = node;
                              }}
                              className={
                                "border-outline-muted text-ink-primary flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                                (isActive
                                  ? "bg-accent-muted"
                                  : "hover:bg-surface-muted")
                              }
                              onClick={() => handleSelectAssignee(match)}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setAssigneeHighlight(index)}
                            >
                              <span className="font-medium">
                                {match.displayName}
                              </span>
                              <span className="text-ink-muted text-xs">
                                {match.email}
                              </span>
                            </button>
                          );
                        })}
                        <div className="text-ink-muted px-3 py-2 text-sm">
                          <button
                            type="button"
                            className="text-accent-soft hover:text-accent-strong"
                            onClick={() => openQuickCreate("assignee")}
                          >
                            Create new profile for &quot;
                            {fallbackSearchLabel(assigneeSearch, "assignee")}
                            &quot;
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-ink-muted space-y-2 px-3 py-2 text-sm">
                        <div>No profiles found</div>
                        <button
                          type="button"
                          className="text-accent-soft hover:text-accent-strong"
                          onClick={() => openQuickCreate("assignee")}
                        >
                          Create profile for &quot;
                          {fallbackSearchLabel(assigneeSearch, "assignee")}
                          &quot;
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {quickCreateTarget === "assignee" ||
              profileEditTarget?.type === "assignee"
                ? renderQuickCreateForm()
                : null}
            </div>

            <div>
              <div className="text-ink-muted mb-1 text-xs">Co-owners</div>
              <div className="flex flex-wrap gap-2">
                {selectedCoOwners.length === 0 ? (
                  <span className="text-ink-muted text-xs">
                    No co-owners selected.
                  </span>
                ) : (
                  selectedCoOwners.map((owner) => (
                    <span
                      key={owner.profileId}
                      className={
                        "bg-surface-muted text-ink-primary inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm " +
                        (profileEditTarget?.type === "coOwner" &&
                        profileEditTarget.profile.profileId === owner.profileId
                          ? "border-outline-accent ring-accent-strong ring-2"
                          : "border-outline-muted")
                      }
                      onDoubleClick={() =>
                        openProfileEditor({ type: "coOwner", profile: owner })
                      }
                      title="Double-click to edit profile"
                    >
                      <span className="font-medium">{owner.displayName}</span>
                      <span className="text-ink-muted text-xs">
                        {owner.email}
                      </span>
                      <button
                        type="button"
                        className="text-ink-faint hover:text-status-danger transition"
                        onClick={() => handleRemoveCoOwner(owner.profileId)}
                        onDoubleClick={(event) => event.stopPropagation()}
                        aria-label="Remove co-owner"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div
                className="relative mt-2"
                ref={coOwnerSearchWrapRef}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    coOwnerSearchWrapRef.current?.contains(nextTarget)
                  ) {
                    return;
                  }
                  setCoOwnerFocused(false);
                  setCoOwnerHighlight(-1);
                }}
              >
                <input
                  placeholder="Search by name, email, or phone"
                  value={coOwnerSearch}
                  onChange={(e) => setCoOwnerSearch(e.target.value)}
                  onFocus={() => {
                    setCoOwnerFocused(true);
                    if (coOwnerMatches.length > 0) {
                      setCoOwnerHighlight((prev) => (prev >= 0 ? prev : 0));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setCoOwnerHighlight((prev) =>
                        getNextHighlightedIndex(prev, coOwnerMatches.length, 1),
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setCoOwnerHighlight((prev) =>
                        getNextHighlightedIndex(
                          prev,
                          coOwnerMatches.length,
                          -1,
                        ),
                      );
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      const highlightedMatch = getHighlightedItem(
                        coOwnerMatches,
                        coOwnerHighlight,
                      );
                      if (highlightedMatch) {
                        handleAddCoOwner(highlightedMatch);
                      }
                    } else if (e.key === "Escape") {
                      setCoOwnerHighlight(-1);
                    } else if (e.key === "Tab") {
                      setCoOwnerFocused(false);
                      setCoOwnerHighlight(-1);
                    }
                  }}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={shouldShowCoOwnerResults}
                  aria-controls={coOwnerListboxId}
                  aria-activedescendant={
                    coOwnerHighlight >= 0
                      ? `${coOwnerListboxId}-${coOwnerHighlight}`
                      : undefined
                  }
                  className={`border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none ${FOCUSABLE_FIELD_CLASS}`}
                />
                {shouldShowCoOwnerResults && (
                  <div
                    id={coOwnerListboxId}
                    role="listbox"
                    className="border-outline-strong bg-surface-overlay/95 absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
                  >
                    {coOwnerResults.isFetching ? (
                      <div className="text-ink-muted px-3 py-2 text-sm">
                        Searching...
                      </div>
                    ) : coOwnerMatches.length > 0 ? (
                      <>
                        {coOwnerMatches.map((match, index) => {
                          const isActive = index === coOwnerHighlight;
                          return (
                            <button
                              key={match.profileId}
                              type="button"
                              id={`${coOwnerListboxId}-${index}`}
                              role="option"
                              aria-selected={isActive}
                              tabIndex={-1}
                              ref={(node) => {
                                coOwnerOptionRefs.current[index] = node;
                              }}
                              className={
                                "border-outline-muted text-ink-primary flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                                (isActive
                                  ? "bg-accent-muted"
                                  : "hover:bg-surface-muted")
                              }
                              onClick={() => handleAddCoOwner(match)}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setCoOwnerHighlight(index)}
                            >
                              <span className="font-medium">
                                {match.displayName}
                              </span>
                              <span className="text-ink-muted text-xs">
                                {match.email}
                              </span>
                            </button>
                          );
                        })}
                        <div className="text-ink-muted px-3 py-2 text-sm">
                          <button
                            type="button"
                            className="text-accent-soft hover:text-accent-strong"
                            onClick={() => openQuickCreate("coOwner")}
                          >
                            Create new profile for &quot;
                            {fallbackSearchLabel(coOwnerSearch, "co-owner")}
                            &quot;
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-ink-muted space-y-2 px-3 py-2 text-sm">
                        <div>No profiles found</div>
                        <button
                          type="button"
                          className="text-accent-soft hover:text-accent-strong"
                          onClick={() => openQuickCreate("coOwner")}
                        >
                          Create profile for &quot;
                          {fallbackSearchLabel(coOwnerSearch, "co-owner")}&quot;
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {quickCreateTarget === "coOwner" ||
              profileEditTarget?.type === "coOwner"
                ? renderQuickCreateForm()
                : null}
            </div>
          </div>

          <div className="border-outline-muted space-y-4 border-t pt-4">
            <div className="text-ink-subtle text-xs tracking-wide uppercase">
              Event request details
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-ink-muted mb-1 block text-xs">
                  Number of participants
                </label>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  inputMode="numeric"
                  value={participantCount}
                  onChange={(e) => setParticipantCount(e.target.value)}
                  className={
                    "bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none " +
                    (participantCountInvalid
                      ? "border-status-danger text-status-danger"
                      : "border-outline-muted")
                  }
                  placeholder="Estimated attendance"
                />
                {participantCountInvalid && (
                  <div className="text-status-danger mt-1 text-xs">
                    Enter a whole number up to 100,000.
                  </div>
                )}
              </div>
              <div>
                <label className="text-ink-muted mb-1 block text-xs">
                  Technician needed?
                </label>
                <DropdownSelect
                  value={technicianNeeded ? "yes" : "no"}
                  onChange={(value) => setTechnicianNeeded(value === "yes")}
                  options={[
                    { value: "no", label: "No" },
                    { value: "yes", label: "Yes" },
                  ]}
                />
              </div>
            </div>
            <div>
              <label className="text-ink-muted mb-1 block text-xs">
                Request category
              </label>
              <DropdownSelect
                value={requestCategory}
                placeholder="Select a category"
                onChange={(value) =>
                  setRequestCategory(value as RequestCategoryValue | "")
                }
                options={[
                  { value: "", label: "Select a category" },
                  ...REQUEST_CATEGORY_OPTIONS,
                ]}
              />
            </div>
            <div>
              <label className="text-ink-muted mb-1 block text-xs">
                Equipment needed
              </label>
              <div className="border-outline-muted bg-surface-muted space-y-3 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-x-6">
                  {equipmentOptionColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className="space-y-2">
                      {column.map((option) => (
                        <label
                          key={option}
                          className="text-ink-primary flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedEquipmentNeeded.includes(option)}
                            onChange={() => toggleEquipmentNeeded(option)}
                            onKeyDown={(event) =>
                              handleCheckboxEnterKey(event, () =>
                                toggleEquipmentNeeded(option),
                              )
                            }
                            className="accent-accent-strong h-4 w-4"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                {showEquipmentAdditionalInformation ? (
                  <div>
                    <label className="text-ink-muted mb-1 block text-xs">
                      Other equipment details
                    </label>
                    <input
                      type="text"
                      value={equipmentOtherDetails}
                      onChange={(e) => setEquipmentOtherDetails(e.target.value)}
                      className="border-outline-muted bg-surface-raised text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none"
                      placeholder="Provide any other equipment details"
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div>
              <label className="text-ink-muted mb-1 block text-xs">
                Event type
              </label>
              <div className="border-outline-muted bg-surface-muted space-y-3 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-x-6">
                  {eventTypeOptionColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className="space-y-2">
                      {column.map((option) => (
                        <label
                          key={option}
                          className="text-ink-primary flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedEventTypes.includes(option)}
                            onChange={() => toggleEventType(option)}
                            onKeyDown={(event) =>
                              handleCheckboxEnterKey(event, () =>
                                toggleEventType(option),
                              )
                            }
                            className="accent-accent-strong h-4 w-4"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                {showEventTypeOtherDetails ? (
                  <div>
                    <label className="text-ink-muted mb-1 block text-xs">
                      Other event type details
                    </label>
                    <input
                      type="text"
                      value={eventTypeOtherDetails}
                      onChange={(e) => setEventTypeOtherDetails(e.target.value)}
                      className="border-outline-muted bg-surface-raised text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none"
                      placeholder="Provide any other event type details"
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div>
              <label className="text-ink-muted mb-1 block text-xs">
                Description
              </label>
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full resize-y rounded-md border p-3 outline-none"
                placeholder="Notes"
              />
            </div>
          </div>

          <div className="border-outline-muted space-y-4 border-t pt-4">
            <div className="text-ink-subtle text-xs tracking-wide uppercase">
              Event timeline (informational)
            </div>
            <div className="text-ink-muted text-xs">
              These fields do not change the calendar block.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="border-outline-muted rounded-lg border p-3">
                <div className="text-ink-subtle mb-2 text-xs font-semibold tracking-wide uppercase">
                  Event start
                </div>
                <div className={INLINE_TIME_FIELD_ROW_CLASS}>
                  <input
                    type="date"
                    value={
                      fallbackEventInfoStart
                        ? formatDateInputValue(fallbackEventInfoStart)
                        : ""
                    }
                    onChange={(e) =>
                      handleInfoDateChange("eventStart", e.target.value)
                    }
                    className={DATE_FIELD_CLASS}
                  />
                  <TimeSelect
                    value={fallbackEventInfoStartValue}
                    onChange={(next) =>
                      handleInfoTimeChange("eventStart", next)
                    }
                    placeholder="Select time"
                    options={timeOptions}
                    allowEmpty
                  />
                </div>
              </div>
              <div className="border-outline-muted rounded-lg border p-3">
                <div className="text-ink-subtle mb-2 text-xs font-semibold tracking-wide uppercase">
                  Event end
                </div>
                <div className={INLINE_TIME_FIELD_ROW_CLASS}>
                  <input
                    type="date"
                    value={
                      fallbackEventInfoEnd
                        ? formatDateInputValue(fallbackEventInfoEnd)
                        : ""
                    }
                    onChange={(e) =>
                      handleInfoDateChange("eventEnd", e.target.value)
                    }
                    className={DATE_FIELD_CLASS}
                  />
                  <TimeSelect
                    value={fallbackEventInfoEndValue}
                    onChange={(next) => handleInfoTimeChange("eventEnd", next)}
                    placeholder="Select time"
                    options={timeOptions}
                    allowEmpty
                  />
                </div>
              </div>
            </div>
            <div className="border-outline-muted rounded-lg border p-3">
              <div className="text-ink-subtle mb-2 text-xs font-semibold tracking-wide uppercase">
                Setup time
              </div>
              <div className={INLINE_TIME_FIELD_ROW_CLASS}>
                <input
                  type="date"
                  value={
                    fallbackSetupInfoTime
                      ? formatDateInputValue(fallbackSetupInfoTime)
                      : ""
                  }
                  onChange={(e) =>
                    handleInfoDateChange("setup", e.target.value)
                  }
                  className={DATE_FIELD_CLASS}
                />
                <TimeSelect
                  value={fallbackSetupInfoValue}
                  onChange={(next) => handleInfoTimeChange("setup", next)}
                  placeholder="Select time"
                  options={timeOptions}
                  allowEmpty
                />
              </div>
            </div>
          </div>

          <div className="border-outline-muted text-ink-subtle space-y-3 border-t pt-4 text-sm">
            <div className="text-ink-subtle text-xs tracking-wide uppercase">
              Hour logging
            </div>
            {hourLogs.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink-muted">
                  No intervals have been added.
                </span>
                <button
                  type="button"
                  onClick={addHourLogRow}
                  className="border-outline-accent text-accent-soft hover:bg-accent-muted inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition"
                >
                  <span className="text-base leading-none">+</span>
                  Add interval
                </button>
              </div>
            ) : (
              <>
                <div className="divide-outline-muted divide-y">
                  {hourLogs.map((log, index) => {
                    const hours = diffHours(log.start, log.end);
                    const invalid = Boolean(
                      log.start && log.end && log.end <= log.start,
                    );
                    const incomplete = Boolean(log.start) !== Boolean(log.end);
                    const pillClass = invalid
                      ? "border border-status-danger bg-status-danger-surface text-status-danger"
                      : hours > 0
                        ? "border border-outline-accent bg-accent-muted text-accent-soft"
                        : "border border-outline-muted bg-surface-muted text-ink-subtle";
                    const pillText =
                      hours > 0
                        ? `${hours.toFixed(2)}h`
                        : invalid
                          ? "Invalid"
                          : "-";
                    return (
                      <div
                        key={log.id}
                        className="hover:bg-surface-muted flex flex-wrap items-start gap-3 py-3 transition"
                      >
                        <div className="text-ink-faint mt-1 text-[11px] font-semibold tracking-wide uppercase">
                          #{index + 1}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className={INLINE_TIME_FIELD_ROW_CLASS}>
                            <TimeSelect
                              value={formatHourLogTime(log.start)}
                              onChange={(value) =>
                                handleHourLogChange(log.id, "start", value)
                              }
                              placeholder="Start"
                              options={timeOptions}
                              invalid={invalid}
                              allowEmpty
                            />
                            <span className="text-ink-subtle text-sm">to</span>
                            <TimeSelect
                              value={formatHourLogTime(log.end)}
                              onChange={(value) =>
                                handleHourLogChange(log.id, "end", value)
                              }
                              placeholder="End"
                              options={timeOptions}
                              invalid={invalid}
                              allowEmpty
                            />
                            <span
                              className={
                                "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " +
                                pillClass
                              }
                            >
                              {pillText}
                            </span>
                          </div>
                          {(invalid || incomplete) && (
                            <div className="text-status-danger text-xs">
                              {invalid
                                ? "End time must be after start time."
                                : "Provide both a start and end time."}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="text-ink-faint hover:bg-surface-muted hover:text-ink-primary mt-1 rounded-full p-1 transition"
                          onClick={() => removeHourLogRow(log.id)}
                          aria-label="Remove interval"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="text-ink-muted flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    Total logged:{" "}
                    <span className="text-ink-primary font-semibold">
                      {totalLoggedHours.toFixed(2)} hours
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={addHourLogRow}
                    className="text-ink-subtle hover:text-ink-primary inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition"
                  >
                    <span className="text-base leading-none">+</span>
                    Add interval
                  </button>
                </div>
              </>
            )}
            {hourLogsValidationMessage && (
              <div className="text-status-danger text-xs">
                {hourLogsValidationMessage}
              </div>
            )}
          </div>
          <div>
            <div className="text-ink-muted mb-1 text-xs">Location</div>
            <label className="text-ink-muted mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isVirtual}
                onChange={(event) => setIsVirtual(event.target.checked)}
                onKeyDown={(event) =>
                  handleCheckboxEnterKey(event, () =>
                    setIsVirtual((prev) => !prev),
                  )
                }
                className="accent-accent-strong h-4 w-4"
              />
              Virtual location
            </label>
            <div className="mb-2">
              <div className="text-ink-subtle text-xs font-semibold tracking-[0.2em] uppercase">
                Specific building search
              </div>
              <div className="text-ink-muted mt-1 text-xs">
                Choose a building, then search only within that building&apos;s
                rooms.
              </div>
            </div>
            <div className="mb-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="text-ink-muted mb-1 text-xs">
                  Building{" "}
                  {!isVirtual ? (
                    <span className="text-status-danger">*</span>
                  ) : null}
                </div>
                <div className="relative">
                  <DropdownSelect
                    value={selectedBuildingAcronym}
                    placeholder="Select building"
                    invalid={showBuildingError}
                    onChange={(acr) => {
                      setSelectedBuildingAcronym(acr);
                      const b =
                        (buildingList.data ?? []).find(
                          (x) => x.acronym === acr,
                        ) ?? null;
                      setSelectedBuildingId(b ? b.id : null);
                    }}
                    options={[
                      { value: "", label: "Select building" },
                      ...(buildingList.data ?? []).map((b) => ({
                        value: b.acronym,
                        label: `${b.acronym} - ${b.name}`,
                      })),
                    ]}
                  />
                </div>
                {showBuildingError ? (
                  <div className="text-status-danger mt-2 text-xs">
                    Select a building or mark the event as virtual.
                  </div>
                ) : null}
              </div>
              <div
                ref={specificLocationWrapRef}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    specificLocationWrapRef.current?.contains(nextTarget)
                  ) {
                    return;
                  }
                  if (activeLocationSearch === "selected-building") {
                    setActiveLocationSearch(null);
                    setLocationHighlight(-1);
                  }
                }}
              >
                <div className="text-ink-muted mb-1 text-xs">Room</div>
                <input
                  placeholder="Search selected building rooms, e.g. 210 or 210A"
                  value={roomNumber}
                  onChange={(e) => {
                    const next = e.target.value.toUpperCase();
                    setRoomNumber(next);
                    setActiveLocationSearch("selected-building");
                    setLocationHighlight(-1);
                  }}
                  onFocus={() => {
                    if (roomNumber.trim().length > 0) {
                      setActiveLocationSearch("selected-building");
                      if (locationMatches.length > 0) {
                        setLocationHighlight((prev) => (prev >= 0 ? prev : 0));
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setLocationHighlight((prev) =>
                        getNextHighlightedIndex(
                          prev,
                          locationMatches.length,
                          1,
                        ),
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setLocationHighlight((prev) =>
                        getNextHighlightedIndex(
                          prev,
                          locationMatches.length,
                          -1,
                        ),
                      );
                    } else if (e.key === "Enter") {
                      const highlightedMatch = getHighlightedItem(
                        locationMatches,
                        locationHighlight,
                      );
                      if (highlightedMatch) {
                        e.preventDefault();
                        handleLocationSelect(highlightedMatch);
                      }
                    } else if (e.key === "Escape") {
                      setLocationHighlight(-1);
                    } else if (e.key === "Tab") {
                      if (activeLocationSearch === "selected-building") {
                        setActiveLocationSearch(null);
                      }
                      setLocationHighlight(-1);
                    }
                  }}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={
                    activeLocationSearch === "selected-building" &&
                    locationQuery.length > 0
                  }
                  aria-controls={specificLocationListboxId}
                  aria-activedescendant={
                    locationHighlight >= 0
                      ? `${specificLocationListboxId}-${locationHighlight}`
                      : undefined
                  }
                  className={`border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 text-sm outline-none ${FOCUSABLE_FIELD_CLASS}`}
                />
                {activeLocationSearch === "selected-building" &&
                  locationQuery.length > 0 && (
                    <div className="relative">
                      <div
                        id={specificLocationListboxId}
                        role="listbox"
                        className="border-outline-strong bg-surface-overlay/95 absolute right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-md border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
                      >
                        {locationResults.isFetching ? (
                          <div className="text-ink-muted px-3 py-2 text-sm">
                            Searching...
                          </div>
                        ) : locationMatches.length > 0 ? (
                          <>
                            {locationMatches.map((match, index) => {
                              const isActive = index === locationHighlight;
                              return (
                                <button
                                  key={`${match.acronym}:${match.roomNumber}:${match.buildingId}:specific`}
                                  type="button"
                                  id={`${specificLocationListboxId}-${index}`}
                                  role="option"
                                  aria-selected={isActive}
                                  tabIndex={-1}
                                  ref={(node) => {
                                    locationOptionRefs.current[index] = node;
                                  }}
                                  className={
                                    "border-outline-muted text-ink-primary flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                                    (isActive
                                      ? "bg-accent-muted"
                                      : "hover:bg-surface-muted")
                                  }
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onMouseEnter={() =>
                                    setLocationHighlight(index)
                                  }
                                  onClick={() => handleLocationSelect(match)}
                                >
                                  <span>
                                    <span className="font-semibold">
                                      {match.acronym}
                                    </span>{" "}
                                    {match.roomNumber}
                                  </span>
                                  <span className="text-ink-subtle text-xs">
                                    {match.buildingName}
                                  </span>
                                </button>
                              );
                            })}
                          </>
                        ) : (
                          <div className="text-ink-muted px-3 py-2 text-sm">
                            <div>No rooms found</div>
                            {!isVirtual &&
                            selectedBuildingId &&
                            roomNumber.trim() ? (
                              <button
                                type="button"
                                className="text-accent-soft hover:text-accent-strong mt-2 text-xs font-semibold"
                                onClick={handleAddRoom}
                                disabled={createRoom.isPending}
                              >
                                {createRoom.isPending
                                  ? "Adding room..."
                                  : `Add room ${roomNumber.trim().toUpperCase()}`}
                              </button>
                            ) : !isVirtual ? (
                              <div className="text-ink-subtle mt-2 text-xs">
                                Select a building and room to add it.
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                <button
                  type="button"
                  onClick={() => void handleAddRoom()}
                  className="text-accent-soft hover:text-accent-strong mt-2 text-xs font-semibold"
                >
                  Add room to event
                </button>
              </div>
            </div>
            {selectedRooms.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {selectedRooms.map((entry) => (
                  <span
                    key={`${entry.roomId}-${entry.buildingId}`}
                    className="border-outline-muted bg-surface-muted text-ink-primary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                  >
                    <span className="font-semibold">{entry.acronym}</span>
                    <span>{entry.roomNumber}</span>
                    <button
                      type="button"
                      className="text-ink-muted hover:text-ink-primary transition"
                      onClick={() =>
                        setSelectedRooms((prev) =>
                          prev.filter((room) => room.roomId !== entry.roomId),
                        )
                      }
                      aria-label={`Remove ${entry.acronym} ${entry.roomNumber}`}
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div
              ref={generalLocationWrapRef}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  nextTarget instanceof Node &&
                  generalLocationWrapRef.current?.contains(nextTarget)
                ) {
                  return;
                }
                if (activeLocationSearch === "all") {
                  setActiveLocationSearch(null);
                  setLocationHighlight(-1);
                }
              }}
            >
              <div className="text-ink-subtle mb-1 text-xs font-semibold tracking-[0.2em] uppercase">
                General building search
              </div>
              <div className="text-ink-muted mb-2 text-xs">
                Searches all buildings by acronym, room number, building name,
                or combinations of those terms.
              </div>
              <input
                placeholder="Search all buildings, e.g. BHG 210A, 210A, BHG, or Brown Hall"
                value={generalLocationSearch}
                onChange={(e) => {
                  const next = e.target.value;
                  setGeneralLocationSearch(next);
                  setLocation(next);
                  setActiveLocationSearch("all");
                }}
                onFocus={() => {
                  if (generalLocationSearch.trim().length > 0) {
                    setActiveLocationSearch("all");
                    if (locationMatches.length > 0) {
                      setLocationHighlight((prev) => (prev >= 0 ? prev : 0));
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setLocationHighlight((prev) =>
                      getNextHighlightedIndex(prev, locationMatches.length, 1),
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setLocationHighlight((prev) =>
                      getNextHighlightedIndex(prev, locationMatches.length, -1),
                    );
                  } else if (e.key === "Enter") {
                    const highlightedMatch = getHighlightedItem(
                      locationMatches,
                      locationHighlight,
                    );
                    if (highlightedMatch) {
                      e.preventDefault();
                      handleLocationSelect(highlightedMatch);
                    }
                  } else if (e.key === "Escape") {
                    setLocationHighlight(-1);
                  } else if (e.key === "Tab") {
                    if (activeLocationSearch === "all") {
                      setActiveLocationSearch(null);
                    }
                    setLocationHighlight(-1);
                  }
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={
                  activeLocationSearch === "all" && locationQuery.length > 0
                }
                aria-controls={generalLocationListboxId}
                aria-activedescendant={
                  locationHighlight >= 0
                    ? `${generalLocationListboxId}-${locationHighlight}`
                    : undefined
                }
                className={`border-outline-muted bg-surface-muted text-ink-primary placeholder:text-ink-faint w-full rounded-md border px-3 py-2 outline-none ${FOCUSABLE_FIELD_CLASS}`}
              />
              {activeLocationSearch === "all" && locationQuery.length > 0 && (
                <div className="relative">
                  <div
                    id={generalLocationListboxId}
                    role="listbox"
                    className="border-outline-strong bg-surface-overlay/95 absolute right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-md border shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur-2xl backdrop-saturate-200"
                  >
                    {locationResults.isFetching ? (
                      <div className="text-ink-muted px-3 py-2 text-sm">
                        Searching...
                      </div>
                    ) : locationMatches.length > 0 ? (
                      <>
                        {locationMatches.map((match, index) => {
                          const isActive = index === locationHighlight;
                          return (
                            <button
                              key={`${match.acronym}:${match.roomNumber}:${match.buildingId}`}
                              type="button"
                              id={`${generalLocationListboxId}-${index}`}
                              role="option"
                              aria-selected={isActive}
                              tabIndex={-1}
                              ref={(node) => {
                                locationOptionRefs.current[index] = node;
                              }}
                              className={
                                "border-outline-muted text-ink-primary flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 " +
                                (isActive
                                  ? "bg-accent-muted"
                                  : "hover:bg-surface-muted")
                              }
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setLocationHighlight(index)}
                              onClick={() => handleLocationSelect(match)}
                            >
                              <span>
                                <span className="font-semibold">
                                  {match.acronym}
                                </span>{" "}
                                {match.roomNumber}
                              </span>
                              <span className="text-ink-subtle text-xs">
                                {match.buildingName}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    ) : (
                      <div className="text-ink-muted px-3 py-2 text-sm">
                        <div>No rooms found</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {addRoomError && (
              <div className="text-status-danger mt-2 text-xs">
                {addRoomError}
              </div>
            )}
          </div>

          {error && (
            <div className="border-status-danger bg-status-danger-surface text-status-danger rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex gap-2">
              {isEditing && event && (
                <button
                  type="button"
                  className="border-status-danger text-status-danger hover:bg-status-danger-surface disabled:border-status-danger/60 disabled:text-status-danger/60 rounded-md border px-3 py-1.5 text-sm font-medium transition"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                </button>
              )}
              {!isEditing && (
                <button
                  type="button"
                  className="border-outline-muted text-ink-muted hover:bg-surface-muted hover:text-ink-primary rounded-md border px-3 py-1.5 text-sm font-medium transition"
                  onClick={handleClearForm}
                >
                  Clear Form
                </button>
              )}
            </div>
            <button
              className="bg-accent-strong text-ink-inverted rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
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
