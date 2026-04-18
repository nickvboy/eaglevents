"use client";

import { useEffect, useRef, useState } from "react";

import { MaximizeIcon } from "~/app/_components/icons";

type Props = {
  title: string;
  location?: string | null;
  start: Date;
  end: Date;
  isSelected?: boolean;
  color?: string;
  onClick?: () => void;
  onExpand?: () => void;
  onDoubleClick?: () => void;
};

export function EventCard(p: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [shouldWrapText, setShouldWrapText] = useState(true);
  const [frozenTextHeight, setFrozenTextHeight] = useState<number | null>(null);
  const timeLabel = `${formatTime(p.start)} - ${formatTime(p.end)}`;
  const baseClasses =
    "group relative h-full w-full cursor-pointer overflow-hidden rounded-md border p-1 text-xs text-ink-inverted shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
  const stateClasses = p.isSelected
    ? "border-outline-muted/80 ring-2 ring-accent-soft shadow-lg shadow-[var(--shadow-accent-glow)]"
    : "border-outline-accent hover:border-outline-accent hover:bg-accent-default";
  const textClasses = shouldWrapText
    ? "whitespace-normal break-words"
    : "break-normal whitespace-normal overflow-hidden [overflow-wrap:normal] [word-break:normal]";

  useEffect(() => {
    const card = cardRef.current;
    const content = contentRef.current;
    if (!card || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width >= 88) {
        setShouldWrapText(true);
        setFrozenTextHeight(null);
        return;
      }

      setShouldWrapText(false);
      setFrozenTextHeight((currentHeight) => currentHeight ?? content.getBoundingClientRect().height);
    });

    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      className={`${baseClasses} ${stateClasses}`}
      style={p.color ? { backgroundColor: p.color } : undefined}
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
      <div
        ref={contentRef}
        className="space-y-0.5 overflow-hidden pr-2"
        style={frozenTextHeight ? { maxHeight: `${frozenTextHeight}px` } : undefined}
      >
        <div className={`${textClasses} font-semibold`}>{p.title}</div>
        {p.location && <div className={`${textClasses} text-ink-primary`}>{p.location}</div>}
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
