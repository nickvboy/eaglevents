"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "~/trpc/react";
import { useColorTheme } from "~/app/_components/theme/ColorThemeProvider";
import type { ThemePaletteTokens } from "~/types/theme";
import { DEFAULT_THEME_PALETTE, cloneThemePaletteTokens } from "~/types/theme";
import {
  PALETTE_PRESETS,
  PaletteEditorModal,
  PalettePreview,
} from "~/app/_components/theme/PaletteEditor";

type PaletteFormState = {
  name: string;
  description: string;
  tokens: ThemePaletteTokens;
};

const EMPTY_FORM: PaletteFormState = {
  name: "",
  description: "",
  tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
};

type ThemeSelection = {
  paletteId: number | null;
  paletteName: string | null;
};

export function ThemeForm({ onSelectionChange }: { onSelectionChange: (selection: ThemeSelection) => void }) {
  const utils = api.useUtils();
  const { setPaletteTokens } = useColorTheme();
  const { data, isLoading } = api.theme.settings.useQuery();
  const createPalette = api.theme.create.useMutation({
    onSuccess: () => utils.theme.settings.invalidate(),
  });
  const updatePalette = api.theme.update.useMutation({
    onSuccess: () => utils.theme.settings.invalidate(),
  });

  const [selectedPaletteId, setSelectedPaletteId] = useState<number | null>(null);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [pendingTokens, setPendingTokens] = useState<ThemePaletteTokens | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [formState, setFormState] = useState<PaletteFormState>(EMPTY_FORM);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const lastAppliedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!data || hasInitialized) return;
    const workspaceProfile = data.profiles.find((profile) => profile.scopeType === "business");
    const initialPaletteId = workspaceProfile?.paletteId ?? null;
    setSelectedPaletteId(initialPaletteId);
    setSelectedValue(initialPaletteId ? String(initialPaletteId) : "");
    setHasInitialized(true);
  }, [data, hasInitialized]);

  const selectedPalette = useMemo(() => {
    return (data?.palettes ?? []).find((palette) => palette.id === selectedPaletteId) ?? null;
  }, [data, selectedPaletteId]);

  useEffect(() => {
    if (!hasInitialized) return;
    const tokens = selectedPalette?.tokens ?? pendingTokens ?? DEFAULT_THEME_PALETTE;
    const selection = { paletteId: selectedPaletteId, paletteName: selectedPalette?.name ?? null };
    const key = `${selection.paletteId ?? "base"}:${selection.paletteName ?? "base"}:${JSON.stringify(tokens)}`;
    if (lastAppliedKey.current === key) return;
    if (selectedPalette && pendingTokens) {
      setPendingTokens(null);
    }
    setPaletteTokens(tokens);
    onSelectionChange(selection);
    lastAppliedKey.current = key;
  }, [hasInitialized, pendingTokens, selectedPalette, selectedPaletteId, setPaletteTokens, onSelectionChange]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  const handleCreate = () => {
    setEditorMode("create");
    setFormState({
      ...EMPTY_FORM,
      tokens: cloneThemePaletteTokens(DEFAULT_THEME_PALETTE),
    });
    setModalOpen(true);
  };

  const handleEdit = () => {
    if (!selectedPalette) {
      handleCreate();
      return;
    }
    setEditorMode("edit");
    setFormState({
      name: selectedPalette.name,
      description: selectedPalette.description ?? "",
      tokens: cloneThemePaletteTokens(selectedPalette.tokens),
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editorMode === "edit" && selectedPaletteId) {
        const updated = await updatePalette.mutateAsync({
          id: selectedPaletteId,
          name: formState.name,
          description: formState.description,
          tokens: formState.tokens,
        });
        setModalOpen(false);
        if (updated) {
          setSelectedPaletteId(updated.id);
          setSelectedValue(String(updated.id));
          setPendingTokens(updated.tokens);
          onSelectionChange({ paletteId: updated.id, paletteName: updated.name });
          setStatusMessage("Theme updated");
        }
        return;
      }

      const created = await createPalette.mutateAsync({
        name: formState.name,
        description: formState.description,
        tokens: formState.tokens,
      });
      setModalOpen(false);
      if (created) {
        setSelectedPaletteId(created.id);
        setSelectedValue(String(created.id));
        setPendingTokens(created.tokens);
        onSelectionChange({ paletteId: created.id, paletteName: created.name });
        setStatusMessage("Theme created and applied");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save theme");
    }
  };

  const handlePresetSelection = async (presetId: string) => {
    const preset = PALETTE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const existingPalette = (data?.palettes ?? []).find((palette) => palette.name === preset.name);
    if (existingPalette) {
      setSelectedPaletteId(existingPalette.id);
      setSelectedValue(String(existingPalette.id));
      setPendingTokens(cloneThemePaletteTokens(existingPalette.tokens));
      setStatusMessage("Applied existing theme");
      return;
    }
    setSelectedValue(`preset:${presetId}`);
    setSelectedPaletteId(null);
    setPendingTokens(cloneThemePaletteTokens(preset.tokens));
    setStatusMessage("Applying preset...");
    try {
      const created = await createPalette.mutateAsync({
        name: preset.name,
        description: preset.description,
        tokens: preset.tokens,
      });
      if (created) {
        setSelectedPaletteId(created.id);
        setSelectedValue(String(created.id));
        setPendingTokens(created.tokens);
        setStatusMessage("Preset saved as a theme");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save preset");
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
      <div className="space-y-4">
        <div className="h-6 w-40 animate-pulse rounded bg-surface-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-surface-muted" />
      </div>
    );
  }

  if (!data?.businessId) {
    return (
      <div className="rounded-md border border-status-warning bg-status-warning-surface/40 p-4 text-sm text-status-warning">
        Create your business details before setting the workspace theme.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Workspace theme</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Preview a theme for the whole app now. It locks in when you review and launch.
        </p>
      </div>

      <div className="rounded-lg border border-outline-muted bg-surface-muted/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-primary">Theme selection</p>
            <p className="text-xs text-ink-muted">Choose from existing themes or keep the base palette.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleEdit}
              disabled={!selectedPaletteId}
              className="rounded-md border border-outline-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-primary transition hover:border-outline-strong hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            >
              Edit theme
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="rounded-md border border-outline-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-primary hover:bg-accent-muted"
            >
              Create new theme
            </button>
          </div>
        </div>

        {statusMessage ? <div className="mt-3 text-xs text-ink-muted">{statusMessage}</div> : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1 text-sm text-ink-primary">
            Theme
            <select
              className="rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 focus:ring"
              value={selectedValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue.startsWith("preset:")) {
                  void handlePresetSelection(nextValue.replace("preset:", ""));
                  return;
                }
                setPendingTokens(null);
                setSelectedValue(nextValue);
                setSelectedPaletteId(nextValue ? Number(nextValue) : null);
              }}
            >
              <option value="">Base palette</option>
              <optgroup label="Saved themes">
                {(data.palettes ?? []).map((palette) => (
                  <option key={palette.id} value={palette.id}>
                    {palette.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Presets">
                {PALETTE_PRESETS.map((preset) => (
                  <option key={preset.id} value={`preset:${preset.id}`}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="rounded-xl border border-outline-muted bg-surface-raised p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-subtle">Preview</p>
            <div className="mt-3">
              <PalettePreview tokens={selectedPalette?.tokens ?? DEFAULT_THEME_PALETTE} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-primary">Try a preset</p>
          <span className="text-xs text-ink-muted">Start with curated themes and tune them.</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {PALETTE_PRESETS.map((preset) => (
            <article key={preset.id} className="rounded-xl border border-outline-muted bg-surface-muted p-4">
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
                className="mt-4 w-full rounded-md border border-outline-muted px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-outline-accent hover:text-accent-soft"
                onClick={() => {
                  setEditorMode("create");
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

      {modalOpen ? (
        <PaletteEditorModal
          mode={editorMode}
          state={formState}
          onChange={setFormState}
          onColorChange={updateColor}
          onSubmit={handleSubmit}
          isSaving={createPalette.isPending || updatePalette.isPending}
          onClose={() => setModalOpen(false)}
          presets={PALETTE_PRESETS}
        />
      ) : null}
    </div>
  );
}
