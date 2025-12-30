"use client";

import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";

import { SearchIcon } from "~/app/_components/icons";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

type DatabaseSummary = RouterOutputs["admin"]["databaseSummary"];
type DatabaseEventQuery = NonNullable<RouterInputs["admin"]["databaseEvents"]>;
type DatabaseEvent = RouterOutputs["admin"]["databaseEvents"]["events"][number];
type DatabaseSeedInput = RouterInputs["admin"]["seedDatabase"];
type SeedMode = DatabaseSeedInput["mode"];

const defaultEventQuery: DatabaseEventQuery = { limit: 50 };
const DEFAULT_SEED_EVENT_COUNT = 15;
const DEFAULT_FULL_SEED_EVENT_COUNT = 420;
const seedDefaultCounts: Record<SeedMode, number> = {
  workspace: DEFAULT_SEED_EVENT_COUNT,
  events: DEFAULT_SEED_EVENT_COUNT,
  full: DEFAULT_FULL_SEED_EVENT_COUNT,
  revert: 0,
};

const summarySections: Array<{ label: string; key: keyof DatabaseSummary["counts"] }> = [
  { label: "Events", key: "events" },
  { label: "Attendees", key: "eventAttendees" },
  { label: "Reminders", key: "eventReminders" },
  { label: "Hour Logs", key: "eventHourLogs" },
  { label: "Confirmations", key: "eventZendeskConfirmations" },
  { label: "Calendars", key: "calendars" },
  { label: "Businesses", key: "businesses" },
  { label: "Buildings", key: "buildings" },
  { label: "Rooms", key: "rooms" },
  { label: "Departments", key: "departments" },
  { label: "Theme Palettes", key: "themePalettes" },
  { label: "Theme Profiles", key: "themeProfiles" },
  { label: "Posts", key: "posts" },
];

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Unknown";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Invalid date";
  return parsed.toLocaleString();
}

function toStartOfDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toExclusiveEndOfDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date;
}

function buildEventQuery({
  search,
  startDate,
  endDate,
  limit,
}: {
  search: string;
  startDate: string;
  endDate: string;
  limit: number;
}): DatabaseEventQuery {
  const nextQuery: DatabaseEventQuery = { limit };
  if (search.trim()) nextQuery.search = search.trim();
  const start = startDate ? toStartOfDay(startDate) : null;
  const end = endDate ? toExclusiveEndOfDay(endDate) : null;
  if (start) nextQuery.start = start;
  if (end) nextQuery.end = end;
  return nextQuery;
}

