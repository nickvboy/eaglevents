export type ThemePaletteMode = {
  surfaceCanvas: string;
  surfaceSunken: string;
  surfaceRaised: string;
  surfaceMuted: string;
  surfaceOverlay: string;
  overlayBackdrop: string;
  outlineMuted: string;
  outlineStrong: string;
  outlineAccent: string;
  inkPrimary: string;
  inkMuted: string;
  inkSubtle: string;
  inkFaint: string;
  inkInverted: string;
  accentStrong: string;
  accentDefault: string;
  accentSoft: string;
  accentMuted: string;
  statusSuccess: string;
  statusSuccessSurface: string;
  statusWarning: string;
  statusWarningSurface: string;
  statusDanger: string;
  statusDangerSurface: string;
};

export type ThemePaletteTokens = {
  dark: ThemePaletteMode;
  light: ThemePaletteMode;
};

export const DEFAULT_THEME_PALETTE: ThemePaletteTokens = {
  dark: {
    surfaceCanvas: "#04070c",
    surfaceSunken: "#050b13",
    surfaceRaised: "#0b1220",
    surfaceMuted: "#111a2a",
    surfaceOverlay: "#0d111bbf",
    overlayBackdrop: "#02070cb3",
    outlineMuted: "#1f2a37",
    outlineStrong: "#3b4a60",
    outlineAccent: "#34d399",
    inkPrimary: "#f7f8fb",
    inkMuted: "#d4daea",
    inkSubtle: "#a9b4c8",
    inkFaint: "#7b879f",
    inkInverted: "#030408",
    accentStrong: "#34d399",
    accentDefault: "#10b981",
    accentSoft: "#6ee7b7",
    accentMuted: "#0f3c29",
    statusSuccess: "#34d399",
    statusSuccessSurface: "#04261d",
    statusWarning: "#fbbf24",
    statusWarningSurface: "#3b2505",
    statusDanger: "#f87171",
    statusDangerSurface: "#3b0d16",
  },
  light: {
    surfaceCanvas: "#f4f7fb",
    surfaceSunken: "#edf1f7",
    surfaceRaised: "#ffffff",
    surfaceMuted: "#e6ebf5",
    surfaceOverlay: "#f8fbffeb",
    overlayBackdrop: "#0f172a8c",
    outlineMuted: "#cbd4e4",
    outlineStrong: "#92a3c0",
    outlineAccent: "#0f9d7a",
    inkPrimary: "#0f172a",
    inkMuted: "#334155",
    inkSubtle: "#475569",
    inkFaint: "#64748b",
    inkInverted: "#f7f8fb",
    accentStrong: "#059669",
    accentDefault: "#0ea876",
    accentSoft: "#34d399",
    accentMuted: "#bff1da",
    statusSuccess: "#15803d",
    statusSuccessSurface: "#dcfce7",
    statusWarning: "#b45309",
    statusWarningSurface: "#fef3c7",
    statusDanger: "#b91c1c",
    statusDangerSurface: "#fee2e2",
  },
};

export const THEME_PALETTE_FIELD_GROUPS: {
  key: string;
  label: string;
  fields: { key: keyof ThemePaletteMode; label: string; description?: string }[];
}[] = [
  {
    key: "surfaces",
    label: "Surfaces",
    fields: [
      { key: "surfaceCanvas", label: "Canvas" },
      { key: "surfaceSunken", label: "Sunken" },
      { key: "surfaceRaised", label: "Raised" },
      { key: "surfaceMuted", label: "Muted" },
      { key: "surfaceOverlay", label: "Overlay" },
      { key: "overlayBackdrop", label: "Backdrop" },
    ],
  },
  {
    key: "ink",
    label: "Typography",
    fields: [
      { key: "inkPrimary", label: "Primary" },
      { key: "inkMuted", label: "Muted" },
      { key: "inkSubtle", label: "Subtle" },
      { key: "inkFaint", label: "Faint" },
      { key: "inkInverted", label: "Inverted" },
      { key: "outlineMuted", label: "Outline Muted" },
      { key: "outlineStrong", label: "Outline Strong" },
      { key: "outlineAccent", label: "Outline Accent" },
    ],
  },
  {
    key: "accent",
    label: "Accent",
    fields: [
      { key: "accentStrong", label: "Strong" },
      { key: "accentDefault", label: "Default" },
      { key: "accentSoft", label: "Soft" },
      { key: "accentMuted", label: "Muted" },
    ],
  },
  {
    key: "status",
    label: "Status",
    fields: [
      { key: "statusSuccess", label: "Success" },
      { key: "statusSuccessSurface", label: "Success Surface" },
      { key: "statusWarning", label: "Warning" },
      { key: "statusWarningSurface", label: "Warning Surface" },
      { key: "statusDanger", label: "Danger" },
      { key: "statusDangerSurface", label: "Danger Surface" },
    ],
  },
];

export const THEME_VAR_NAME_MAP: Record<keyof ThemePaletteMode, string> = {
  surfaceCanvas: "--color-surface-canvas",
  surfaceSunken: "--color-surface-sunken",
  surfaceRaised: "--color-surface-raised",
  surfaceMuted: "--color-surface-muted",
  surfaceOverlay: "--color-surface-overlay",
  overlayBackdrop: "--color-overlay-backdrop",
  outlineMuted: "--color-outline-muted",
  outlineStrong: "--color-outline-strong",
  outlineAccent: "--color-outline-accent",
  inkPrimary: "--color-ink-primary",
  inkMuted: "--color-ink-muted",
  inkSubtle: "--color-ink-subtle",
  inkFaint: "--color-ink-faint",
  inkInverted: "--color-ink-inverted",
  accentStrong: "--color-accent-strong",
  accentDefault: "--color-accent-default",
  accentSoft: "--color-accent-soft",
  accentMuted: "--color-accent-muted",
  statusSuccess: "--color-status-success",
  statusSuccessSurface: "--color-status-success-surface",
  statusWarning: "--color-status-warning",
  statusWarningSurface: "--color-status-warning-surface",
  statusDanger: "--color-status-danger",
  statusDangerSurface: "--color-status-danger-surface",
};

export function cloneThemePaletteTokens(source?: ThemePaletteTokens): ThemePaletteTokens {
  return source ? (JSON.parse(JSON.stringify(source)) as ThemePaletteTokens) : (JSON.parse(JSON.stringify(DEFAULT_THEME_PALETTE)) as ThemePaletteTokens);
}
