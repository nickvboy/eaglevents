"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { XIcon } from "~/app/_components/icons";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";
import { SetupProgress } from "./SetupProgress";
import { BusinessInfoForm } from "./forms/BusinessInfoForm";
import { BuildingsForm } from "./forms/BuildingsForm";
import { DepartmentsForm } from "./forms/DepartmentsForm";
import { UserAccountsForm } from "./forms/UserAccountsForm";
import { CompletionPanel } from "./forms/CompletionPanel";
import { ThemeForm } from "./forms/ThemeForm";
import { formatGeneratedCredentials } from "./forms/credentialsExport";

type StepKey = "business" | "buildings" | "departments" | "users" | "theme" | "complete";
type GeneratedDefaultUser = RouterOutputs["setup"]["createDefaultUsers"]["generatedUsers"][number];
type ImportSnapshotInput = RouterInputs["setup"]["importSnapshot"];
type SnapshotSummary = {
  version: number;
  exportedAt: string;
  exportedBy: string | null;
  note: string | null;
  counts: Array<{ label: string; count: number }>;
};

const orderedSteps: StepKey[] = ["business", "buildings", "departments", "users", "theme", "complete"];
const SUPPORTED_SNAPSHOT_VERSIONS = [2, 3] as const;
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
  if (!SUPPORTED_SNAPSHOT_VERSIONS.includes(version as (typeof SUPPORTED_SNAPSHOT_VERSIONS)[number])) {
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

function deriveStep(status: SetupStatusData | undefined): StepKey {
  if (!status) return "business";
  if (!status.business) return "business";
  if (!status.stepCompletion.buildings) return "buildings";
  if (!status.stepCompletion.departments) return "departments";
  if (!status.stepCompletion.users) return "users";
  return "complete";
}

export function SetupWizard() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<StepKey>("business");
  const [postSetupCredential, setPostSetupCredential] = useState<{ identifier: string; password: string } | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [themeSelection, setThemeSelection] = useState<{ paletteId: number | null; paletteName: string | null } | null>(null);
  const [generatedDefaults, setGeneratedDefaults] = useState<GeneratedDefaultUser[]>([]);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [snapshotFile, setSnapshotFile] = useState<File | null>(null);
  const [snapshotPayload, setSnapshotPayload] = useState<ImportSnapshotInput | null>(null);
  const [snapshotSummary, setSnapshotSummary] = useState<SnapshotSummary | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);

  const statusQuery = api.setup.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const { data: status, isLoading, refetch, error } = statusQuery;
  const importSnapshotMutation = api.setup.importSnapshot.useMutation({
    onSuccess: async () => {
      await refetch();
    },
  });

  useEffect(() => {
    if (!status) return;
    if (!status.needsSetup) {
      router.replace("/");
      return;
    }
    const recommended = deriveStep(status);
    setActiveStep((current) => {
      const currentIndex = orderedSteps.indexOf(current);
      const recommendedIndex = orderedSteps.indexOf(recommended);
      if (!hasInitialized) return recommended;
      return currentIndex > recommendedIndex ? recommended : current;
    });
    if (!hasInitialized) setHasInitialized(true);
  }, [status, router, hasInitialized]);

  const completeMutation = api.setup.completeSetup.useMutation({
    onSuccess: () => {
      void refetch();
    },
  });

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const credentialsExport = useMemo(
    () => (generatedDefaults.length > 0 ? formatGeneratedCredentials(generatedDefaults) : ""),
    [generatedDefaults],
  );
  const canImportSnapshot = Boolean(snapshotPayload);

  const handleCopyCredentials = async () => {
    if (!credentialsExport) return;
    try {
      await navigator.clipboard.writeText(credentialsExport);
      setCopyStatus("Copied credentials to clipboard");
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : "Unable to copy credentials");
    }
  };

  const handleCompleteSetup = async () => {
    if (completeMutation.isPending || !status) return;
    try {
      await completeMutation.mutateAsync({
        paletteId: themeSelection?.paletteId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Setup has already been completed")) {
        router.replace("/");
        return;
      }
      return;
    }
    if (postSetupCredential) {
      await signIn("credentials", {
        redirect: false,
        identifier: postSetupCredential.identifier,
        password: postSetupCredential.password,
        callbackUrl: "/",
      });
    }
    router.replace("/");
  };

  const handleSnapshotFileSelect = async (file: File | null) => {
    setSnapshotFile(file);
    setSnapshotPayload(null);
    setSnapshotSummary(null);
    setSnapshotError(null);
    setSnapshotMessage(null);

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
    } catch (readError) {
      setSnapshotError(readError instanceof Error ? readError.message : "Unable to read snapshot file.");
    }
  };

  const handleSnapshotImport = async () => {
    if (!snapshotPayload) return;

    setSnapshotMessage(null);
    try {
      const result = await importSnapshotMutation.mutateAsync(snapshotPayload);
      setSnapshotMessage({
        type: "success",
        text: `Import complete. ${result.counts.events} events and ${result.counts.users} users loaded.`,
      });
    } catch (restoreError) {
      setSnapshotMessage({
        type: "error",
        text: restoreError instanceof Error ? restoreError.message : "Snapshot import failed.",
      });
    }
  };

  let stepContent = null;
  if (status) {
    switch (activeStep) {
      case "business":
        stepContent = <BusinessInfoForm status={status} onUpdated={() => refetch()} />;
        break;
      case "buildings":
        stepContent = <BuildingsForm status={status} onUpdated={() => refetch()} />;
        break;
      case "departments":
        stepContent = <DepartmentsForm status={status} onUpdated={() => refetch()} />;
        break;
      case "users":
        stepContent = (
          <UserAccountsForm
            status={status}
            onUpdated={() => refetch()}
            onRememberCredential={setPostSetupCredential}
            rememberedCredential={postSetupCredential}
            generatedDefaults={generatedDefaults}
            onGeneratedDefaultsChange={setGeneratedDefaults}
          />
        );
        break;
      case "theme":
        stepContent = <ThemeForm onSelectionChange={setThemeSelection} />;
        break;
      case "complete":
        stepContent = (
          <CompletionPanel
            status={status}
            onComplete={handleCompleteSetup}
            completing={completeMutation.isPending}
            completionError={completeMutation.error?.message ?? null}
            themeSelection={themeSelection}
          />
        );
        break;
      default:
        stepContent = null;
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-primary">
        <div className="w-full max-w-md rounded-lg border border-outline-muted bg-surface-raised p-6 text-center shadow-[var(--shadow-pane)]">
          <h1 className="text-xl font-semibold">Unable to load setup status</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {error.message ?? "The server returned an unexpected error. Check the API logs and try again."}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (isLoading || !status) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-primary">
        <div className="text-sm text-ink-muted">Loading setup data...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-canvas text-ink-primary">
      <div
        className={
          "mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 transition md:flex-row " +
          (snapshotModalOpen ? "pointer-events-none select-none blur-sm" : "")
        }
        aria-hidden={snapshotModalOpen}
      >
        <div className="md:w-1/3">
          <SetupProgress
            status={status}
            currentStep={activeStep}
            maxUnlockedIndex={orderedSteps.indexOf(deriveStep(status))}
            onStepChange={(step) => {
              const maxIndex = orderedSteps.indexOf(deriveStep(status));
              const requestedIndex = orderedSteps.indexOf(step);
              if (requestedIndex <= maxIndex) setActiveStep(step);
            }}
            themeSelected={themeSelection !== null}
          />
        </div>
        <div className="md:w-2/3">
          {status.needsSetup && !status.business ? (
            <section className="mb-4 rounded-lg border border-outline-accent bg-accent-muted/30 p-5 shadow-[var(--shadow-pane)]">
              <header className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-ink-primary">Import an existing Eaglevents snapshot</h2>
                <p className="text-sm text-ink-muted">
                  Already have a full JSON snapshot? Import it to populate your workspace and skip manual onboarding.
                </p>
                <p className="text-xs text-ink-subtle">
                  This path is designed for brand-new workspaces where the snapshot already contains the full database state.
                </p>
              </header>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-outline-muted bg-surface-raised p-4">
                <div>
                  <p className="text-sm font-semibold text-ink-primary">Use a prepared snapshot instead of entering data step by step.</p>
                  <p className="mt-1 text-xs text-ink-subtle">You can close the import window at any time and continue onboarding manually.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSnapshotModalOpen(true)}
                  className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
                >
                  Import
                </button>
              </div>
            </section>
          ) : null}

          <div className="rounded-lg border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
            {stepContent}
          </div>
          {generatedDefaults.length > 0 && activeStep !== "users" ? (
            <div className="mt-4 rounded-lg border border-outline-muted bg-surface-muted p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase text-ink-subtle">Generated account credentials</div>
                  <p className="mt-1 text-xs text-ink-muted">Save these usernames and passwords in a secure place.</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCredentials}
                  className="inline-flex items-center gap-2 rounded-full border border-outline-accent bg-accent-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-primary shadow-[var(--shadow-button)] transition hover:border-outline-strong hover:bg-accent-muted"
                >
                  <span aria-hidden="true">⧉</span>
                  Copy credentials
                </button>
              </div>
              {copyStatus ? <p className="mt-2 text-xs text-ink-muted">{copyStatus}</p> : null}
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1 font-mono text-[11px] text-ink-muted">
                {generatedDefaults.map((user) => (
                  <div key={`${user.username}-${user.roleType}`} className="rounded border border-outline-muted bg-surface-raised p-2">
                    <div className="text-ink-primary">{user.scopeLabel}</div>
                    <div>username: {user.username}</div>
                    <div>password: {user.password}</div>
                    <div>email: {user.email}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {snapshotModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-canvas/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-outline-muted bg-surface-raised shadow-[var(--shadow-pane)]">
            <header className="flex items-start justify-between gap-4 border-b border-outline-muted px-6 py-5">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.24em] text-accent-soft">Import Snapshot</p>
                <h2 className="text-xl font-semibold text-ink-primary">Bring your workspace in with one file</h2>
                <p className="text-sm text-ink-muted">
                  Choose a complete Eaglevents JSON snapshot to import your organization, users, calendars, and events.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSnapshotModalOpen(false)}
                className="rounded-full border border-outline-muted p-2 text-ink-muted transition hover:border-outline-strong hover:text-ink-primary"
                aria-label="Close import dialog"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.2fr_1fr]">
              <div className="flex flex-col gap-4 rounded-xl border border-outline-muted bg-surface-muted p-4">
                <label className="flex flex-col gap-2 text-sm font-semibold text-ink-primary">
                  Choose snapshot file
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void handleSnapshotFileSelect(file);
                    }}
                    className="text-sm text-ink-primary"
                    disabled={importSnapshotMutation.isPending}
                  />
                </label>
                {snapshotFile ? <div className="text-xs text-ink-subtle">Selected: {snapshotFile.name}</div> : null}
                {snapshotError ? (
                  <div className="rounded-lg border border-status-danger bg-status-danger-surface px-3 py-2 text-xs text-status-danger">
                    {snapshotError}
                  </div>
                ) : null}
                {snapshotSummary ? (
                  <div className="rounded-lg border border-outline-muted bg-surface-raised px-3 py-3 text-xs text-ink-subtle">
                    <div className="flex flex-col gap-1">
                      <span>
                        Exported {formatTimestamp(snapshotSummary.exportedAt)} (v{snapshotSummary.version})
                      </span>
                      {snapshotSummary.exportedBy ? <span>Prepared by {snapshotSummary.exportedBy}</span> : null}
                      {snapshotSummary.note ? <span>Note: {snapshotSummary.note}</span> : null}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-outline-muted bg-surface-raised px-3 py-4 text-xs text-ink-subtle">
                    Upload a snapshot file to preview what will be imported.
                  </div>
                )}
                {snapshotMessage ? (
                  <div
                    className={
                      "rounded-lg border px-3 py-2 text-xs " +
                      (snapshotMessage.type === "success"
                        ? "border-outline-accent bg-accent-muted text-accent-soft"
                        : "border-status-danger bg-status-danger-surface text-status-danger")
                    }
                  >
                    {snapshotMessage.text}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-outline-muted bg-surface-muted p-4">
                <h3 className="text-sm font-semibold text-ink-primary">Import preview</h3>
                <p className="mt-1 text-xs text-ink-subtle">
                  Review the snapshot contents before importing into this fresh workspace.
                </p>
                {snapshotSummary ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {snapshotSummary.counts.map((item) => (
                      <div key={item.label} className="rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-xs">
                        <span className="text-ink-muted">{item.label}</span>
                        <span className="ml-2 font-semibold text-ink-primary">{item.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-ink-subtle">No snapshot loaded yet.</p>
                )}
              </div>
            </div>

            <footer className="flex items-center justify-end gap-3 border-t border-outline-muted px-6 py-4">
              <button
                type="button"
                onClick={() => void handleSnapshotImport()}
                disabled={!canImportSnapshot || importSnapshotMutation.isPending}
                className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importSnapshotMutation.isPending ? "Importing..." : "Import"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </main>
  );
}
