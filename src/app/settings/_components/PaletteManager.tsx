"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";
import type { ThemePaletteTokens } from "~/types/theme";
import {
  DEFAULT_THEME_PALETTE,
  THEME_PALETTE_FIELD_GROUPS,
  cloneThemePaletteTokens,
} from "~/types/theme";

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

type PalettePreset = {
  id: string;
  name: string;
  description: string;
  tokens: ThemePaletteTokens;
};

function createPreset(id: string, name: string, description: string, overrides: Partial<Record<"dark" | "light", Partial<ThemePaletteTokens["dark"]>>>): PalettePreset {
  const tokens = cloneThemePaletteTokens(DEFAULT_THEME_PALETTE);
  if (overrides.dark) tokens.dark = { ...tokens.dark, ...overrides.dark };
  if (overrides.light) tokens.light = { ...tokens.light, ...overrides.light };
  return { id, name, description, tokens };
}

const PALETTE_PRESETS: PalettePreset[] = [
  createPreset("azure", "Azure Radiance", "Crisp blues with teal accents for calm dashboards.", {
    dark: {
      surfaceCanvas: "#020617",
      surfaceMuted: "#0f172a",
      accentStrong: "#38bdf8",
      accentDefault: "#60a5fa",
      accentMuted: "#082f49",
      statusSuccess: "#22d3ee",
      statusWarning: "#facc15",
      statusDanger: "#f87171",
    },
    light: {
      surfaceCanvas: "#f0f7ff",
      surfaceMuted: "#dce9ff",
      accentStrong: "#0f82f2",
      accentDefault: "#38bdf8",
      accentMuted: "#c4e0ff",
      statusSuccess: "#0ea5e9",
      statusWarning: "#facc15",
      statusDanger: "#ef4444",
    },
  }),
  createPreset("sunset", "Sunset Dusk", "Warm amber highlights with deep ruby accents.", {
    dark: {
      surfaceCanvas: "#1a0807",
      surfaceMuted: "#2a1412",
      accentStrong: "#ff6b3b",
      accentDefault: "#ff9468",
      accentMuted: "#43130e",
      statusSuccess: "#ffd966",
      statusWarning: "#ff9f1a",
      statusDanger: "#ff4d4d",
    },
    light: {
      surfaceCanvas: "#fff6ef",
      surfaceMuted: "#ffe1d0",
      accentStrong: "#e45826",
      accentDefault: "#ff8f57",
      accentMuted: "#ffd0b8",
      statusSuccess: "#ffa45b",
      statusWarning: "#ff7a18",
      statusDanger: "#e63946",
    },
  }),
  createPreset("orchid", "Orchid Gloss", "Vivid magenta paired with graphite surfaces.", {
    dark: {
      surfaceCanvas: "#0f0615",
      surfaceMuted: "#1f0a2a",
      accentStrong: "#c636ff",
      accentDefault: "#f472d0",
      accentMuted: "#380f3f",
      statusSuccess: "#f472d0",
      statusWarning: "#feb278",
      statusDanger: "#ff8ba7",
    },
    light: {
      surfaceCanvas: "#fff4ff",
      surfaceMuted: "#f7daff",
      accentStrong: "#a21caf",
      accentDefault: "#d946ef",
      accentMuted: "#f4d0ff",
      statusSuccess: "#d946ef",
      statusWarning: "#f97316",
      statusDanger: "#f43f5e",
    },
  }),
  createPreset("citrus", "Citrus Pop", "Electric yellows with navy surfaces for contrast.", {
    dark: {
      surfaceCanvas: "#050910",
      surfaceMuted: "#0b1624",
      accentStrong: "#facc15",
      accentDefault: "#fde047",
      accentMuted: "#342c08",
      statusSuccess: "#facc15",
      statusWarning: "#fde047",
      statusDanger: "#f87171",
    },
    light: {
      surfaceCanvas: "#fffdeb",
      surfaceMuted: "#fef3c7",
      accentStrong: "#ca8a04",
      accentDefault: "#facc15",
      accentMuted: "#fff1a1",
      statusSuccess: "#fca311",
      statusWarning: "#fbbf24",
      statusDanger: "#dc2626",
    },
  }),
  createPreset("slate", "Slate Pulse", "Cool slate neutrals with cyan accents.", {
    dark: {
      surfaceCanvas: "#050c12",
      surfaceMuted: "#102029",
      accentStrong: "#0be5e5",
      accentDefault: "#38edf0",
      accentMuted: "#083742",
      statusSuccess: "#67e8f9",
      statusWarning: "#eab308",
      statusDanger: "#f87171",
    },
    light: {
      surfaceCanvas: "#edf7fb",
      surfaceMuted: "#d3e5ed",
      accentStrong: "#0284c7",
      accentDefault: "#0ea5e9",
      accentMuted: "#c8ecff",
      statusSuccess: "#38bdf8",
      statusWarning: "#d97706",
      statusDanger: "#dc2626",
    },
  }),
  createPreset("crimson", "Crimson Wave", "An all-red palette for bold alerts and attention.", {
    dark: {
      surfaceCanvas: "#190204",
      surfaceMuted: "#2b0609",
      accentStrong: "#ff2d55",
      accentDefault: "#ff6b81",
      accentMuted: "#43060f",
      statusSuccess: "#f87171",
      statusWarning: "#ff9f43",
      statusDanger: "#ff2d55",
    },
    light: {
      surfaceCanvas: "#fff0f3",
      surfaceMuted: "#ffd5dd",
      accentStrong: "#b91c1c",
      accentDefault: "#ef4444",
      accentMuted: "#ffc2ce",
      statusSuccess: "#f87171",
      statusWarning: "#ffa94d",
      statusDanger: "#dc2626",
    },
  }),
];

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

  const editingPalette = useMemo(
    () => palettes.find((p) => p.id === selectedPaletteId),
    [palettes, selectedPaletteId],
  );

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
    if (!confirm("Delete this palette? This cannot be undone.")) return;
    try {
      await deletePalette.mutateAsync({ id: paletteId });
      void utils.theme.current.invalidate();
      setStatusMessage("Palette deleted");
      if (selectedPaletteId === paletteId) {
        handleCreate();
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to delete palette");
    }
  };

  const handleSubmit = async () => {
    try {
      if (editorMode === "edit" && formState.id) {
        await updatePalette.mutateAsync({
          id: formState.id,
          name: formState.name,
          description: formState.description,
          tokens: formState.tokens,
        });
        setStatusMessage("Palette updated");
      } else {
        await createPalette.mutateAsync({
          name: formState.name,
          description: formState.description,
          tokens: formState.tokens,
        });
        setStatusMessage("Palette created");
        setFormState({
          ...EMPTY_FORM,
          tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
        });
      }
      setModalOpen(false);
      void utils.theme.current.invalidate();
    } catch (error) {
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
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to update assignment");
    }
  };

  const updateColor = (mode: "dark" | "light", key: keyof ThemePaletteTokens["dark"], value: string) => {
    setFormState((prev) => ({
      ...prev,
      tokens: {
        ...prev.tokens,
        [mode]: {
          ...prev.tokens[mode],
          [key]: value,
        },
      },
    }));
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
                    onClick={() => handleDelete(palette.id)}
                  >
                    Delete
                  </button>
                </div>
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
          onChange={setFormState}
          onColorChange={updateColor}
          onSubmit={handleSubmit}
          isSaving={createPalette.isPending || updatePalette.isPending}
          onClose={handleCloseModal}
          presets={PALETTE_PRESETS}
        />
      ) : null}
    </section>
  );
}

