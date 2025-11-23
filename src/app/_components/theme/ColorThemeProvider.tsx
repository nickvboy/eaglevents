"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";
import type { ResolvedPalette } from "~/server/services/theme";
import type { ThemePaletteMode, ThemePaletteTokens } from "~/types/theme";
import { DEFAULT_THEME_PALETTE, THEME_VAR_NAME_MAP } from "~/types/theme";

type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ColorThemeContextValue = {
  mode: ThemeMode;
  resolvedMode: ResolvedTheme;
  palette: ThemePaletteTokens;
  setMode: (mode: ThemeMode) => void;
  setPaletteTokens: (tokens: ThemePaletteTokens) => void;
};

const STORAGE_KEY = "eaglevents:theme-mode";

const ColorThemeContext = createContext<ColorThemeContextValue>({
  mode: "system",
  resolvedMode: "dark",
  palette: DEFAULT_THEME_PALETTE,
  setMode: () => {
    /* noop */
  },
  setPaletteTokens: () => {
    /* noop */
  },
});

function getSystemPreference(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeDataset(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.body.dataset.theme = theme;
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const chunk = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
  const bigint = Number.parseInt(chunk, 16);
  if (Number.isNaN(bigint)) return null;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyPaletteVariables(mode: ResolvedTheme, palette: ThemePaletteTokens) {
  if (typeof document === "undefined") return;
  const tokens = palette[mode] ?? DEFAULT_THEME_PALETTE[mode];
  const style = document.body.style;
  (Object.keys(THEME_VAR_NAME_MAP) as (keyof ThemePaletteMode)[]).forEach((key) => {
    const cssVar = THEME_VAR_NAME_MAP[key];
    const value = tokens[key];
    if (value) {
      style.setProperty(cssVar, value);
    }
  });
  const accentGlow = hexToRgba(tokens.accentStrong, mode === "dark" ? 0.55 : 0.35) ?? "rgba(0,0,0,0.4)";
  style.setProperty("--shadow-accent-glow", `0 0 14px ${accentGlow}`);
}

type ColorThemeProviderProps = {
  children: React.ReactNode;
  initialPalette: ResolvedPalette;
};

export function ColorThemeProvider({ children, initialPalette }: ColorThemeProviderProps) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [resolvedMode, setResolvedMode] = useState<ResolvedTheme>("dark");
  const [palette, setPalette] = useState<ThemePaletteTokens>(initialPalette.tokens);
  const { data: latestPalette } = api.theme.current.useQuery(undefined, {
    initialData: initialPalette,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (latestPalette?.tokens) {
      setPalette(latestPalette.tokens);
    }
  }, [latestPalette]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setMode(stored);
    } else {
      // ensure resolved matches system preference on first paint
      const system = getSystemPreference();
      setResolvedMode(system);
      applyThemeDataset(system);
      applyPaletteVariables(system, palette);
    }
  }, [palette]);

  useEffect(() => {
    const systemMedia = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    const updateResolvedTheme = () => {
      const systemPreference = systemMedia ? (systemMedia.matches ? "dark" : "light") : getSystemPreference();
      const nextResolved = mode === "system" ? systemPreference : mode;
      setResolvedMode(nextResolved);
      applyThemeDataset(nextResolved);
      applyPaletteVariables(nextResolved, palette);
    };

    updateResolvedTheme();

    if (mode === "system" && systemMedia) {
      const listener = () => updateResolvedTheme();
      systemMedia.addEventListener("change", listener);
      return () => systemMedia.removeEventListener("change", listener);
    }

    return undefined;
  }, [mode, palette]);

  useEffect(() => {
    applyPaletteVariables(resolvedMode, palette);
  }, [resolvedMode, palette]);

  const persistMode = useCallback((nextMode: ThemeMode) => {
    setMode(nextMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextMode);
    }
  }, []);

  const value = useMemo(
    () => ({
      mode,
      resolvedMode,
      setMode: persistMode,
      palette,
      setPaletteTokens: (tokens: ThemePaletteTokens) => setPalette(cloneThemePaletteTokens(tokens)),
    }),
    [mode, resolvedMode, palette, persistMode],
  );

  return <ColorThemeContext.Provider value={value}>{children}</ColorThemeContext.Provider>;
}

export function useColorTheme() {
  const ctx = useContext(ColorThemeContext);
  if (!ctx) {
    throw new Error("useColorTheme must be used within a ColorThemeProvider");
  }
  return ctx;
}

function cloneThemePaletteTokens(tokens: ThemePaletteTokens) {
  return JSON.parse(JSON.stringify(tokens)) as ThemePaletteTokens;
}