export function DatabaseView() {
  const utils = api.useUtils();
  const summaryQuery = api.admin.databaseSummary.useQuery(undefined, { staleTime: 30_000 });
  const seedMutation = api.admin.seedDatabase.useMutation();

  const [eventSearch, setEventSearch] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventLimit, setEventLimit] = useState(50);
  const [eventQuery, setEventQuery] = useState<DatabaseEventQuery>(defaultEventQuery);
  const [pendingDelete, setPendingDelete] = useState<DatabaseEvent | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [seedMode, setSeedMode] = useState<SeedMode>("full");
  const [seedEventCount, setSeedEventCount] = useState(String(seedDefaultCounts.full));
  const [seedFakerSeed, setSeedFakerSeed] = useState("");
  const [seedConfirmText, setSeedConfirmText] = useState("");
  const [seedMessage, setSeedMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [seedLogs, setSeedLogs] = useState<string[]>([]);

  const [rangeStartDate, setRangeStartDate] = useState("");
  const [rangeEndDate, setRangeEndDate] = useState("");
  const [rangeConfirmText, setRangeConfirmText] = useState("");
  const [deleteAllChecked, setDeleteAllChecked] = useState(false);

  const eventsQuery = api.admin.databaseEvents.useQuery(eventQuery);
  const rangeInput = useMemo(() => {
    if (!rangeStartDate || !rangeEndDate) return undefined;
    const start = toStartOfDay(rangeStartDate);
    const end = toExclusiveEndOfDay(rangeEndDate);
    if (!start || !end) return undefined;
    return { start, end };
  }, [rangeEndDate, rangeStartDate]);
  const rangeCountQuery = api.admin.databaseEventCount.useQuery(rangeInput ?? skipToken, {
    enabled: Boolean(rangeInput) && !deleteAllChecked,
  });

  const deleteMutation = api.admin.deleteEvent.useMutation({
    onSuccess: async () => {
      await utils.admin.databaseEvents.invalidate();
      await utils.admin.databaseSummary.invalidate();
    },
  });

  const deleteRangeMutation = api.admin.deleteEventsByRange.useMutation({
    onSuccess: async () => {
      await utils.admin.databaseEvents.invalidate();
      await utils.admin.databaseSummary.invalidate();
      await utils.admin.databaseEventCount.invalidate();
    },
  });

  const deleteAllMutation = api.admin.deleteAllEvents.useMutation({
    onSuccess: async () => {
      await utils.admin.databaseEvents.invalidate();
      await utils.admin.databaseSummary.invalidate();
      await utils.admin.databaseEventCount.invalidate();
    },
  });

  const canDeleteRange =
    rangeConfirmText.trim().toUpperCase() === "DELETE" && (deleteAllChecked || Boolean(rangeInput));
  const canDeleteSelected = pendingDelete && deleteConfirmText.trim().toUpperCase() === "DELETE";
  const totalEvents = summaryQuery.data?.counts.events ?? 0;
  const rangeCountValue = deleteAllChecked ? totalEvents : rangeCountQuery.data?.count ?? 0;
  const seedNeedsEventCount = seedMode === "events" || seedMode === "full";
  const seedEventCountValue = seedNeedsEventCount ? Number(seedEventCount) : null;
  const seedEventCountValid =
    !seedNeedsEventCount ||
    (seedEventCountValue !== null && Number.isFinite(seedEventCountValue) && seedEventCountValue >= 0);
  const seedFakerSeedValue = seedFakerSeed.trim() ? Number(seedFakerSeed) : null;
  const seedFakerSeedValid =
    seedFakerSeed.trim() === "" || (seedFakerSeedValue !== null && Number.isFinite(seedFakerSeedValue));
  const requiresSeedConfirm = seedMode === "revert";
  const canRunSeed =
    seedEventCountValid &&
    seedFakerSeedValid &&
    (!requiresSeedConfirm || seedConfirmText.trim().toUpperCase() === "REVERT");

  const summaryCards = useMemo(() => {
    const summary = summaryQuery.data;
    if (!summary) return [];
    return summarySections.map((section) => ({
      label: section.label,
      value: summary.counts[section.key],
    }));
  }, [summaryQuery.data]);

  const handleSeedModeChange = (value: SeedMode) => {
    setSeedMode(value);
    setSeedEventCount(String(seedDefaultCounts[value]));
    setSeedConfirmText("");
    setSeedMessage(null);
    setSeedLogs([]);
  };

  const handleSeedRun = async () => {
    setSeedMessage(null);
    setSeedLogs([]);

    if (!seedEventCountValid) {
      setSeedMessage({ type: "error", text: "Event count must be zero or a positive number." });
      return;
    }
    if (!seedFakerSeedValid) {
      setSeedMessage({ type: "error", text: "Seed value must be a valid number." });
      return;
    }

    const fakerSeed = seedFakerSeed.trim() ? Number(seedFakerSeed) : null;
    const input: DatabaseSeedInput = {
      mode: seedMode,
      eventCount: seedNeedsEventCount ? (seedEventCountValue ?? 0) : undefined,
      fakerSeed,
    };

    try {
      const result = await seedMutation.mutateAsync(input);
      setSeedMessage({
        type: "success",
        text:
          result.mode === "revert"
            ? "Seeded data removed."
            : `Seeded ${result.seededEvents} event${result.seededEvents === 1 ? "" : "s"}.`,
      });
      setSeedLogs(result.logs ?? []);
      setSeedConfirmText("");
      await utils.admin.databaseSummary.invalidate();
      await utils.admin.databaseEvents.invalidate();
      await utils.admin.databaseEventCount.invalidate();
    } catch (error) {
      setSeedMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Seeding failed.",
      });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Database overview</h2>
          <p className="text-sm text-ink-muted">
            Review record counts across core tables. User management stays in the Users tab.
          </p>
        </header>
        {summaryQuery.isLoading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-20 rounded-2xl border border-outline-muted bg-surface-muted p-4">
                <div className="h-full animate-pulse rounded-xl bg-surface-muted" />
              </div>
            ))}
          </div>
        ) : summaryQuery.isError ? (
          <div className="mt-6 rounded-xl border border-status-danger bg-status-danger-surface px-4 py-3 text-sm text-status-danger">
            Unable to load database counts. Please try again.
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-outline-muted bg-surface-muted px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-ink-muted">{card.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-ink-primary">{card.value}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-subtle">
              Last refreshed: {formatDateTime(summaryQuery.data?.updatedAt)}
            </p>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Database seeding</h2>
          <p className="text-sm text-ink-muted">
            Run the same seed workflow used by the CLI against the current database connection.
          </p>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="grid gap-4">
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
              Seed mode
              <select
                value={seedMode}
                onChange={(event) => handleSeedModeChange(event.target.value as SeedMode)}
                className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary"
              >
                <option value="full">Full (workspace + events)</option>
                <option value="workspace">Workspace only</option>
                <option value="events">Events only</option>
                <option value="revert">Revert seeded data</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
              Event count
              <input
                type="number"
                min={0}
                value={seedEventCount}
                disabled={!seedNeedsEventCount}
                onChange={(event) => setSeedEventCount(event.target.value)}
                className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span className="text-xs font-normal text-ink-subtle">
                Used for events or full mode. Leave at 0 to skip event creation.
              </span>
            </label>

            <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
              Faker seed (optional)
              <input
                type="number"
                value={seedFakerSeed}
                onChange={(event) => setSeedFakerSeed(event.target.value)}
                className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
              <span className="text-xs font-normal text-ink-subtle">Set this for deterministic output.</span>
            </label>

            {requiresSeedConfirm ? (
              <label className="flex flex-col gap-2 text-sm font-semibold text-status-danger">
                Type REVERT to confirm
                <input
                  value={seedConfirmText}
                  onChange={(event) => setSeedConfirmText(event.target.value)}
                  placeholder="REVERT"
                  className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
                />
              </label>
            ) : null}
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-xl border border-outline-muted bg-surface-muted px-4 py-4">
            <div className="space-y-1 text-xs text-ink-subtle">
              <div className="uppercase tracking-[0.2em] text-ink-muted">Seed target</div>
              <div>Uses the active database connection for this environment.</div>
              <div>
                Mode: <span className="font-semibold text-ink-primary">{seedMode}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSeedRun()}
              disabled={!canRunSeed || seedMutation.isPending}
              className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {seedMutation.isPending ? "Seeding..." : "Run seed"}
            </button>
          </div>
        </div>

        {seedMessage ? (
          <div
            className={
              "mt-4 rounded-xl border px-4 py-2 text-sm " +
              (seedMessage.type === "success"
                ? "border-outline-accent bg-accent-muted text-accent-soft"
                : "border-status-danger bg-status-danger-surface text-status-danger")
            }
          >
            {seedMessage.text}
          </div>
        ) : null}

        {seedLogs.length > 0 ? (
          <div className="mt-4 rounded-xl border border-outline-muted bg-surface-muted px-4 py-3 text-xs text-ink-subtle">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-ink-muted">Seed output</div>
            <div className="space-y-1">
              {seedLogs.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Event management</h2>
          <p className="text-sm text-ink-muted">
            Search events by title, event code, Zendesk ticket, or ID. Delete removes related attendees, reminders, logs,
            and confirmations.
          </p>
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
            Search
            <div className="flex items-center gap-2 rounded-xl border border-outline-muted bg-surface-muted px-3 py-2">
              <SearchIcon className="h-4 w-4 text-ink-subtle" />
              <input
                value={eventSearch}
                onChange={(event) => setEventSearch(event.target.value)}
                placeholder="Title, event code, ticket number, or ID"
                className="w-full bg-transparent text-sm text-ink-primary focus:outline-none"
              />
            </div>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
              Start date
              <input
                type="date"
                value={eventStartDate}
                onChange={(event) => setEventStartDate(event.target.value)}
                className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
              End date
              <input
                type="date"
                value={eventEndDate}
                onChange={(event) => setEventEndDate(event.target.value)}
                className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span>Limit</span>
            <select
              value={eventLimit}
              onChange={(event) => setEventLimit(Number(event.target.value))}
              className="rounded-lg border border-outline-muted bg-surface-muted px-2 py-1 text-sm text-ink-primary"
            >
              {[25, 50, 100, 150, 200].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              setEventQuery(
                buildEventQuery({
                  search: eventSearch,
                  startDate: eventStartDate,
                  endDate: eventEndDate,
                  limit: eventLimit,
                }),
              )
            }
            className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              setEventSearch("");
              setEventStartDate("");
              setEventEndDate("");
              setEventLimit(50);
              setEventQuery(defaultEventQuery);
            }}
            className="rounded-full border border-outline-muted px-4 py-2 text-sm font-semibold text-ink-primary transition hover:bg-surface-overlay"
          >
            Reset
          </button>
          <span className="text-xs text-ink-subtle">
            {eventsQuery.data?.total ?? 0} total matching events
          </span>
        </div>

        <div className="mt-6 rounded-2xl border border-outline-muted bg-surface-muted">
          {eventsQuery.isLoading ? (
            <div className="p-6 text-sm text-ink-muted">Loading events...</div>
          ) : eventsQuery.isError ? (
            <div className="p-6 text-sm text-status-danger">Unable to load events. Please try again.</div>
          ) : (eventsQuery.data?.events.length ?? 0) === 0 ? (
            <div className="p-6 text-sm text-ink-muted">No events found for the selected filters.</div>
          ) : (
            <div className="divide-y divide-outline-muted">
              {eventsQuery.data?.events.map((event) => (
                <div key={event.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[2fr_1fr_auto]">
                  <div>
                    <div className="text-sm font-semibold text-ink-primary">{event.title}</div>
                    <div className="mt-1 text-xs text-ink-muted">
                      ID {event.id} | Code {event.eventCode} | {formatDateTime(event.startDatetime)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink-subtle">
                      <span>Attendees: {event.counts.attendees}</span>
                      <span>Reminders: {event.counts.reminders}</span>
                      <span>Hour logs: {event.counts.hourLogs}</span>
                      <span>Confirmations: {event.counts.confirmations}</span>
                    </div>
                  </div>
                  <div className="text-xs text-ink-subtle">
                    <div>Calendar ID: {event.calendarId}</div>
                    <div>Building ID: {event.buildingId ?? "None"}</div>
                    <div>Assignee: {event.assigneeProfileId ?? "Unassigned"}</div>
                    <div>Zendesk: {event.zendeskTicketNumber ?? "None"}</div>
                  </div>
                  <div className="flex items-start justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDelete(event);
                        setDeleteConfirmText("");
                      }}
                      className="rounded-full border border-status-danger px-4 py-2 text-sm font-semibold text-status-danger transition hover:bg-status-danger-surface"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {pendingDelete ? (
          <div className="mt-6 rounded-2xl border border-status-danger bg-status-danger-surface p-5">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-status-danger">Confirm event deletion</h3>
              <p className="text-xs text-status-danger">
                This permanently removes the event and related records. Type DELETE to confirm.
              </p>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_auto]">
              <input
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="DELETE"
                className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="rounded-full border border-outline-muted px-4 py-2 text-sm font-semibold text-ink-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canDeleteSelected || deleteMutation.isPending}
                  onClick={async () => {
                    if (!pendingDelete) return;
                    await deleteMutation.mutateAsync({ id: pendingDelete.id });
                    setPendingDelete(null);
                    setDeleteConfirmText("");
                  }}
                  className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleteMutation.isPending ? "Deleting..." : `Delete ${pendingDelete.eventCode}`}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-status-danger">Bulk delete events</h2>
          <p className="text-sm text-status-danger">
            Remove events that start within a date range. This cannot be undone.
          </p>
        </header>
        <div className="mt-4 rounded-xl border border-status-danger bg-surface-raised px-4 py-3 text-sm text-status-danger">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deleteAllChecked}
              onChange={(event) => setDeleteAllChecked(event.target.checked)}
              className="h-4 w-4 accent-status-danger"
            />
            Delete all events (ignore date range)
          </label>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-status-danger">
              Start date
              <input
                type="date"
                value={rangeStartDate}
                onChange={(event) => setRangeStartDate(event.target.value)}
                disabled={deleteAllChecked}
                className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-status-danger">
              End date
              <input
                type="date"
                value={rangeEndDate}
                onChange={(event) => setRangeEndDate(event.target.value)}
                disabled={deleteAllChecked}
                className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-status-danger bg-surface-raised px-4 py-3 text-xs text-status-danger">
            <span className="uppercase tracking-[0.2em]">Range summary</span>
            <span className="text-sm font-semibold">
              {deleteAllChecked
                ? `${rangeCountValue} events matched`
                : rangeInput
                  ? `${rangeCountValue} events matched`
                  : "Choose a range"}
            </span>
            <span className="text-xs text-ink-subtle">End date is inclusive.</span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-2 rounded-xl border border-status-danger bg-surface-raised p-4">
            <label className="flex items-center gap-2 text-sm text-status-danger">
              <input
                type="checkbox"
                checked={canDeleteRange}
                readOnly
                className="h-4 w-4 accent-status-danger"
              />
              Type DELETE to confirm
            </label>
            <input
              value={rangeConfirmText}
              onChange={(event) => setRangeConfirmText(event.target.value)}
              placeholder="DELETE"
              className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
            />
          </div>
          <div className="flex flex-col justify-end gap-2 rounded-xl border border-status-danger bg-surface-raised p-4">
            <button
              type="button"
              disabled={
                !canDeleteRange || deleteRangeMutation.isPending || deleteAllMutation.isPending
              }
              onClick={async () => {
                if (deleteAllChecked) {
                  await deleteAllMutation.mutateAsync();
                } else {
                  if (!rangeInput) return;
                  await deleteRangeMutation.mutateAsync(rangeInput);
                }
                setRangeConfirmText("");
                setDeleteAllChecked(false);
              }}
              className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteRangeMutation.isPending || deleteAllMutation.isPending
                ? "Deleting..."
                : deleteAllChecked
                  ? "Delete all events"
                  : "Delete events in range"}
            </button>
            <p className="text-xs text-ink-subtle">Bulk deletes also remove attendees, reminders, logs, and confirmations.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