function PalettePreview({ tokens }: { tokens: ThemePaletteTokens }) {
  return (
    <div className="grid gap-3 rounded-xl border border-outline-muted/60 bg-surface-muted/60 p-3 text-xs text-ink-muted">
      <div className="font-semibold text-ink-primary">Dark</div>
      <div className="flex gap-2">
        <span className="h-16 flex-1 rounded-lg" style={{ background: tokens.dark.surfaceCanvas }} />
        <span className="h-16 flex-1 rounded-lg" style={{ background: tokens.dark.accentStrong }} />
        <span className="h-16 flex-1 rounded-lg" style={{ background: tokens.dark.statusSuccess }} />
      </div>
      <div className="font-semibold text-ink-primary">Light</div>
      <div className="flex gap-2">
        <span className="h-16 flex-1 rounded-lg border border-outline-muted/50" style={{ background: tokens.light.surfaceCanvas }} />
        <span className="h-16 flex-1 rounded-lg border border-outline-muted/50" style={{ background: tokens.light.accentStrong }} />
        <span className="h-16 flex-1 rounded-lg border border-outline-muted/50" style={{ background: tokens.light.statusSuccess }} />
      </div>
    </div>
  );
}

type PaletteEditorProps = {
  mode: "create" | "edit";
  state: PaletteFormState;
  onChange: (state: PaletteFormState) => void;
  onColorChange: (mode: "dark" | "light", key: keyof ThemePaletteTokens["dark"], value: string) => void;
  onSubmit: () => Promise<void>;
  isSaving: boolean;
};

