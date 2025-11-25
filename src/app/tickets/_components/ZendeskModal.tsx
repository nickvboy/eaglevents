"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, XIcon } from "~/app/_components/icons";
import { api, type RouterOutputs } from "~/trpc/react";

type QueuePayload = RouterOutputs["event"]["zendeskQueue"];
type ReadyItem = QueuePayload["ready"][number];
type NeedsItem = QueuePayload["needsLogging"][number];

type Props = {
  open: boolean;
  onClose: () => void;
};

type TabKey = "ready" | "needs";

export function ZendeskModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabKey>("ready");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);
  const [needsItems, setNeedsItems] = useState<NeedsItem[]>([]);
  const [copied, setCopied] = useState<"id" | "hours" | null>(null);

  useEffect(() => setMounted(true), []);

  const { data, isLoading, isFetching, refetch } = api.event.zendeskQueue.useQuery(undefined, {
    enabled: open,
  });
  const confirmMutation = api.event.confirmZendesk.useMutation();

  useEffect(() => {
    if (!data) return;
    setReadyItems(data.ready);
    setNeedsItems(data.needsLogging);
    setCurrentIndex(0);
  }, [data]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [tab, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const activeLength = tab === "ready" ? readyItems.length : needsItems.length;
    if (activeLength === 0) {
      setCurrentIndex(0);
    } else if (currentIndex >= activeLength) {
      setCurrentIndex(Math.max(0, activeLength - 1));
    }
  }, [currentIndex, readyItems.length, needsItems.length, tab]);

  const activeList = tab === "ready" ? readyItems : needsItems;
  const activeItem = activeList[currentIndex] ?? null;
  const totalTickets = activeList.length;
  const isConfirmDisabled = !activeItem || activeItem.totalLoggedMinutesForUser <= 0 || confirmMutation.isPending;

  const copy = async (value: string, key: "id" | "hours") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleConfirm = () => {
    if (!activeItem || isConfirmDisabled) return;
    confirmMutation.mutate(
      { eventId: activeItem.eventId },
      {
        onSuccess: async () => {
          setReadyItems((prev) => {
            const next = prev.filter((item) => item.eventId !== activeItem.eventId);
            if (tab === "ready") {
              setCurrentIndex((idx) => Math.min(idx, Math.max(0, next.length - 1)));
            }
            return next;
          });
          setNeedsItems((prev) => {
            const next = prev.filter((item) => item.eventId !== activeItem.eventId);
            if (tab === "needs") {
              setCurrentIndex((idx) => Math.min(idx, Math.max(0, next.length - 1)));
            }
            return next;
          });
          await refetch();
        },
      },
    );
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur">
      <div className="relative flex h-[80vh] w-[min(1100px,90vw)] flex-col overflow-hidden rounded-2xl border border-outline-muted bg-surface-overlay shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-muted px-6 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Zendesk</div>
            <div className="text-lg font-semibold text-ink-primary">Copy tickets into Zendesk</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">
              {isFetching ? "Refreshing..." : `${readyItems.length} ready, ${needsItems.length} need logging`}
            </span>
            <button
              type="button"
              className="rounded-full p-2 text-ink-muted transition hover:bg-surface-muted hover:text-ink-primary"
              onClick={onClose}
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex h-full min-h-0 flex-1 overflow-hidden border-t border-outline-muted/60">
          <aside className="w-72 shrink-0 border-r border-outline-muted bg-surface-sunken/50">
            <div className="flex gap-2 p-4">
              <TabButton label="Ready to send" count={readyItems.length} active={tab === "ready"} onClick={() => setTab("ready")} />
              <TabButton label="Needs logging" count={needsItems.length} active={tab === "needs"} onClick={() => setTab("needs")} />
            </div>
            <div className="h-full overflow-auto px-3 pb-4">
              <QueueList
                tab={tab}
                readyItems={readyItems}
                needsItems={needsItems}
                activeIndex={currentIndex}
                onSelect={setCurrentIndex}
                isLoading={isLoading}
              />
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col bg-surface-muted/40">
            <div className="flex items-center justify-between border-b border-outline-muted bg-surface-overlay/60 px-6 py-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="rounded-full bg-surface-muted px-3 py-1 font-semibold text-ink-primary">
                  {totalTickets > 0 ? `Ticket ${currentIndex + 1} of ${totalTickets}` : "No tickets"}
                </span>
                <span className="text-ink-subtle">
                  {tab === "ready" ? "Hours logged and waiting for Zendesk entry." : "Tickets needing hours or confirmation."}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`flex h-9 w-9 items-center justify-center rounded-full border border-outline-muted transition ${
                    currentIndex === 0 ? "cursor-not-allowed opacity-50" : "hover:bg-surface-muted"
                  }`}
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={`flex h-9 w-9 items-center justify-center rounded-full border border-outline-muted transition ${
                    currentIndex >= totalTickets - 1 || totalTickets === 0 ? "cursor-not-allowed opacity-50" : "hover:bg-surface-muted"
                  }`}
                  disabled={currentIndex >= totalTickets - 1 || totalTickets === 0}
                  onClick={() => setCurrentIndex((idx) => Math.min(totalTickets - 1, idx + 1))}
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            {tab === "ready" && readyItems.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                <div className="text-2xl font-semibold text-ink-primary">All caught up</div>
                <p className="max-w-md text-sm text-ink-muted">
                  There are no tickets waiting to be copied into Zendesk. Log hours or switch to &quot;Needs logging&quot; to see anything missing.
                </p>
              </div>
            ) : totalTickets === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-sm text-ink-muted">
                Nothing to show yet.
              </div>
            ) : (
              <TicketDetail
                item={activeItem}
                tab={tab}
                copied={copied}
                onCopy={copy}
                onConfirm={handleConfirm}
                confirmDisabled={isConfirmDisabled}
                isSubmitting={confirmMutation.isPending}
                onClose={onClose}
              />
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col rounded-lg border px-3 py-2 text-left transition ${
        active ? "border-outline-accent bg-accent-muted text-ink-primary" : "border-outline-muted bg-surface-muted hover:bg-surface-sunken"
      }`}
    >
      <span className="text-xs uppercase tracking-wide text-ink-subtle">{label}</span>
      <span className="text-xl font-semibold text-ink-primary">{count}</span>
    </button>
  );
}

function QueueList({
  tab,
  readyItems,
  needsItems,
  activeIndex,
  onSelect,
  isLoading,
}: {
  tab: TabKey;
  readyItems: ReadyItem[];
  needsItems: NeedsItem[];
  activeIndex: number;
  onSelect: (idx: number) => void;
  isLoading: boolean;
}) {
  const isNeedsTab = tab === "needs";
  const items: Array<ReadyItem | NeedsItem> = tab === "ready" ? readyItems : needsItems;
  if (isLoading) {
    return <div className="p-4 text-sm text-ink-muted">Loading queueâ€¦</div>;
  }
  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        {tab === "ready" ? "No tickets with hours to copy." : "No tickets needing attention."}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item, idx) => {
        const isActive = idx === activeIndex;
        const durationHms = formatDurationHms(item.totalLoggedMinutesForUser);
        const needsReconfirm = "needsReconfirm" in item ? item.needsReconfirm : false;
        const status =
          isNeedsTab && "status" in item
            ? item.status === "no_hours_logged"
              ? "No hours logged"
              : item.status === "new_hours_unconfirmed"
                ? "New hours added"
                : "Hours not confirmed"
            : needsReconfirm
              ? "New hours added"
              : "Ready to send";
        return (
          <li key={item.eventId}>
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                isActive ? "border-outline-accent bg-accent-muted/50 shadow-sm" : "border-outline-muted bg-surface-muted hover:bg-surface-sunken"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-ink-primary line-clamp-2">{item.title}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  #{item.eventCode ?? item.eventId}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-subtle">
                <span className="rounded-full border border-outline-muted px-2 py-0.5 text-[11px] font-semibold text-ink-primary">
                  {status}
                </span>
                {item.zendeskTicketNumber && <span className="truncate">ZD {item.zendeskTicketNumber}</span>}
                {item.totalLoggedMinutesForUser > 0 && (
                  <span className="rounded-full bg-surface-overlay px-2 py-0.5 font-semibold text-ink-primary">
                    {durationHms}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TicketDetail({
  item,
  tab,
  copied,
  onCopy,
  onConfirm,
  confirmDisabled,
  isSubmitting,
  onClose,
}: {
  item: ReadyItem | NeedsItem | null;
  tab: TabKey;
  copied: "id" | "hours" | null;
  onCopy: (value: string, key: "id" | "hours") => void;
  onConfirm: () => void;
  confirmDisabled: boolean;
  isSubmitting: boolean;
  onClose: () => void;
}) {
  if (!item) {
    return <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">Select a ticket to see details.</div>;
  }

  const start = new Date(item.startDatetime);
  const end = new Date(item.endDatetime);
  const needsStatus = tab === "needs" && "status" in item ? item.status : null;

  return (
    <div className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-4 rounded-2xl border border-outline-muted bg-surface-overlay/70 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Ticket</div>
            <div className="text-lg font-semibold text-ink-primary">{item.title}</div>
            <div className="text-xs text-ink-muted">
              {formatDateLabel(start)} - {formatTimeRange(start, end)}
            </div>
          </div>
          <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-ink-muted">
            #{item.eventCode ?? item.eventId}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CopyButton
            label="Zendesk ID"
            value={item.zendeskTicketNumber ?? "-"}
            disabled={!item.zendeskTicketNumber}
            copied={copied === "id"}
            onCopy={() => item.zendeskTicketNumber && onCopy(item.zendeskTicketNumber, "id")}
          />
          <CopyButton
            label="Hours to copy"
            value={formatDurationHms(item.totalLoggedMinutesForUser)}
            disabled={item.totalLoggedMinutesForUser <= 0}
            copied={copied === "hours"}
            onCopy={() =>
              item.totalLoggedMinutesForUser > 0 && onCopy(formatDurationHms(item.totalLoggedMinutesForUser), "hours")
            }
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-outline-muted bg-surface-muted px-4 py-3">
          <div className="space-y-0.5 text-sm">
            <div className="font-semibold text-ink-primary">Info entered</div>
            <div className="text-xs text-ink-muted">
              {tab === "ready"
                ? "Confirm after pasting Zendesk ID and hours."
                : "Log hours first, then confirm after copying into Zendesk."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-outline-muted px-3 py-2 text-sm font-semibold text-ink-muted transition hover:bg-surface-overlay"
            >
              Close
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={onConfirm}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                confirmDisabled
                  ? "cursor-not-allowed border border-outline-muted text-ink-muted"
                  : "border border-outline-accent bg-accent-soft text-white hover:-translate-y-0.5 hover:shadow-lg"
              }`}
            >
              {isSubmitting ? "Savingâ€¦" : "Info entered"}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-outline-muted bg-surface-overlay/50 p-4">
        <div className="flex items-center justify-between text-xs uppercase tracking-wide text-ink-subtle">
          <span>Status</span>
          {needsStatus && (
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-primary">
              {needsStatus === "no_hours_logged"
                ? "No hours logged"
                : needsStatus === "new_hours_unconfirmed"
                  ? "New hours added"
                  : "Hours not confirmed"}
            </span>
          )}
        </div>
        <div className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-subtle">
          <div className="flex items-center justify-between">
            <span>Zendesk ticket</span>
            <span className="font-semibold text-ink-primary">{item.zendeskTicketNumber ?? "Not set"}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span>Logged hours</span>
            <span className="font-semibold text-ink-primary">{formatDurationHms(item.totalLoggedMinutesForUser)}</span>
          </div>
        </div>
        <div className="text-xs text-ink-muted">
          Select tickets on the left, copy the Zendesk ID and hours, then confirm once everything is entered.
        </div>
      </div>
    </div>
  );
}

function CopyButton({
  label,
  value,
  disabled,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-outline-muted bg-surface-muted px-4 py-3">
      <div className="flex items-center justify-between text-xs text-ink-subtle">
        <span>{label}</span>
        {copied && <span className="font-semibold text-accent-soft">Copied</span>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-ink-primary">{value}</div>
        <button
          type="button"
          disabled={disabled}
          onClick={onCopy}
          className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-semibold transition ${
            disabled ? "cursor-not-allowed border-outline-muted text-ink-muted" : "border-outline-accent text-ink-primary hover:bg-surface-overlay"
          }`}
        >
          <CopyIcon className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
    </div>
  );
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTimeRange(start: Date, end: Date) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function formatDurationHms(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "00:00:00";
  const totalSeconds = Math.round(totalMinutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

