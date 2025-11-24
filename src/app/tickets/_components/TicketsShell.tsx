"use client";

import { useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { ReportIcon, SearchIcon } from "~/app/_components/icons";

type TicketView = "unassigned" | "assigned" | "all";

type Row = ReturnType<typeof useTicketsData>[number];

function useTicketsData(view: TicketView, search: string) {
  const assigned = view === "all" ? undefined : view === "assigned";
  const { data } = api.event.tickets.useQuery({ assigned, search, limit: 200 });
  return data ?? [];
}

export function TicketsShell() {
  const [view, setView] = useState<TicketView>("unassigned");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const rows = useTicketsData(view, search);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-outline-muted bg-surface-sunken/40 px-3 py-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink-primary">
          <ReportIcon className="h-5 w-5 text-accent-soft" />
          Tickets
        </div>
        <nav className="space-y-1 text-sm">
          <NavButton active={view === "unassigned"} onClick={() => setView("unassigned")}>Unassigned tickets</NavButton>
          <NavButton active={view === "assigned"} onClick={() => setView("assigned")}>Assigned to agents</NavButton>
          <NavButton active={view === "all"} onClick={() => setView("all")}>All tickets</NavButton>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-outline-muted bg-surface-overlay/60 px-5 py-3">
          <div className="text-sm font-semibold text-ink-primary">
            {view === "unassigned" ? "Unassigned Tickets Open" : view === "assigned" ? "Assigned Tickets" : "All Tickets"}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tickets"
                className="w-64 rounded-lg border border-outline-muted bg-surface-muted px-8 py-1.5 text-sm text-ink-primary outline-none placeholder:text-ink-faint"
              />
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto">
            <TicketTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <aside className="w-80 shrink-0 border-l border-outline-muted bg-surface-raised/80 backdrop-blur">
            <SidePreview row={selected} />
          </aside>
        </div>
      </section>
    </div>
  );
}

function NavButton({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition " +
        (active ? "bg-accent-muted text-ink-primary" : "text-ink-subtle hover:bg-surface-muted")
      }
      onClick={onClick}
    >
      <span>{children}</span>
    </button>
  );
}

function TicketTable({ rows, selectedId, onSelect }: { rows: any[]; selectedId: number | null; onSelect: (id: number) => void }) {
  return (
    <table className="w-full min-w-full border-collapse text-sm">
      <thead className="bg-surface-overlay/60 text-ink-subtle">
        <tr className="border-b border-outline-muted">
          <Th>Ticket status</Th>
          <Th>Requested</Th>
          <Th>ID</Th>
          <Th>Subject</Th>
          <Th>Assignee</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const isSelected = row.id === selectedId;
          const updatedAt = row.updatedAt ?? row.createdAt;
          const zebra = idx % 2 === 0 ? "bg-surface-sunken/40" : "bg-surface-muted/40";
          return (
            <tr
              key={row.id}
              className={`${zebra} cursor-pointer transition hover:bg-surface-muted ${isSelected ? "bg-accent-muted/40" : ""}`}
              onClick={() => onSelect(row.id)}
            >
              <Td>
                <StatusPill row={row} />
              </Td>
              <Td>{formatDate(row.startDatetime)}</Td>
              <Td>#{row.id}</Td>
              <Td className="max-w-[28rem] truncate text-ink-primary">{row.title}</Td>
              <Td className="text-ink-subtle">{row.assigneeProfile ? formatName(row.assigneeProfile) : "—"}</Td>
              <Td className="text-ink-subtle">{formatRelative(updatedAt)}</Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ row }: { row: any }) {
  const now = Date.now();
  const end = new Date(row.endDatetime).getTime();
  const assigned = !!row.assigneeProfile;
  const label = end < now ? "Closed" : assigned ? "Assigned" : "Open";
  const cls =
    label === "Closed"
      ? "border-status-success bg-status-success-surface text-status-success"
      : assigned
        ? "border-outline-accent bg-accent-muted text-accent-soft"
        : "border-outline-muted bg-surface-muted text-ink-subtle";
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function SidePreview({ row }: { row: any | null }) {
  if (!row) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        Select a ticket to preview
      </div>
    );
  }
  const start = new Date(row.startDatetime);
  const end = new Date(row.endDatetime);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-outline-muted bg-surface-overlay px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-status-success">Preview</div>
        <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink-primary">{row.title}</div>
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div className="rounded-lg border border-outline-muted bg-surface-muted p-3 text-ink-subtle">
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function formatName(p: { firstName: string; lastName: string; email: string }) {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  return full || p.email;
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
