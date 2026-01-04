"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";
import type { ThemePaletteTokens } from "~/types/theme";
import {
  DEFAULT_THEME_PALETTE,
  cloneThemePaletteTokens,
} from "~/types/theme";
import {
  PALETTE_PRESETS,
  PaletteEditorModal,
  PalettePreview,
} from "~/app/_components/theme/PaletteEditor";

type PaletteFormState = {
  id?: number;
  name: string;
  description: string;
  tokens: ThemePaletteTokens;
};

const EMPTY_FORM: PaletteFormState = {
  name: "",
  description: "",
  tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
};

export function PaletteManager() {
  const utils = api.useUtils();
  const { data, isLoading } = api.theme.settings.useQuery();
  const createPalette = api.theme.create.useMutation({
    onSuccess: () => utils.theme.settings.invalidate(),
  });
  const updatePalette = api.theme.update.useMutation({
    onSuccess: () => utils.theme.settings.invalidate(),
  });
  const deletePalette = api.theme.delete.useMutation({
    onSuccess: () => utils.theme.settings.invalidate(),
  });
  const setProfile = api.theme.setProfile.useMutation({
    onSuccess: () => utils.theme.settings.invalidate(),
  });

  const [formState, setFormState] = useState<PaletteFormState>(EMPTY_FORM);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [selectedPaletteId, setSelectedPaletteId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const handleCloseModal = () => {
    setModalOpen(false);
    if (editorMode === "create") {
      setFormState({
        ...EMPTY_FORM,
        tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
      });
    }
  };
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [blockedDeleteId, setBlockedDeleteId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  const palettes = data?.palettes ?? [];
  const profiles = data?.profiles ?? [];
  const departments = data?.departments ?? [];
  const workspaceProfile = profiles.find((p) => p.scopeType === "business");

  const workspacePaletteId = workspaceProfile?.paletteId ?? null;
  const assignedPaletteIds = useMemo(() => {
    return new Set(profiles.map((profile) => profile.paletteId).filter((id): id is number => typeof id === "number"));
  }, [profiles]);

  const handleEdit = (paletteId: number) => {
    const palette = palettes.find((p) => p.id === paletteId);
    if (!palette) return;
    setEditorMode("edit");
    setSelectedPaletteId(paletteId);
    setFormState({
      id: palette.id,
      name: palette.name,
      description: palette.description ?? "",
      tokens: cloneThemePaletteTokens(palette.tokens),
    });
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditorMode("create");
    setSelectedPaletteId(null);
    setFormState({
      ...EMPTY_FORM,
      tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
    });
    setModalOpen(true);
  };

  const handleDelete = async (paletteId: number) => {
    if (assignedPaletteIds.has(paletteId)) {
      setBlockedDeleteId(paletteId);
      return;
    }
    setBlockedDeleteId(null);
    setDeleteConfirmId(paletteId);
  };

  const confirmDelete = async () => {
    if (deleteConfirmId === null) return;
    try {
      await deletePalette.mutateAsync({ id: deleteConfirmId });
      void utils.theme.current.invalidate();
      setStatusMessage("Palette deleted");
      setBlockedDeleteId(null);
      if (selectedPaletteId === deleteConfirmId) {
        handleCreate();
      }
    } catch (error: unknown) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to delete palette");
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleSubmit = async (nextState: PaletteFormState) => {
    try {
      if (editorMode === "edit" && nextState.id) {
        await updatePalette.mutateAsync({
          id: nextState.id,
          name: nextState.name,
          description: nextState.description,
          tokens: nextState.tokens,
        });
        setStatusMessage("Palette updated");
      } else {
        await createPalette.mutateAsync({
          name: nextState.name,
          description: nextState.description,
          tokens: nextState.tokens,
        });
        setStatusMessage("Palette created");
        setFormState({
          ...EMPTY_FORM,
          tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
        });
      }
      setModalOpen(false);
      void utils.theme.current.invalidate();
    } catch (error: unknown) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save palette");
    }
  };

  const handleAssign = async (scopeType: "business" | "department", scopeId: number | undefined, paletteId: number | null) => {
    try {
      await setProfile.mutateAsync({
        scopeType,
        scopeId,
        paletteId,
      });
      setStatusMessage("Assignment updated");
      void utils.theme.current.invalidate();
    } catch (error: unknown) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to update assignment");
    }
  };

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-outline-muted bg-surface-raised/80 p-6 shadow-[var(--shadow-pane)]">
        <div className="h-6 w-40 animate-pulse rounded bg-surface-muted" />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />
          <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />
        </div>
      </section>
    );
  }

  if (!data?.businessId) {
    return (
      <section className="rounded-3xl border border-status-warning bg-status-warning-surface/40 p-6 text-status-warning">
        Workspace settings are not available until onboarding is complete.
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-outline-muted bg-surface-raised/80 p-6 shadow-[var(--shadow-pane)]">
      {deleteConfirmId !== null ? (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-[var(--color-overlay-backdrop)]/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-status-danger bg-surface-raised p-5 text-sm shadow-2xl shadow-[var(--shadow-pane)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-status-danger">Confirm delete</div>
            <div className="mt-2 text-ink-primary">Delete this palette? This cannot be undone.</div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-outline-muted px-3 py-1.5 text-sm text-ink-primary hover:bg-surface-muted"
                onClick={() => setDeleteConfirmId(null)}
                disabled={deletePalette.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-status-danger px-3 py-1.5 text-sm font-semibold text-ink-inverted transition hover:bg-status-danger-strong disabled:opacity-60"
                onClick={() => void confirmDelete()}
                disabled={deletePalette.isPending}
              >
                {deletePalette.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-ink-subtle">Palettes</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold text-ink-primary">Palette tool</h3>
            <p className="text-sm text-ink-muted">Create workspace palettes and assign them to teams.</p>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="rounded-full border border-outline-accent px-4 py-2 text-sm font-semibold text-ink-primary transition hover:bg-accent-muted"
          >
            New palette
          </button>
        </div>
      </header>

      {statusMessage ? (
        <div className="mt-4 rounded-full border border-outline-accent/60 bg-accent-muted/40 px-4 py-2 text-xs text-ink-primary">
          {statusMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {palettes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-outline-muted bg-surface-muted/80 px-4 py-10 text-center text-sm text-ink-muted">
            No palettes yet. Create one to get started.
          </div>
        ) : (
          palettes.map((palette) => {
            const active = workspacePaletteId === palette.id;
            return (
              <article
                key={palette.id}
                className={
                  "flex flex-col gap-4 rounded-2xl border p-4 transition " +
                  (active ? "border-outline-accent bg-accent-muted/20" : "border-outline-muted bg-surface-muted/80")
                }
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-primary">{palette.name}</p>
                      <p className="text-xs text-ink-muted">{palette.description || "No description"}</p>
                    </div>
                    {active ? (
                      <span className="rounded-full bg-accent-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong">
                        Workspace default
                      </span>
                    ) : null}
                  </div>
                  <PalettePreview tokens={palette.tokens} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rounded-full border border-outline-accent px-3 py-1 text-xs font-semibold text-ink-primary transition hover:bg-accent-muted"
                    onClick={() => handleAssign("business", data.businessId, palette.id)}
                  >
                    Apply to workspace
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle transition hover:bg-surface-muted"
                    onClick={() => handleEdit(palette.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-status-danger px-3 py-1 text-xs text-status-danger transition hover:bg-status-danger-surface"
                    title={
                      assignedPaletteIds.has(palette.id)
                        ? "Unassign this palette from all profiles before deleting it."
                        : "Delete palette"
                    }
                    onClick={() => handleDelete(palette.id)}
                  >
                    Delete
                  </button>
                </div>
                {blockedDeleteId === palette.id ? (
                  <p className="text-xs text-status-warning">Unassign this palette from all profiles before deleting it.</p>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <div className="mt-8 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-primary">Try a preset</p>
          <span className="text-xs text-ink-muted">Jump start with curated palettes.</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {PALETTE_PRESETS.map((preset) => (
            <article key={preset.id} className="rounded-2xl border border-outline-muted bg-surface-muted/70 p-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-primary">{preset.name}</p>
                    <p className="text-xs text-ink-muted">{preset.description}</p>
                  </div>
                </div>
                <PalettePreview tokens={preset.tokens} />
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-full border border-outline-muted px-3 py-1.5 text-xs font-semibold text-ink-primary transition hover:border-outline-accent hover:text-accent-soft"
                onClick={() => {
                  setEditorMode("create");
                  setSelectedPaletteId(null);
                  setFormState({
                    name: preset.name,
                    description: preset.description,
                    tokens: cloneThemePaletteTokens(preset.tokens),
                  });
                  setModalOpen(true);
                }}
              >
                Use preset
              </button>
            </article>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <AssignmentPanel
          palettes={palettes}
          workspacePaletteId={workspacePaletteId}
          departments={departments}
          profiles={profiles}
          onAssign={handleAssign}
          businessId={data.businessId}
          isSaving={setProfile.isPending}
        />
      </div>

      {modalOpen ? (
        <PaletteEditorModal
          mode={editorMode}
          state={formState}
          onSubmit={handleSubmit}
          isSaving={createPalette.isPending || updatePalette.isPending}
          onClose={handleCloseModal}
          presets={PALETTE_PRESETS}
        />
      ) : null}
    </section>
  );
}

type AssignmentPanelProps = {
  palettes: { id: number; name: string }[];
  workspacePaletteId: number | null;
  departments: { id: number; name: string }[];
  profiles: Array<{ scopeType: "business" | "department"; scopeId: number; paletteId: number | null }>;
  onAssign: (scopeType: "business" | "department", scopeId: number | undefined, paletteId: number | null) => Promise<void>;
  businessId: number;
  isSaving: boolean;
};

function AssignmentPanel({
  palettes,
  workspacePaletteId,
  departments,
  profiles,
  onAssign,
  businessId,
  isSaving,
}: AssignmentPanelProps) {
  const departmentAssignments = useMemo(() => {
    const map = new Map<number, number | null>();
    profiles
      .filter((p) => p.scopeType === "department")
      .forEach((profile) => map.set(profile.scopeId, profile.paletteId ?? null));
    return map;
  }, [profiles]);

  return (
    <div className="rounded-2xl border border-outline-muted bg-surface-muted/80 p-4">
      <h4 className="text-lg font-semibold text-ink-primary">Assignments</h4>
      <p className="text-sm text-ink-muted">Select which palette applies to the workspace and each team.</p>

      <div className="mt-4 space-y-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Workspace default</div>
          <select
            className="mt-1 w-full rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none focus:border-outline-accent"
            value={workspacePaletteId ?? ""}
            disabled={isSaving}
            onChange={(event) => onAssign("business", businessId, event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Use base palette</option>
            {palettes.map((palette) => (
              <option key={palette.id} value={palette.id}>
                {palette.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Teams</div>
          {departments.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No teams found. Create departments to assign palettes.</p>
          ) : (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {departments.map((department) => {
                const assignment = departmentAssignments.get(department.id) ?? null;
                return (
                  <label key={department.id} className="flex flex-col gap-1 text-sm text-ink-primary">
                    <span>{department.name}</span>
                    <select
                      className="w-full rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none focus:border-outline-accent"
                      value={assignment ?? ""}
                      disabled={isSaving}
                      onChange={(event) =>
                        onAssign(
                          "department",
                          department.id,
                          event.target.value ? Number(event.target.value) : null,
                        )
                      }
                    >
                      <option value="">Inherit workspace</option>
                      {palettes.map((palette) => (
                        <option key={palette.id} value={palette.id}>
                          {palette.name}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
