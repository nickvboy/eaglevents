"use client";

import { useMemo } from "react";

import { useColorTheme } from "~/app/_components/theme/ColorThemeProvider";

const modes = [
  {
    value: "light" as const,
    title: "Light mode",
    description: "Airy surfaces with pastel gradients for presentation spaces.",
    gradient: "from-[#f6fbff] via-[#e7f1ff] to-[#cfdcf8]",
  },
  {
    value: "dark" as const,
    title: "Dark mode",
    description: "Immersive contrast ideal for dashboards and command centers.",
    gradient: "from-[#040915] via-[#0c1b2e] to-[#102b49]",
  },
  {
    value: "system" as const,
    title: "System",
    description: "Automatically adapts to your OS preference throughout the day.",
    gradient: "from-[#040915] via-[#223358] to-[#f6fbff]",
  },
];

export function ThemeModeCard() {
  const { mode, resolvedMode, setMode } = useColorTheme();
  const bannerCopy = useMemo(
    () =>
      resolvedMode === "light"
        ? "You’re previewing the bright Fluent-inspired palette."
        : "You’re previewing the deep Fluent-inspired palette.",
    [resolvedMode],
  );

  return (
    <section className="relative overflow-hidden rounded-3xl border border-outline-muted bg-surface-raised/90 p-6 shadow-[var(--shadow-pane)]">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-[#2563eb22] via-[#34d39933] to-transparent blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-ink-subtle">Theme</p>
        <h2 className="text-3xl font-semibold text-ink-primary">Color & appearance</h2>
        <p className="text-sm text-ink-muted max-w-3xl">
          Calibrate the workspace to feel like Microsoft Design’s fluent canvases. Pick a lighting scheme to apply instantly across scheduling,
          admin, and setup experiences.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {modes.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={
                "group flex flex-col rounded-2xl border p-4 text-left transition " +
                (selected
                  ? "border-accent-strong bg-accent-muted/30 shadow-[var(--shadow-accent-glow)]"
                  : "border-outline-muted bg-surface-muted/60 hover:border-outline-strong")
              }
            >
              <div className={`rounded-2xl bg-gradient-to-br ${option.gradient} p-3 shadow-inner`}>
                <div className="rounded-xl border border-white/20 bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
                  {option.title}
                </div>
              </div>
              <p className="mt-4 text-base font-semibold text-ink-primary">{option.title}</p>
              <p className="text-sm text-ink-muted">{option.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-outline-muted bg-surface-muted/80 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-subtle">Live preview</p>
          <p className="text-lg font-semibold text-ink-primary">{resolvedMode === "light" ? "Light surfaces" : "Dark surfaces"}</p>
          <p className="text-sm text-ink-muted">{bannerCopy}</p>
        </div>
        <div className="ml-auto flex flex-1 justify-end">
          <div className="grid grid-cols-2 gap-4">
            <Preview label="Light" gradient="from-[#f8fbff] via-[#e0eafc] to-[#cfe0ff]" active={resolvedMode === "light"} />
            <Preview label="Dark" gradient="from-[#050914] via-[#0b1a2c] to-[#132b49]" active={resolvedMode === "dark"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Preview({ label, gradient, active }: { label: string; gradient: string; active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={
          "h-20 w-24 rounded-[1.25rem] border p-1 shadow-inner transition " +
          (active ? "border-accent-strong shadow-[var(--shadow-accent-glow)]" : "border-outline-muted/60")
        }
      >
        <div className={`h-full w-full rounded-xl bg-gradient-to-br ${gradient}`} />
      </div>
      <span className="text-xs font-medium text-ink-muted">{label}</span>
    </div>
  );
}
