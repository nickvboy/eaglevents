"use client";

import { useCallback, useMemo, useState } from "react";

import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

type ExportSnapshotPayload = RouterOutputs["admin"]["exportSnapshot"];
type ImportSnapshotInput = RouterInputs["admin"]["importSnapshot"];

type SnapshotSummary = {
  version: number;
  exportedAt: string;
  exportedBy: string | null;
  note: string | null;
  counts: Array<{ label: string; count: number }>;
};

const SUPPORTED_SNAPSHOT_VERSION = 1;

const snapshotDataSections = [
  { key: "users", label: "Users" },
  { key: "profiles", label: "Profiles" },
  { key: "organizationRoles", label: "Org roles" },
  { key: "businesses", label: "Businesses" },
  { key: "departments", label: "Departments" },
  { key: "buildings", label: "Buildings" },
  { key: "rooms", label: "Rooms" },
  { key: "calendars", label: "Calendars" },
  { key: "events", label: "Events" },
  { key: "eventAttendees", label: "Event attendees" },
  { key: "eventReminders", label: "Event reminders" },
  { key: "eventHourLogs", label: "Event hour logs" },
  { key: "eventZendeskConfirmations", label: "Event confirmations" },
  { key: "themePalettes", label: "Theme palettes" },
  { key: "themeProfiles", label: "Theme profiles" },
  { key: "posts", label: "Posts" },
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
    if (!Array.isArray(data[section.key])) {
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

  const [exportNote, setExportNote] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const [snapshotFile, setSnapshotFile] = useState<File | null>(null);
  const [snapshotPayload, setSnapshotPayload] = useState<ImportSnapshotInput | null>(null);
  const [snapshotSummary, setSnapshotSummary] = useState<SnapshotSummary | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const canRestore = Boolean(snapshotPayload) && acknowledged && confirmText.trim().toUpperCase() === "RESTORE";

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

  const previewCounts = useMemo(() => snapshotSummary?.counts ?? [], [snapshotSummary]);

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
            <p className="text-sm font-semibold text-ink-primary">Version 1 (JSON)</p>
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
