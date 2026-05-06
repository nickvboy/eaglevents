"use client";

import { useMemo, useState } from "react";

import type { AnalyticsGlobalFilters } from "~/server/services/admin-analytics";

type Option = {
  value: string | number;
  label: string;
};

type Meta = {
  buildingOptions: Option[];
  roomOptions: Option[];
  requestCategoryOptions: Option[];
  requesterOptions: Option[];
  eventTypeOptions: Option[];
};

function toDateInputValue(value: Date | null) {
  if (!value) return "";
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function SegmentedButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1.5 text-xs font-semibold transition " +
        (active
          ? "bg-accent-strong text-white shadow-[var(--shadow-accent-glow)]"
          : "border-outline-muted bg-surface-muted text-ink-muted hover:text-ink-primary border")
      }
    >
      {label}
    </button>
  );
}

function FilterChecklist(props: {
  label: string;
  options: Option[];
  selectedValues: Array<string | number>;
  onToggle: (value: string | number) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return props.options;
    return props.options.filter((option) =>
      option.label.toLowerCase().includes(normalized),
    );
  }, [props.options, query]);

  return (
    <div className="border-outline-muted bg-surface-muted rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-ink-primary text-sm font-semibold">
          {props.label}
        </h4>
        <span className="text-ink-muted text-xs">
          {props.selectedValues.length} selected
        </span>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${props.label.toLowerCase()}`}
        className="border-outline-muted bg-surface-canvas text-ink-primary focus:border-accent-strong mt-3 w-full rounded-lg border px-3 py-2 text-sm transition outline-none"
      />
      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
        {filtered.map((option) => {
          const checked = props.selectedValues.includes(option.value);
          return (
            <label
              key={String(option.value)}
              className="text-ink-muted flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => props.onToggle(option.value)}
                className="border-outline-muted h-4 w-4 rounded"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function AnalyticsFilterBar(props: {
  meta: Meta;
  value: AnalyticsGlobalFilters;
  onChange: (value: AnalyticsGlobalFilters) => void;
  onReset: () => void;
}) {
  const update = <K extends keyof AnalyticsGlobalFilters>(
    key: K,
    value: AnalyticsGlobalFilters[K],
  ) => {
    props.onChange({ ...props.value, [key]: value });
  };
  const updateCustomDate = (
    key: "customStart" | "customEnd",
    value: Date | null,
  ) => {
    const nextValue = { ...props.value, [key]: value };
    if (nextValue.customStart && nextValue.customEnd) {
      nextValue.rangePreset = "custom";
    }
    props.onChange(nextValue);
  };
  const toggleNumber = (
    key: "buildingIds" | "roomIds",
    value: string | number,
  ) => {
    const numericValue = Number(value);
    const list = props.value[key];
    update(
      key,
      list.includes(numericValue)
        ? list.filter((entry) => entry !== numericValue)
        : [...list, numericValue],
    );
  };
  const toggleString = (
    key: "eventTypes" | "requestCategories" | "requesterKeys",
    value: string | number,
  ) => {
    const stringValue = String(value);
    const list = props.value[key];
    update(
      key,
      list.includes(stringValue)
        ? list.filter((entry) => entry !== stringValue)
        : [...list, stringValue],
    );
  };

  return (
    <section className="border-outline-muted bg-surface-raised rounded-2xl border p-5 shadow-[var(--shadow-pane)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-ink-muted text-xs tracking-[0.2em] uppercase">
              Global filters
            </p>
            <h2 className="text-ink-primary mt-1 text-lg font-semibold">
              Adjust the analytics window and focus
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {["1M", "3M", "6M", "YTD", "12M", "custom"].map((preset) => (
              <SegmentedButton
                key={preset}
                label={preset === "custom" ? "Custom" : preset}
                active={props.value.rangePreset === preset}
                onClick={() =>
                  update(
                    "rangePreset",
                    preset as AnalyticsGlobalFilters["rangePreset"],
                  )
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {["auto", "day", "week", "month", "quarter"].map((frequency) => (
              <SegmentedButton
                key={frequency}
                label={frequency}
                active={props.value.frequency === frequency}
                onClick={() =>
                  update(
                    "frequency",
                    frequency as AnalyticsGlobalFilters["frequency"],
                  )
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {["all", "physical", "virtual"].map((mode) => (
              <SegmentedButton
                key={mode}
                label={mode}
                active={props.value.locationMode === mode}
                onClick={() =>
                  update(
                    "locationMode",
                    mode as AnalyticsGlobalFilters["locationMode"],
                  )
                }
              />
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:w-[420px]">
          <label className="text-ink-muted flex flex-col gap-1 text-sm">
            <span>Custom start</span>
            <input
              type="date"
              value={toDateInputValue(props.value.customStart)}
              onChange={(event) =>
                updateCustomDate(
                  "customStart",
                  event.target.value
                    ? new Date(`${event.target.value}T00:00:00`)
                    : null,
                )
              }
              className="border-outline-muted bg-surface-canvas text-ink-primary focus:border-accent-strong rounded-lg border px-3 py-2 transition outline-none"
            />
          </label>
          <label className="text-ink-muted flex flex-col gap-1 text-sm">
            <span>Custom end</span>
            <input
              type="date"
              value={toDateInputValue(props.value.customEnd)}
              onChange={(event) =>
                updateCustomDate(
                  "customEnd",
                  event.target.value
                    ? new Date(`${event.target.value}T00:00:00`)
                    : null,
                )
              }
              className="border-outline-muted bg-surface-canvas text-ink-primary focus:border-accent-strong rounded-lg border px-3 py-2 transition outline-none"
            />
          </label>
          <label className="text-ink-muted flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.value.includeAllDay}
              onChange={(event) =>
                update("includeAllDay", event.target.checked)
              }
              className="border-outline-muted h-4 w-4 rounded"
            />
            <span>Include all-day events</span>
          </label>
          <div className="flex items-center justify-start sm:justify-end">
            <button
              type="button"
              onClick={props.onReset}
              className="border-outline-muted text-ink-muted hover:text-ink-primary rounded-full border px-4 py-2 text-sm font-semibold transition"
            >
              Reset filters
            </button>
          </div>
        </div>
      </div>

      <details className="border-outline-muted bg-surface-muted mt-5 rounded-xl border p-4">
        <summary className="text-ink-primary cursor-pointer text-sm font-semibold">
          Advanced filters
        </summary>
        <div className="mt-4 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          <FilterChecklist
            label="Buildings"
            options={props.meta.buildingOptions}
            selectedValues={props.value.buildingIds}
            onToggle={(value) => toggleNumber("buildingIds", value)}
          />
          <FilterChecklist
            label="Rooms"
            options={props.meta.roomOptions}
            selectedValues={props.value.roomIds}
            onToggle={(value) => toggleNumber("roomIds", value)}
          />
          <FilterChecklist
            label="Event types"
            options={props.meta.eventTypeOptions}
            selectedValues={props.value.eventTypes}
            onToggle={(value) => toggleString("eventTypes", value)}
          />
          <FilterChecklist
            label="Request categories"
            options={props.meta.requestCategoryOptions}
            selectedValues={props.value.requestCategories}
            onToggle={(value) => toggleString("requestCategories", value)}
          />
          <FilterChecklist
            label="Requesters"
            options={props.meta.requesterOptions}
            selectedValues={props.value.requesterKeys}
            onToggle={(value) => toggleString("requesterKeys", value)}
          />
        </div>
      </details>
    </section>
  );
}
