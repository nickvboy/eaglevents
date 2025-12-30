"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "~/app/_components/icons";
import { formatRangeLabel } from "../utils/date";

type Props = {
  rangeStart: Date;
  rangeEnd: Date;
  view: "day" | "threeday" | "workweek" | "week" | "month";
  onViewChange: (v: Props["view"]) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onNewEvent: () => void;
};

const views: Props["view"][] = ["day", "threeday", "workweek", "week", "month"];

export function CalendarToolbar(props: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-muted bg-surface-muted px-4 py-2 text-ink-primary">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-md bg-accent-strong px-3 py-1.5 text-sm font-medium text-ink-inverted hover:bg-accent-default"
          onClick={props.onNewEvent}
        >
          New event
        </button>
        <button className="rounded-md border border-outline-muted px-2 py-1 text-sm hover:bg-surface-muted" onClick={props.onToday}>
          Today
        </button>
        <div className="ml-1 flex items-center">
          <button
            className="flex items-center justify-center rounded-l-md border border-outline-muted px-2 py-1 hover:bg-surface-muted"
            onClick={props.onPrev}
            aria-label="Previous period"
            type="button"
          >
            <ChevronLeftIcon />
          </button>
          <button
            className="-ml-px flex items-center justify-center rounded-r-md border border-outline-muted px-2 py-1 hover:bg-surface-muted"
            onClick={props.onNext}
            aria-label="Next period"
            type="button"
          >
            <ChevronRightIcon />
          </button>
        </div>
        <button
          type="button"
          aria-pressed={props.view === "month"}
          className="ml-3 cursor-pointer select-none rounded-md px-2 py-1 text-sm text-ink-primary transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-strong focus-visible:outline-offset-2"
          onClick={() => props.onViewChange("month")}
        >
          {formatRangeLabel(props.rangeStart, props.rangeEnd)}
        </button>
      </div>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
        {views.map((v) => (
          <button
            key={v}
            onClick={() => props.onViewChange(v)}
            className={
              "rounded-md px-2 py-1 text-sm capitalize transition " +
              (props.view === v
                ? "border border-outline-accent bg-accent-muted text-ink-primary"
                : "border border-outline-muted text-ink-subtle hover:bg-surface-muted")
            }
          >
            {v === "workweek" ? "Work week" : v === "threeday" ? "3 day" : v}
          </button>
        ))}
      </div>
    </div>
  );
}
