"use client";

type Props = {
  title: string;
  location?: string | null;
  start: Date;
  end: Date;
  color?: string;
};

export function EventCard(p: Props) {
  const timeLabel = `${formatTime(p.start)} - ${formatTime(p.end)}`;
  return (
    <div
      className="h-full w-full overflow-hidden rounded-md border border-emerald-500 bg-emerald-600 p-1 text-xs text-white shadow"
      title={p.title}
    >
      <div className="truncate font-medium">{p.title}</div>
      {p.location && <div className="truncate text-white/80">{p.location}</div>}
      <div className="text-[10px] text-white/70">{timeLabel}</div>
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

