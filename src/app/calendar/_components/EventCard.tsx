"use client";

import { MaximizeIcon } from "~/app/_components/icons";

type Props = {
  title: string;
  location?: string | null;
  start: Date;
  end: Date;
  isSelected?: boolean;
  onClick?: () => void;
  onExpand?: () => void;
  onDoubleClick?: () => void;
};

export function EventCard(p: Props) {
  const timeLabel = `${formatTime(p.start)} - ${formatTime(p.end)}`;
  const baseClasses =
    "group relative h-full w-full cursor-pointer overflow-hidden rounded-md border bg-accent-strong p-1 text-xs text-ink-inverted shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
  const stateClasses = p.isSelected
    ? "border-outline-muted/80 ring-2 ring-accent-soft shadow-lg shadow-[var(--shadow-accent-glow)]"
    : "border-outline-accent hover:border-outline-accent hover:bg-accent-default";

  return (
    <div
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      className={`${baseClasses} ${stateClasses}`}
      title={p.title}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          p.onClick?.();
        }
      }}
    >
      <div className="space-y-0.5 pr-5">
        <div className="truncate font-medium">{p.title}</div>
        {p.location && <div className="truncate text-ink-primary">{p.location}</div>}
        <div className="text-[10px] text-ink-subtle">{timeLabel}</div>
      </div>
      {p.isSelected && (
        <button
          type="button"
          aria-label="Expand to full details"
          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border border-outline-muted/30 bg-surface-muted text-ink-primary transition hover:bg-surface-overlay"
          onClick={(event) => {
            event.stopPropagation();
            p.onExpand?.();
          }}
        >
          <MaximizeIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function formatTime(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}
