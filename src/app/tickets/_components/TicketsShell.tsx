"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, type RouterOutputs } from "~/trpc/react";
import { ChevronDownIcon, ReportIcon, SearchIcon } from "~/app/_components/icons";
import { ZendeskModal } from "./ZendeskModal";

type TicketView = "unassigned" | "assigned" | "all";

type TicketsResponse = RouterOutputs["event"]["tickets"];
type Row = TicketsResponse[number];

function useTicketsData(search: string): TicketsResponse {
  const { data } = api.event.tickets.useQuery({ search, limit: 200 });
  return data ?? [];
}

export function TicketsShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<TicketView>("unassigned");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zendeskOpen, setZendeskOpen] = useState(false);
  const allRows = useTicketsData(search);
  const unassignedRows = useMemo(() => allRows.filter((r) => !r.assigneeProfile), [allRows]);
  const assignedRows = useMemo(() => allRows.filter((r) => !!r.assigneeProfile), [allRows]);
  const rows =
    view === "unassigned" ? unassignedRows : view === "assigned" ? assignedRows : allRows;
  const counts = {
    unassigned: unassignedRows.length,
    assigned: assignedRows.length,
    all: allRows.length,
  };

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const currentLabel = view === "unassigned" ? "Unassigned Tickets" : view === "assigned" ? "Assigned Tickets" : "All Tickets";
  const currentCount = view === "unassigned" ? counts.unassigned : view === "assigned" ? counts.assigned : counts.all;
  const returnTo =
    pathname && pathname !== "/calendar"
      ? `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
      : "";
  const returnParam = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";

  return (
    <div className="flex min-h-screen bg-surface-canvas">
      <aside className="hidden w-64 shrink-0 border-r border-outline-muted bg-surface-muted px-3 py-4 lg:block">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink-primary">
          <ReportIcon className="h-5 w-5 text-accent-soft" />
          Tickets
        </div>
        <nav className="space-y-1 text-sm">
          <NavButton active={view === "unassigned"} count={counts.unassigned} onClick={() => setView("unassigned")} label="Unassigned tickets" />
          <NavButton active={view === "assigned"} count={counts.assigned} onClick={() => setView("assigned")} label="Assigned to agents" />
          <NavButton active={view === "all"} count={counts.all} onClick={() => setView("all")} label="All tickets" />
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-surface-muted">
        <header className="border-b border-outline-muted bg-surface-muted px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Desktop title */}
            <div className="hidden items-center gap-2 text-sm font-semibold text-ink-primary md:flex">
              <span>{currentLabel}</span>
              <span className="font-bold text-ink-primary">{currentCount}</span>
            </div>
            {/* Mobile title dropdown */}
            <div className="md:hidden">
              <MobileViewSwitcher
                value={view}
                onChange={setView}
                label={currentLabel}
                currentCount={currentCount}
                counts={counts}
              />
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <div className="relative">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tickets"
                  className="w-64 rounded-lg border border-outline-muted bg-surface-muted px-8 py-1.5 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
                />
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              </div>
              <button
                type="button"
                className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => setZendeskOpen(true)}
              >
                Zendesk
              </button>
            </div>
          </div>
          {/* Mobile search row */}
          <div className="mt-3 flex items-center gap-2 md:hidden">
            <div className="relative flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-full rounded-full border border-outline-muted bg-surface-muted px-8 py-1.5 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
              />
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            </div>
            <button
              type="button"
              className="rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
              onClick={() => setZendeskOpen(true)}
            >
              Zendesk
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto bg-surface-muted">
            <div className="hidden md:block">
              <TicketTable
                rows={rows}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpen={(row) => {
                  const dateParam = encodeURIComponent(new Date(row.startDatetime).toISOString());
                  const calendarParam = row.calendarId ? `&calendarId=${row.calendarId}` : "";
                  router.push(`/calendar?eventId=${row.id}&date=${dateParam}${calendarParam}${returnParam}`);
                }}
              />
            </div>
            <div className="md:hidden">
              <MobileTicketList
                rows={rows}
                onOpen={(id) => setSelectedId(id)}
                onOpenFull={(row) => {
                  const dateParam = encodeURIComponent(new Date(row.startDatetime).toISOString());
                  const calendarParam = row.calendarId ? `&calendarId=${row.calendarId}` : "";
                  router.push(`/calendar?eventId=${row.id}&date=${dateParam}${calendarParam}${returnParam}`);
                }}
              />
            </div>
          </div>
          <aside className="hidden w-80 shrink-0 border-l border-outline-muted bg-surface-muted xl:block">
            <SidePreview row={selected} />
          </aside>
        </div>
      </section>
      <ZendeskModal open={zendeskOpen} onClose={() => setZendeskOpen(false)} />
    </div>
  );
}

function NavButton({
  active,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  label: string;
  count: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition " +
        (active ? "bg-accent-muted text-ink-primary" : "text-ink-subtle hover:bg-surface-raised")
      }
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="font-bold text-ink-primary">{count}</span>
    </button>
  );
}

function TicketTable({
  rows,
  selectedId,
  onSelect,
  onOpen,
}: {
  rows: Row[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onOpen: (row: Row) => void;
}) {
  return (
    <table className="w-full min-w-full border-collapse text-sm">
      <thead className="bg-surface-muted text-ink-subtle">
        <tr className="border-b border-outline-muted">
          <Th>Ticket status</Th>
          <Th className="hidden md:table-cell">Requested</Th>
          <Th>ID</Th>
          <Th>Subject</Th>
          <Th className="hidden lg:table-cell">Assignee</Th>
          <Th className="hidden md:table-cell">Updated</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const isSelected = row.id === selectedId;
          const updatedAt = row.updatedAt ?? row.createdAt;
          const ticketCode = row.eventCode ?? String(row.id).padStart(7, "0");
          const zebra = idx % 2 === 0 ? "bg-surface-overlay" : "bg-surface-sunken";
          return (
            <tr
              key={row.id}
              className={`${zebra} cursor-pointer transition hover:bg-surface-raised ${isSelected ? "bg-accent-muted/30" : ""}`}
              onClick={() => onSelect(row.id)}
              onDoubleClick={() => onOpen(row)}
            >
              <Td>
                <StatusPill row={row} />
              </Td>
              <Td className="hidden md:table-cell">{formatDate(row.startDatetime)}</Td>
              <Td>#{ticketCode}</Td>
              <Td className="max-w-[16rem] truncate text-ink-primary md:max-w-[24rem] lg:max-w-[28rem]">{row.title}</Td>
              <Td className="hidden text-ink-subtle lg:table-cell">{row.assigneeProfile ? formatName(row.assigneeProfile) : "Unassigned"}</Td>
              <Td className="hidden text-ink-subtle md:table-cell">{formatRelative(updatedAt)}</Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ row }: { row: Row }) {
  const now = Date.now();
  const end = new Date(row.endDatetime).getTime();
  const assigned = !!row.assigneeProfile;
  const label = end < now ? "Closed" : assigned ? "Assigned" : "Open";
  const cls =
    label === "Closed"
      ? "border-status-success bg-status-success-surface text-status-success"
      : assigned
        ? "border-outline-accent bg-accent-muted text-accent-soft"
        : "border-outline-muted bg-surface-raised text-ink-subtle";
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function SidePreview({ row }: { row: Row | null }) {
  if (!row) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        Select a ticket to preview
      </div>
    );
  }
  const start = new Date(row.startDatetime);
  const end = new Date(row.endDatetime);
  const ticketCode = row.eventCode ?? String(row.id).padStart(7, "0");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-outline-muted bg-surface-muted px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-status-success">Preview</div>
        <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink-primary">{row.title}</div>
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div className="rounded-lg border border-outline-muted bg-surface-raised p-3 text-ink-subtle">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Ticket ID #{ticketCode}</div>
          <div>{formatDate(start)}</div>
          <div>{formatTimeRange(start, end)}</div>
          {row.location && <div className="mt-1 text-xs uppercase tracking-wide">{row.location}</div>}
          {row.assigneeProfile && (
            <div className="mt-2 text-xs">Assigned to <span className="font-medium text-ink-primary">{formatName(row.assigneeProfile)}</span></div>
          )}
          {row.totalLoggedMinutes > 0 && (
            <div className="mt-1 text-xs">Logged <span className="font-semibold text-ink-primary">{(row.totalLoggedMinutes / 60).toFixed(2)}h</span></div>
          )}
        </div>
        {row.description && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">At a glance</div>
            <p className="mt-1 line-clamp-6 whitespace-pre-line text-ink-subtle">{row.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MobileViewSwitcher({
  value,
  onChange,
  label,
  currentCount,
  counts,
}: {
  value: TicketView;
  onChange: (v: TicketView) => void;
  label: string;
  currentCount: number;
  counts: { unassigned: number; assigned: number; all: number };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const options: { value: TicketView; label: string; count: number }[] = [
    { value: "unassigned", label: "Unassigned Tickets", count: counts.unassigned },
    { value: "assigned", label: "Assigned Tickets", count: counts.assigned },
    { value: "all", label: "All Tickets", count: counts.all },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-primary hover:text-accent-soft"
        onClick={() => setOpen((p) => !p)}
      >
        <span>{label}</span>
        <span className="font-bold text-ink-primary">{currentCount}</span>
        <ChevronDownIcon className="h-4 w-4 text-ink-muted" />
      </button>
      {open && (
        <div className="absolute left-0 right-auto z-40 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-outline-muted bg-surface-raised shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`block w-full px-3 py-2 text-left text-sm ${
                value === opt.value ? "bg-accent-muted text-ink-primary" : "text-ink-subtle hover:bg-surface-raised"
              }`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <div className="flex items-center justify-between">
                <span>{opt.label}</span>
                <span className="font-bold text-ink-primary">{opt.count}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileTicketList({
  rows,
  onOpen,
  onOpenFull,
}: {
  rows: Row[];
  onOpen: (id: number) => void;
  onOpenFull: (row: Row) => void;
}) {
  const lastTapRef = useRef(0);
  return (
    <ul className="divide-y divide-outline-muted">
      {rows.map((row, idx) => {
        const firstName = row.assigneeProfile?.firstName?.trim();
        const title = row.title?.trim();
        const letterSource = firstName && firstName.length > 0 ? firstName : title && title.length > 0 ? title : "?";
        const letter = letterSource.charAt(0).toUpperCase();
        const date = new Date(row.startDatetime);
        const dateLabel = `${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")}`;
        const snippet = row.description ? String(row.description).slice(0, 120) : row.location ?? "";
        const ticketCode = row.eventCode ?? String(row.id).padStart(7, "0");
        return (
          <li
            key={row.id}
            className={`${idx % 2 === 0 ? "bg-surface-overlay" : "bg-surface-sunken"} px-3 py-3`}
            onClick={() => onOpen(row.id)}
            onTouchEnd={() => {
              const now = Date.now();
              if (now - lastTapRef.current < 350) {
                onOpenFull(row);
              }
              lastTapRef.current = now;
            }}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-xs font-bold text-ink-subtle">
                {letter}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-xs text-ink-subtle">
                  <div>
                    <span className="font-medium text-ink-muted">#{ticketCode}</span>
                    {row.assigneeProfile && (
                      <span> - {formatName(row.assigneeProfile)}</span>
                    )}
                  </div>
                  <div className="ml-2 whitespace-nowrap">{dateLabel}</div>
                </div>
                <div className="mt-0.5 truncate text-base font-semibold text-ink-primary">{row.title}</div>
                {snippet && <div className="mt-0.5 line-clamp-1 text-sm text-ink-subtle">{snippet}</div>}
              </div>
              <div className="ml-2 flex-shrink-0">
                <StatusPill row={row} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function formatName(p: { firstName: string; lastName: string; email: string }) {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return full.length > 0 ? full : p.email;
}
function formatDate(input: string | Date) {
  const d = new Date(input);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function formatTimeRange(start: Date, end: Date) {
  const f = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${f.format(start)} - ${f.format(end)}`;
}
function formatRelative(input: string | Date) {
  const d = new Date(input).getTime();
  const diff = Math.max(0, Date.now() - d);
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}
