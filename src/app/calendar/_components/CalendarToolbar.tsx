"use client";

import type { Session } from "next-auth";

import { formatRangeLabel } from "../utils/date";

type Props = {
  rangeStart: Date;
  rangeEnd: Date;
  view: "day" | "workweek" | "week" | "month";
  onViewChange: (v: Props["view"]) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onNewEvent: () => void;
  currentUser: Session["user"] | null;
};

const views: Props["view"][] = ["day", "workweek", "week", "month"];

import { AccountMenu } from "./AccountMenu";

export function CalendarToolbar(props: Props) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-2 text-white">
      <div className="flex items-center gap-2">
        <button className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black" onClick={props.onNewEvent}>
          New event
        </button>
        <button className="rounded-md border border-white/20 px-2 py-1 text-sm hover:bg-white/10" onClick={props.onToday}>
          Today
        </button>
        <div className="ml-1 flex items-center">
          <button className="rounded-l-md border border-white/20 px-2 py-1 hover:bg-white/10" onClick={props.onPrev}>
            ◀
          </button>
          <button className="-ml-px rounded-r-md border border-white/20 px-2 py-1 hover:bg-white/10" onClick={props.onNext}>
            ▶
          </button>
        </div>
        <div className="ml-3 text-sm text-white/80">{formatRangeLabel(props.rangeStart, props.rangeEnd)}</div>
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
            {v === "workweek" ? "Work week" : v}
          </button>
        ))}
        <div className="ml-2 h-5 w-px bg-white/10" />
        <AccountMenu user={props.currentUser} />
      </div>
    </div>
  );
}
