"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ColorThemeContextValue = {
  mode: ThemeMode;
  resolvedMode: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

const STORAGE_KEY = "eaglevents:theme-mode";

const ColorThemeContext = createContext<ColorThemeContextValue>({
  mode: "system",
  resolvedMode: "dark",
  setMode: () => {
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

export function ColorThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [resolvedMode, setResolvedMode] = useState<ResolvedTheme>("dark");

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
    }
  }, []);

  useEffect(() => {
    const systemMedia = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

    const updateResolvedTheme = () => {
      const systemPreference = systemMedia ? (systemMedia.matches ? "dark" : "light") : getSystemPreference();
      const nextResolved = mode === "system" ? systemPreference : mode;
      setResolvedMode(nextResolved);
      applyThemeDataset(nextResolved);
    };

    updateResolvedTheme();

    if (mode === "system" && systemMedia) {
      const listener = () => updateResolvedTheme();
      systemMedia.addEventListener("change", listener);
      return () => systemMedia.removeEventListener("change", listener);
    }

    return undefined;
  }, [mode]);

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
    }),
    [mode, resolvedMode, persistMode],
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
