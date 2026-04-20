"use client";

type SectionId = "overview" | "trends" | "eventTypes" | "locations" | "requesters" | "attendees" | "durations" | "overlap";

type SectionDef = {
  id: SectionId;
  label: string;
};

export function AnalyticsSectionTabs(props: {
  sections: SectionDef[];
  active: SectionId;
  onChange: (id: SectionId) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-3 border-b border-outline-muted pb-2" aria-label="Analytics sections">
      {props.sections.map((section) => {
        const isActive = section.id === props.active;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => props.onChange(section.id)}
            className={
              "rounded-full px-4 py-2 text-sm font-medium transition " +
              (isActive
                ? "bg-accent-strong text-white shadow-[var(--shadow-accent-glow)]"
                : "border border-outline-muted bg-surface-muted text-ink-muted hover:text-ink-primary")
            }
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );
}
