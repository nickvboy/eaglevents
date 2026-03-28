"use client";

import { useCallback, useMemo, useState } from "react";

import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { parseIcsEvents } from "~/app/calendar/utils/ics";

type ExportSnapshotPayload = RouterOutputs["admin"]["exportSnapshot"];
type ImportSnapshotInput = RouterInputs["admin"]["importSnapshot"];
type JoinTableExportStatus = RouterOutputs["admin"]["joinTableExportStatus"];
type HourLogExportStatus = RouterOutputs["admin"]["hourLogExportStatus"];

type SnapshotSummary = {
  version: number;
  exportedAt: string;
  exportedBy: string | null;
  note: string | null;
  counts: Array<{ label: string; count: number }>;
};

const SUPPORTED_SNAPSHOT_VERSION = 2;
const SNAPSHOT_FORMAT_LABEL = `Version ${SUPPORTED_SNAPSHOT_VERSION} (JSON)`;

const snapshotDataSections = [
  { key: "users", label: "Users" },
  { key: "posts", label: "Posts" },
  { key: "profiles", label: "Profiles" },
  { key: "organizationRoles", label: "Org roles" },
  { key: "visibilityGrants", label: "Visibility grants" },
  { key: "businesses", label: "Businesses" },
  { key: "departments", label: "Departments" },
  { key: "buildings", label: "Buildings" },
  { key: "rooms", label: "Rooms" },
  { key: "themePalettes", label: "Theme palettes" },
  { key: "themeProfiles", label: "Theme profiles" },
  { key: "calendars", label: "Calendars" },
  { key: "events", label: "Events" },
  { key: "eventRooms", label: "Event rooms" },
  { key: "eventCoOwners", label: "Event co-owners" },
  { key: "eventAttendees", label: "Event attendees" },
  { key: "eventReminders", label: "Event reminders" },
  { key: "eventHourLogs", label: "Event hour logs" },
  { key: "eventZendeskConfirmations", label: "Event confirmations" },
  { key: "auditLogs", label: "Audit logs" },
] as const;

type SnapshotDataKey = (typeof snapshotDataSections)[number]["key"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Invalid date";
  return parsed.toLocaleString();
}

function formatFilenameTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "snapshot";
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${parsed.getFullYear()}${pad(parsed.getMonth() + 1)}${pad(parsed.getDate())}-${pad(parsed.getHours())}${pad(parsed.getMinutes())}`;
}

function buildSnapshotSummary(snapshot: ImportSnapshotInput): SnapshotSummary {
  const data = snapshot.data as Record<SnapshotDataKey, unknown[]>;
  const exportedBy = snapshot.exportedBy
    ? snapshot.exportedBy.displayName ?? snapshot.exportedBy.email ?? null
    : null;
  return {
    version: snapshot.version,
    exportedAt: snapshot.exportedAt,
    exportedBy,
    note: snapshot.metadata?.note ?? null,
    counts: snapshotDataSections.map((section) => ({
      label: section.label,
      count: Array.isArray(data[section.key]) ? data[section.key].length : 0,
    })),
  };
}

function validateSnapshotPayload(value: unknown): { snapshot: ImportSnapshotInput; summary: SnapshotSummary } | { error: string } {
  if (!isRecord(value)) {
    return { error: "Snapshot file is not a valid JSON object." };
  }

  const version = value.version;
  const exportedAt = value.exportedAt;
  const data = value.data;
  if (typeof version !== "number") {
    return { error: "Snapshot version is missing or invalid." };
  }
  if (version !== SUPPORTED_SNAPSHOT_VERSION) {
    return { error: `Snapshot version ${version} is not supported.` };
  }
  if (typeof exportedAt !== "string") {
    return { error: "Snapshot export date is missing." };
  }
  if (!isRecord(data)) {
    return { error: "Snapshot payload is missing data sections." };
  }

  for (const section of snapshotDataSections) {
    if (section.key in data && !Array.isArray(data[section.key])) {
      return { error: `Snapshot section "${section.label}" is missing or invalid.` };
    }
  }

  const snapshot = value as ImportSnapshotInput;
  return { snapshot, summary: buildSnapshotSummary(snapshot) };
}

function downloadJson(filename: string, payload: ExportSnapshotPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ImportExportView() {
  const exportMutation = api.admin.exportSnapshot.useMutation();
  const importMutation = api.admin.importSnapshot.useMutation();
  const importIcsMutation = api.admin.importIcsEvents.useMutation();
  const joinTableStatusQuery = api.admin.joinTableExportStatus.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const joinTableRefreshMutation = api.admin.refreshJoinTableExport.useMutation();
  const hourLogStatusQuery = api.admin.hourLogExportStatus.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const hourLogRefreshMutation = api.admin.refreshHourLogExport.useMutation();
  const { data: calendars } = api.calendar.listAccessible.useQuery(undefined);

  const [exportNote, setExportNote] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const [snapshotFile, setSnapshotFile] = useState<File | null>(null);
  const [snapshotPayload, setSnapshotPayload] = useState<ImportSnapshotInput | null>(null);
  const [snapshotSummary, setSnapshotSummary] = useState<SnapshotSummary | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [icsImportMessage, setIcsImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [icsImportPending, setIcsImportPending] = useState(false);
  const [icsFileName, setIcsFileName] = useState<string | null>(null);
  const [icsCalendarId, setIcsCalendarId] = useState<number | null>(null);
  const [icsFilterStart, setIcsFilterStart] = useState("");
  const [icsFilterEnd, setIcsFilterEnd] = useState("");
  const [joinTableMessage, setJoinTableMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hourLogMessage, setHourLogMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [icsPreviewEvents, setIcsPreviewEvents] = useState<
    Array<{
      id: string;
      title: string;
      start: Date;
      end: Date;
      isAllDay: boolean;
      zendeskTicketNumber: string | null;
      selected: boolean;
    }>
  >([]);

  const canRestore = Boolean(snapshotPayload) && acknowledged && confirmText.trim().toUpperCase() === "RESTORE";
  const defaultCalendarId =
    calendars?.find((calendar) => calendar.isPersonal && calendar.isPrimary)?.id ??
    calendars?.find((calendar) => calendar.isPersonal)?.id ??
    calendars?.[0]?.id;

  const handleExport = async () => {
    setExportMessage(null);
    try {
      const payload = await exportMutation.mutateAsync({
        note: exportNote.trim() ? exportNote.trim() : undefined,
      });
      const filenameSuffix = formatFilenameTimestamp(payload.exportedAt);
      downloadJson(`eaglevents-snapshot-${filenameSuffix}`, payload);
      setExportMessage("Snapshot exported and downloaded.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Failed to export snapshot.");
    }
  };

  const handleFileSelect = useCallback(async (file: File | null) => {
    setSnapshotFile(file);
    setSnapshotPayload(null);
    setSnapshotSummary(null);
    setSnapshotError(null);
    setImportMessage(null);
    setConfirmText("");
    setAcknowledged(false);

    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const validated = validateSnapshotPayload(parsed);
      if ("error" in validated) {
        setSnapshotError(validated.error);
        return;
      }
      setSnapshotPayload(validated.snapshot);
      setSnapshotSummary(validated.summary);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : "Unable to read snapshot file.");
    }
  }, []);

  const handleRestore = async () => {
    if (!snapshotPayload) return;
    setImportMessage(null);
    try {
      const result = await importMutation.mutateAsync(snapshotPayload);
      setImportMessage({
        type: "success",
        text: `Restore completed. ${result.counts.events} events and ${result.counts.users} users imported.`,
      });
    } catch (error) {
      setImportMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Restore failed.",
      });
    }
  };

  const handleIcsImport = async () => {
    const resolvedCalendarId = icsCalendarId ?? defaultCalendarId;
    if (!resolvedCalendarId) {
      setIcsImportMessage({ type: "error", text: "No calendar available for import." });
      return;
    }
    if (icsPreviewEvents.length === 0) {
      setIcsImportMessage({ type: "error", text: "No events ready to import." });
      return;
    }
    setIcsImportMessage(null);
    setIcsImportPending(true);
    try {
      const toImport = icsPreviewEvents.filter((event) => event.selected);
      if (toImport.length === 0) {
        setIcsImportMessage({ type: "error", text: "Select at least one event to import." });
        return;
      }

      const result = await importIcsMutation.mutateAsync({
        calendarId: resolvedCalendarId,
        events: toImport.map((item) => ({
          title: item.title,
          start: item.start,
          end: item.end,
          isAllDay: item.isAllDay,
          zendeskTicketNumber: item.zendeskTicketNumber ?? null,
        })),
      });
      setIcsImportMessage({
        type: "success",
        text: `Imported ${result.inserted} event${result.inserted === 1 ? "" : "s"} from ${icsFileName ?? "file"}.`,
      });
      setIcsPreviewEvents([]);
      setIcsFileName(null);
      setIcsCalendarId(null);
      setIcsFilterStart("");
      setIcsFilterEnd("");
    } catch (error) {
      setIcsImportMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to import .ics file.",
      });
    } finally {
      setIcsImportPending(false);
    }
  };

  const handleIcsFileSelect = async (file: File | null) => {
    setIcsImportMessage(null);
    setIcsPreviewEvents([]);
    setIcsFileName(null);
    setIcsCalendarId(null);
    setIcsFilterStart("");
    setIcsFilterEnd("");
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseIcsEvents(text);
      if (parsed.length === 0) {
        setIcsImportMessage({ type: "error", text: "No events found in this .ics file." });
        return;
      }
      setIcsFileName(file.name);
      setIcsPreviewEvents(
        parsed.map((event, index) => ({
          id: `${event.title}-${event.start.toISOString()}-${index}`,
          title: event.title,
          start: event.start,
          end: event.end,
          isAllDay: event.isAllDay,
          zendeskTicketNumber: event.zendeskTicketNumber ?? null,
          selected: true,
        })),
      );
    } catch (error) {
      setIcsImportMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to read .ics file.",
      });
    }
  };

  const previewCounts = useMemo(() => snapshotSummary?.counts ?? [], [snapshotSummary]);
  const filteredIcsEvents = useMemo(() => {
    const startValue = icsFilterStart ? new Date(`${icsFilterStart}T00:00:00`) : null;
    const endValue = icsFilterEnd ? new Date(`${icsFilterEnd}T23:59:59.999`) : null;
    return icsPreviewEvents.filter((event) => {
      if (startValue && event.start < startValue) return false;
      if (endValue && event.start > endValue) return false;
      return true;
    });
  }, [icsFilterEnd, icsFilterStart, icsPreviewEvents]);
  const selectedIcsCount = useMemo(
    () => icsPreviewEvents.filter((event) => event.selected).length,
    [icsPreviewEvents],
  );
  const joinTableStatus: JoinTableExportStatus | null = joinTableStatusQuery.data ?? null;
  const hourLogStatus: HourLogExportStatus | null = hourLogStatusQuery.data ?? null;

  const handleAllExportsRefresh = async () => {
    setJoinTableMessage(null);
    setHourLogMessage(null);

    const [joinResult, hourResult] = await Promise.allSettled([
      joinTableRefreshMutation.mutateAsync({ force: true }),
      hourLogRefreshMutation.mutateAsync({ force: true }),
    ]);

    if (joinResult.status === "fulfilled") {
      const rowCount = joinResult.value.result?.rowCount;
      setJoinTableMessage({
        type: "success",
        text: rowCount !== undefined ? `Join table updated (${rowCount} rows).` : "Join table updated.",
      });
      void joinTableStatusQuery.refetch();
    } else {
      setJoinTableMessage({
        type: "error",
        text: joinResult.reason instanceof Error ? joinResult.reason.message : "Failed to update the join table export.",
      });
    }

    if (hourResult.status === "fulfilled") {
      const rowCount = hourResult.value.result?.rowCount;
      setHourLogMessage({
        type: "success",
        text: rowCount !== undefined ? `Hour log export updated (${rowCount} rows).` : "Hour log export updated.",
      });
      void hourLogStatusQuery.refetch();
    } else {
      setHourLogMessage({
        type: "error",
        text: hourResult.reason instanceof Error ? hourResult.reason.message : "Failed to update the hour log export.",
      });
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Export system snapshot</h2>
          <p className="text-sm text-ink-muted">
            Create a complete JSON backup of every table. Store this file somewhere safe before making major changes.
          </p>
          <p className="text-xs text-ink-muted">
            Snapshots include user credentials (hashed) and should be handled like sensitive data.
          </p>
        </header>
        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <label className="flex flex-col gap-2 text-sm text-ink-primary">
            <span>Optional export note</span>
            <textarea
              value={exportNote}
              onChange={(event) => setExportNote(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Reason for export, release note, etc."
              className="rounded-xl border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-outline-muted bg-surface-muted px-4 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Snapshot format</p>
            <p className="text-sm font-semibold text-ink-primary">{SNAPSHOT_FORMAT_LABEL}</p>
            <button
              type="button"
              onClick={handleExport}
              disabled={exportMutation.isPending}
              className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportMutation.isPending ? "Exporting..." : "Export snapshot"}
            </button>
          </div>
        </div>
        {exportMessage ? (
          <div className="mt-4 rounded-xl border border-outline-muted bg-surface-muted px-4 py-2 text-sm text-ink-muted">
            {exportMessage}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Join table Excel backup</h2>
          <p className="text-sm text-ink-muted">
            Automatically keep a single Excel file updated with an exhaustive join of event data for read-only recovery.
          </p>
          <p className="text-xs text-ink-muted">
            The main file is overwritten in place every 12 hours or after event edits, with a backup saved each time.
          </p>
        </header>
        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-3 rounded-xl border border-outline-muted bg-surface-muted px-4 py-4 text-sm text-ink-primary">
            <div className="flex flex-col gap-1 text-xs text-ink-subtle">
              <span>
                Last updated:{" "}
                {joinTableStatus?.lastUpdatedAt ? formatTimestamp(joinTableStatus.lastUpdatedAt) : "Never"}
              </span>
              <span>
                Next scheduled: {joinTableStatus?.nextScheduledAt ? formatTimestamp(joinTableStatus.nextScheduledAt) : "Pending"}
              </span>
              <span>File: {joinTableStatus?.filePath ?? "Pending"}</span>
              <span>Backups: {joinTableStatus?.backupDirectory ?? "Pending"}</span>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-outline-muted bg-surface-muted px-4 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Auto refresh</p>
            <p className="text-sm font-semibold text-ink-primary">Every 12 hours</p>
            <button
              type="button"
              onClick={() => void handleAllExportsRefresh()}
              disabled={joinTableRefreshMutation.isPending || hourLogRefreshMutation.isPending}
              className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {joinTableRefreshMutation.isPending || hourLogRefreshMutation.isPending
                ? "Updating..."
                : "Force update both exports"}
            </button>
          </div>
        </div>
        {joinTableMessage ? (
          <div
            className={
              "mt-4 rounded-xl border px-4 py-2 text-sm " +
              (joinTableMessage.type === "success"
                ? "border-outline-accent bg-accent-muted text-accent-soft"
                : "border-status-danger bg-status-danger-surface text-status-danger")
            }
          >
            {joinTableMessage.text}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Hour log Excel backup</h2>
          <p className="text-sm text-ink-muted">
            A human-friendly workbook with one sheet per user, focused on hour logs and event details.
          </p>
          <p className="text-xs text-ink-muted">
            Backups are saved separately before each update.
          </p>
        </header>
        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-3 rounded-xl border border-outline-muted bg-surface-muted px-4 py-4 text-sm text-ink-primary">
            <div className="flex flex-col gap-1 text-xs text-ink-subtle">
              <span>
                Last updated:{" "}
                {hourLogStatus?.lastUpdatedAt ? formatTimestamp(hourLogStatus.lastUpdatedAt) : "Never"}
              </span>
              <span>
                Next scheduled:{" "}
                {hourLogStatus?.nextScheduledAt ? formatTimestamp(hourLogStatus.nextScheduledAt) : "Pending"}
              </span>
              <span>File: {hourLogStatus?.filePath ?? "Pending"}</span>
              <span>Backups: {hourLogStatus?.backupDirectory ?? "Pending"}</span>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-outline-muted bg-surface-muted px-4 py-4">
            <p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Auto refresh</p>
            <p className="text-sm font-semibold text-ink-primary">Every 12 hours</p>
            <p className="text-xs text-ink-subtle">Use the button above to refresh both exports together.</p>
          </div>
        </div>
        {hourLogMessage ? (
          <div
            className={
              "mt-4 rounded-xl border px-4 py-2 text-sm " +
              (hourLogMessage.type === "success"
                ? "border-outline-accent bg-accent-muted text-accent-soft"
                : "border-status-danger bg-status-danger-surface text-status-danger")
            }
          >
            {hourLogMessage.text}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-primary">Import events from .ics</h2>
          <p className="text-sm text-ink-muted">
            This import only uses titles and start/end times. Edit each event after import to fill in details.
          </p>
        </header>
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-outline-muted bg-surface-muted p-4">
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
            Choose .ics file
            <input
              type="file"
              accept=".ics,text/calendar"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handleIcsFileSelect(file);
                event.currentTarget.value = "";
              }}
              className="text-sm text-ink-primary"
              disabled={icsImportPending}
            />
          </label>
          {icsFileName ? <div className="text-xs text-ink-subtle">Selected: {icsFileName}</div> : null}
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
            Import into calendar
            <select
              value={icsCalendarId ? String(icsCalendarId) : ""}
              onChange={(event) => {
                const value = event.target.value;
                setIcsCalendarId(value ? Number(value) : null);
              }}
              className={
                "rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm shadow-sm focus:border-outline-accent focus:outline-none " +
                (icsCalendarId ? "text-ink-primary" : "text-ink-muted")
              }
              disabled={icsImportPending || !calendars || calendars.length === 0}
            >
              <option value="" className="bg-surface-muted text-ink-muted">
                Use default calendar
              </option>
              {calendars?.map((calendar) => (
                <option key={calendar.id} value={calendar.id} className="bg-surface-muted text-ink-primary">
                  {calendar.name}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-ink-subtle">
              Leave blank to import into your default calendar.
            </span>
          </label>
          {icsPreviewEvents.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-subtle">
                <span>{icsPreviewEvents.length} total</span>
                <span>{selectedIcsCount} selected</span>
                <button
                  type="button"
                  onClick={() =>
                    setIcsPreviewEvents((prev) =>
                      prev.map((event) =>
                        filteredIcsEvents.some((item) => item.id === event.id)
                          ? { ...event, selected: true }
                          : event,
                      ),
                    )
                  }
                  className="rounded-full border border-outline-muted px-3 py-1 text-[11px] font-semibold text-ink-primary transition hover:bg-surface-overlay"
                >
                  Select filtered
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setIcsPreviewEvents((prev) =>
                      prev.map((event) =>
                        filteredIcsEvents.some((item) => item.id === event.id)
                          ? { ...event, selected: false }
                          : event,
                      ),
                    )
                  }
                  className="rounded-full border border-outline-muted px-3 py-1 text-[11px] font-semibold text-ink-primary transition hover:bg-surface-overlay"
                >
                  Clear filtered
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
                  Filter start date
                  <input
                    type="date"
                    value={icsFilterStart}
                    onChange={(event) => setIcsFilterStart(event.target.value)}
                    className="rounded-lg border border-outline-muted bg-surface-base px-3 py-2 text-sm text-ink-primary focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
                  Filter end date
                  <input
                    type="date"
                    value={icsFilterEnd}
                    onChange={(event) => setIcsFilterEnd(event.target.value)}
                    className="rounded-lg border border-outline-muted bg-surface-base px-3 py-2 text-sm text-ink-primary focus:outline-none"
                  />
                </label>
              </div>
              <div className="rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-xs text-ink-subtle">
                <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                  <span>Preview</span>
                  <span>{filteredIcsEvents.length} shown</span>
                </div>
                {filteredIcsEvents.length === 0 ? (
                  <div className="py-4 text-center text-ink-muted">No events match this filter.</div>
                ) : (
                  <div className="max-h-56 overflow-auto">
                    {filteredIcsEvents.map((event) => (
                      <label
                        key={event.id}
                        className="flex items-start gap-2 border-t border-outline-muted py-2"
                      >
                        <input
                          type="checkbox"
                          checked={event.selected}
                          onChange={(itemEvent) =>
                            setIcsPreviewEvents((prev) =>
                              prev.map((item) =>
                                item.id === event.id ? { ...item, selected: itemEvent.target.checked } : item,
                              ),
                            )
                          }
                          className="mt-1 h-4 w-4 accent-accent-strong"
                        />
                        <span className="flex-1">
                          <div className="font-semibold text-ink-primary">{event.title}</div>
                          <div>
                            {formatTimestamp(event.start.toISOString())} → {formatTimestamp(event.end.toISOString())}
                          </div>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleIcsImport()}
                disabled={icsImportPending || selectedIcsCount === 0}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {icsImportPending ? "Importing..." : "Import selected events"}
              </button>
            </>
          ) : null}
          {icsImportMessage ? (
            <div
              className={
                "rounded-lg border px-3 py-2 text-xs " +
                (icsImportMessage.type === "success"
                  ? "border-outline-accent bg-accent-muted text-accent-soft"
                  : "border-status-danger bg-status-danger-surface text-status-danger")
              }
            >
              {icsImportMessage.text}
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-status-danger">Import and restore snapshot</h2>
          <p className="text-sm text-status-danger">
            Restoring a snapshot overwrites the entire database. This cannot be undone.
          </p>
        </header>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-4 rounded-xl border border-status-danger bg-surface-raised p-4">
            <label className="flex flex-col gap-2 text-sm font-semibold text-status-danger">
              Choose snapshot file
              <input
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleFileSelect(file);
                }}
                className="text-sm text-ink-primary"
              />
            </label>
            {snapshotFile ? (
              <div className="text-xs text-ink-subtle">Selected: {snapshotFile.name}</div>
            ) : null}
            {snapshotError ? (
              <div className="rounded-lg border border-status-danger bg-status-danger-surface px-3 py-2 text-xs text-status-danger">
                {snapshotError}
              </div>
            ) : null}
            {snapshotSummary ? (
              <div className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-3 text-xs text-ink-subtle">
                <div className="flex flex-col gap-1">
                  <span>
                    Exported {formatTimestamp(snapshotSummary.exportedAt)} (v{snapshotSummary.version})
                  </span>
                  {snapshotSummary.exportedBy ? <span>Exported by {snapshotSummary.exportedBy}</span> : null}
                  {snapshotSummary.note ? <span>Note: {snapshotSummary.note}</span> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-status-danger bg-surface-raised p-4">
            <h3 className="text-sm font-semibold text-status-danger">Snapshot contents</h3>
            {snapshotSummary ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {previewCounts.map((item) => (
                  <div key={item.label} className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-xs">
                    <span className="text-ink-muted">{item.label}</span>
                    <span className="ml-2 font-semibold text-ink-primary">{item.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-subtle">Upload a snapshot to preview its contents.</p>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-3 rounded-xl border border-status-danger bg-surface-raised p-4">
            <label className="flex items-center gap-2 text-sm text-status-danger">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="h-4 w-4 accent-status-danger"
              />
              I understand this will delete and replace all data.
            </label>
            <label className="flex flex-col gap-2 text-sm text-status-danger">
              Type RESTORE to confirm
              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                className="rounded-lg border border-status-danger bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:outline-none"
                placeholder="RESTORE"
              />
            </label>
          </div>
          <div className="flex flex-col justify-end gap-2 rounded-xl border border-status-danger bg-surface-raised p-4">
            <button
              type="button"
              onClick={handleRestore}
              disabled={!canRestore || importMutation.isPending}
              className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-status-danger/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importMutation.isPending ? "Restoring..." : "Restore snapshot"}
            </button>
            <p className="text-xs text-ink-subtle">
              This action resets every table and reloads the snapshot file.
            </p>
          </div>
        </div>

        {importMessage ? (
          <div
            className={
              "mt-4 rounded-xl border px-4 py-2 text-sm " +
              (importMessage.type === "success"
                ? "border-outline-accent bg-accent-muted text-accent-soft"
                : "border-status-danger bg-status-danger-surface text-status-danger")
            }
          >
            {importMessage.text}
          </div>
        ) : null}
      </section>
    </div>
  );
}
