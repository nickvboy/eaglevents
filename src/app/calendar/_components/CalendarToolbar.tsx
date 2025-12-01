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
  ticketSearchValue: string;
  ticketSearchPending: boolean;
  ticketSearchError: string | null;
  onTicketSearchChange: (value: string) => void;
  onTicketSearchSubmit: () => void;
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
      <div className="flex flex-1 flex-wrap items-end justify-end gap-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1 sm:flex-none">
          <div className="flex h-9 w-full min-w-[220px] items-center rounded-md border border-outline-muted bg-surface-base shadow-inner">
            <input
              type="text"
              className="h-full flex-1 rounded-l-md bg-transparent px-3 text-sm outline-none"
              placeholder="Jump to ticket ID or code"
              value={props.ticketSearchValue}
              onChange={(e) => props.onTicketSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  props.onTicketSearchSubmit();
                }
              }}
            />
            <button
              type="button"
              className="rounded-r-md bg-accent-strong px-3 py-1 text-sm font-medium text-ink-inverted hover:bg-accent-default disabled:opacity-60"
              onClick={props.onTicketSearchSubmit}
              disabled={props.ticketSearchPending}
            >
              Go
            </button>
          </div>
          <p className={"text-xs " + (props.ticketSearchError ? "text-status-danger" : "text-ink-subtle")}>
            {props.ticketSearchError ?? "Enter ticket ID, event code, or Zendesk #"}
          </p>
        </div>
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
        <div className="ml-2 h-5 w-px bg-surface-muted" />
        <AccountMenu user={props.currentUser} />
      </div>
    </div>
  );
}
