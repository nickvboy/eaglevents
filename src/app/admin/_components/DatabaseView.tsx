"use client";

import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";

import { SearchIcon } from "~/app/_components/icons";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

type DatabaseSummary = RouterOutputs["admin"]["databaseSummary"];
type DatabaseEventQuery = NonNullable<RouterInputs["admin"]["databaseEvents"]>;
type DatabaseEvent = RouterOutputs["admin"]["databaseEvents"]["events"][number];

const defaultEventQuery: DatabaseEventQuery = { limit: 50 };

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

  const [eventSearch, setEventSearch] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventLimit, setEventLimit] = useState(50);
  const [eventQuery, setEventQuery] = useState<DatabaseEventQuery>(defaultEventQuery);
  const [pendingDelete, setPendingDelete] = useState<DatabaseEvent | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [rangeStartDate, setRangeStartDate] = useState("");
  const [rangeEndDate, setRangeEndDate] = useState("");
  const [rangeConfirmText, setRangeConfirmText] = useState("");
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false);

  const eventsQuery = api.admin.databaseEvents.useQuery(eventQuery);
  const rangeInput = useMemo(() => {
    if (!rangeStartDate || !rangeEndDate) return undefined;
    const start = toStartOfDay(rangeStartDate);
    const end = toExclusiveEndOfDay(rangeEndDate);
    if (!start || !end) return undefined;
    return { start, end };
  }, [rangeEndDate, rangeStartDate]);
  const rangeCountQuery = api.admin.databaseEventCount.useQuery(rangeInput ?? skipToken, {
    enabled: Boolean(rangeInput),
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

  const deleteConfirmReady = rangeConfirmText.trim().toUpperCase() === "DELETE";
  const canDeleteSelected = pendingDelete && deleteConfirmText.trim().toUpperCase() === "DELETE";
  const totalEvents = summaryQuery.data?.counts.events ?? 0;
  const rangeCountValue = rangeCountQuery.data?.count ?? 0;
  const isDeleteAllMode = !rangeInput;
  const canDeleteRange = deleteConfirmReady;

  const summaryCards = useMemo(() => {
    const summary = summaryQuery.data;
    if (!summary) return [];
    return summarySections.map((section) => ({
      label: section.label,
      value: summary.counts[section.key],
    }));
  }, [summaryQuery.data]);

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
          <h2 className="text-lg font-semibold text-ink-primary">Event management</h2>
          <p className="text-sm text-ink-muted">
            Search events by title, event code, Zendesk ticket, or ID. Deleting events never removes users.
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
            Remove events that overlap a date range, or leave it empty to delete everything. This cannot be undone.
          </p>
        </header>
        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-status-danger">
              Start date
              <input
                type="date"
                value={rangeStartDate}
                onChange={(event) => setRangeStartDate(event.target.value)}
                className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-status-danger">
              End date
              <input
                type="date"
                value={rangeEndDate}
                onChange={(event) => setRangeEndDate(event.target.value)}
                className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-status-danger bg-surface-raised px-4 py-3 text-xs text-status-danger">
            <span className="uppercase tracking-[0.2em]">Range summary</span>
            <span className="text-sm font-semibold">
              {rangeInput ? `${rangeCountValue} events matched` : `${totalEvents} events total`}
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
              disabled={!canDeleteRange || deleteRangeMutation.isPending || deleteAllMutation.isPending}
              onClick={async () => {
                if (isDeleteAllMode) {
                  setDeleteAllModalOpen(true);
                  return;
                }
                if (!rangeInput) return;
                await deleteRangeMutation.mutateAsync(rangeInput);
                setRangeConfirmText("");
              }}
              className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteRangeMutation.isPending || deleteAllMutation.isPending
                ? "Deleting..."
                : isDeleteAllMode
                  ? "Delete all events"
                  : "Delete events in range"}
            </button>
            <p className="text-xs text-ink-subtle">Bulk deletes never remove users.</p>
          </div>
        </div>
      </section>
      {deleteAllModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl border border-status-danger bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
            <h3 className="text-lg font-semibold text-status-danger">Confirm delete all events</h3>
            <p className="mt-2 text-sm text-ink-muted">
              This removes all events across the system. Users are not affected. This cannot be undone.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteAllModalOpen(false)}
                className="rounded-full border border-outline-muted px-4 py-2 text-sm font-semibold text-ink-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteAllMutation.isPending}
                onClick={async () => {
                  await deleteAllMutation.mutateAsync();
                  setDeleteAllModalOpen(false);
                  setRangeConfirmText("");
                }}
                className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-status-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteAllMutation.isPending ? "Deleting..." : "Delete all events"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
