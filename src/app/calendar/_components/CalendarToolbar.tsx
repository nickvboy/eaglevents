"use client";

import type { Session } from "next-auth";

import { AccountMenu } from "./AccountMenu";
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
  currentUser: Session["user"] | null;
};

const views: Props["view"][] = ["day", "threeday", "workweek", "week", "month"];

export function CalendarToolbar(props: Props) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-2 text-white">
      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
          onClick={props.onNewEvent}
        >
          New event
        </button>
        <button className="rounded-md border border-white/20 px-2 py-1 text-sm hover:bg-white/10" onClick={props.onToday}>
          Today
        </button>
        <div className="ml-1 flex items-center">
          <button
            className="flex items-center justify-center rounded-l-md border border-white/20 px-2 py-1 hover:bg-white/10"
            onClick={props.onPrev}
            aria-label="Previous period"
            type="button"
          >
            <ChevronLeftIcon />
          </button>
          <button
            className="-ml-px flex items-center justify-center rounded-r-md border border-white/20 px-2 py-1 hover:bg-white/10"
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
          className="ml-3 cursor-pointer select-none rounded-md px-2 py-1 text-sm text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/60 focus-visible:outline-offset-2"
          onClick={() => props.onViewChange("month")}
        >
          {formatRangeLabel(props.rangeStart, props.rangeEnd)}
        </button>
     </div>
      <div className="flex items-center gap-2">
        {views.map((v) => (
          <button
            key={v}
            onClick={() => props.onViewChange(v)}
            className={
              "rounded-md px-2 py-1 text-sm capitalize " +
              (props.view === v ? "bg-white/20" : "hover:bg-white/10 border border-white/10")
            }
          >
            {v === "workweek" ? "Work week" : v === "threeday" ? "3 day" : v}
          </button>
        ))}
        <div className="ml-2 h-5 w-px bg-white/10" />
        <AccountMenu user={props.currentUser} />
      </div>
    </div>
  );
}
