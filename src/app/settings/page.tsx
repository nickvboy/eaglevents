import { ThemeModeCard } from "./_components/ThemeModeCard";
import { PaletteManager } from "./_components/PaletteManager";

const timeline = [
  { label: "Surface families", body: "Canvas, acrylic, and spotlight layers aligned to Fluent." },
  { label: "Typography", body: "Geist Sans paired with Segoe-like rhythm." },
  { label: "Motion", body: "Adaptive easing maps for product and marketing surfaces." },
];

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col bg-surface-canvas text-ink-primary">
      <section className="relative isolate overflow-hidden border-b border-outline-muted bg-[radial-gradient(circle_at_top,#1d4ed8_0%,transparent_55%),radial-gradient(circle_at_20%_20%,#34d39940,transparent_50%)]">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(4,7,12,0.8),rgba(4,7,12,0.3))]" aria-hidden />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-16 text-left text-white">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.45em] text-white/70">Design system</p>
            <h1 className="text-4xl font-semibold leading-tight">Microsoft-inspired workspace settings</h1>
            <p className="max-w-3xl text-base text-white/80">
              Tune colors, lighting, and upcoming tokens from a single pane. Everything you dial in cascades instantly over calendars,
              admin dashboards, and onboarding.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {timeline.map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/15 bg-white/5 p-4">
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-sm text-white/70">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <ThemeModeCard />

        <PaletteManager />

        <div className="rounded-3xl border border-outline-muted bg-surface-muted/80 p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.35em] text-ink-subtle">Roadmap</div>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h4 className="text-lg font-semibold text-ink-primary">Guided launches</h4>
              <p className="mt-2 text-sm text-ink-muted">Sequence color changes with communication templates for your teams.</p>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-ink-primary">Live prototyping</h4>
              <p className="mt-2 text-sm text-ink-muted">Preview cross-mode hero sections with Azure-powered renders.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