function PaletteEditorModal({
  mode,
  state,
  onChange,
  onColorChange,
  onSubmit,
  isSaving,
  onClose,
  presets,
}: PaletteEditorProps & { onClose: () => void; presets: PalettePreset[] }) {
  const [presetSelection, setPresetSelection] = useState<string>("");
  const [manualTokens, setManualTokens] = useState(() => JSON.stringify(state.tokens, null, 2));
  const [manualError, setManualError] = useState<string | null>(null);

  const handlePresetChange = (value: string) => {
    setPresetSelection(value);
    const preset = presets.find((p) => p.id === value);
    if (preset) {
      onChange({
        ...state,
        tokens: cloneThemePaletteTokens(preset.tokens),
      });
      setManualTokens(JSON.stringify(preset.tokens, null, 2));
      setManualError(null);
    }
  };

  const handleLoadCurrentTokens = () => {
    setManualTokens(JSON.stringify(state.tokens, null, 2));
    setManualError(null);
  };

  const handleApplyManualTokens = () => {
    try {
      const parsed = JSON.parse(manualTokens) as ThemePaletteTokens;
      if (!parsed?.dark || !parsed?.light) {
        throw new Error("Tokens must include both dark and light objects.");
      }
      onChange({
        ...state,
        tokens: cloneThemePaletteTokens(parsed),
      });
      setManualError(null);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Unable to parse tokens");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay-backdrop)] px-4 py-8">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-outline-muted bg-surface-raised/95 p-6 shadow-[var(--shadow-pane)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold text-ink-primary">{mode === "edit" ? "Edit palette" : "Create palette"}</h4>
            <p className="text-sm text-ink-muted">Tune semantic colors for light and dark surfaces.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-muted transition hover:bg-surface-muted"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <label className="flex flex-col gap-1 text-sm text-ink-primary">
            Apply preset
            <select
              className="rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none focus:border-outline-accent"
              value={presetSelection}
              onChange={(event) => handlePresetChange(event.target.value)}
            >
              <option value="">Custom / current colors</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-primary">
            Palette name
            <input
              value={state.name}
              onChange={(event) => onChange({ ...state, name: event.target.value })}
              className="rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none focus:border-outline-accent"
              placeholder="Brand identity"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-primary">
            Description
            <textarea
              value={state.description}
              onChange={(event) => onChange({ ...state, description: event.target.value })}
              rows={2}
              className="rounded-lg border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none focus:border-outline-accent"
              placeholder="Optional notes"
            />
          </label>
        </div>

        <div className="mt-6 space-y-6">
          {THEME_PALETTE_FIELD_GROUPS.map((group) => (
            <div key={group.key} className="space-y-3 rounded-2xl border border-outline-muted/60 bg-surface-muted/60 p-3">
              <p className="text-sm font-semibold text-ink-primary">{group.label}</p>
              <div className="space-y-4">
                {group.fields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{field.label}</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(["dark", "light"] as const).map((modeKey) => (
                        <label
                          key={modeKey}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-outline-muted/60 bg-surface-raised/60 px-3 py-2"
                        >
                          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                            {modeKey === "dark" ? "Dark" : "Light"}
                          </span>
                          <input
                            type="color"
                            value={state.tokens[modeKey][field.key]}
                            onChange={(event) => onColorChange(modeKey, field.key, event.target.value)}
                            className="h-10 w-16 cursor-pointer rounded border border-outline-muted bg-transparent"
                          />
                          <input
                            type="text"
                            value={state.tokens[modeKey][field.key]}
                            onChange={(event) => onColorChange(modeKey, field.key, event.target.value)}
                            className="min-w-[120px] flex-1 rounded border border-outline-muted bg-surface-raised px-2 py-1 text-xs text-ink-primary outline-none focus:border-outline-accent"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-primary">Typed tokens (JSON)</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full border border-outline-muted px-3 py-1 text-xs text-ink-subtle transition hover:bg-surface-muted"
                onClick={handleLoadCurrentTokens}
              >
                Load current
              </button>
              <button
                type="button"
                className="rounded-full border border-outline-accent px-3 py-1 text-xs text-ink-primary transition hover:bg-accent-muted"
                onClick={handleApplyManualTokens}
              >
                Apply typed tokens
              </button>
            </div>
          </div>
          <textarea
            value={manualTokens}
            onChange={(event) => setManualTokens(event.target.value)}
            rows={6}
            className="w-full rounded-lg border border-outline-muted bg-surface-raised p-3 text-xs text-ink-primary outline-none focus:border-outline-accent"
            spellCheck={false}
          />
          {manualError ? <p className="text-xs text-status-danger">{manualError}</p> : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-outline-muted px-5 py-2 text-sm text-ink-subtle transition hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={isSaving || !state.name.trim()}
            className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : mode === "edit" ? "Update palette" : "Create palette"}
          </button>
        </div>
      </div>
    </div>
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
