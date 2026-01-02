"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { SearchIcon } from "./icons";

type GlobalSearchProps = {
  enabled: boolean;
};

export function GlobalSearch({ enabled }: GlobalSearchProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [value, setValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isExpanded = expanded || value.length > 0;

  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    }
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) {
      setSearchQuery("");
      return;
    }
    const handle = setTimeout(() => {
      setSearchQuery(value.trim());
    }, 250);
    return () => clearTimeout(handle);
  }, [value, isExpanded]);

  const ticketsQuery = api.event.tickets.useQuery(
    { search: searchQuery, limit: 6 },
    { enabled: isExpanded && searchQuery.length > 0 },
  );

  if (!enabled) return null;

  const openTicket = (result: { id: number }) => {
    setValue("");
    setExpanded(false);
    router.push(`/calendar?eventId=${result.id}`);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = value.trim();
    if (!query) {
      setError("Enter a ticket identifier");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await utils.client.event.findByIdentifier.query({ identifier: query });
      if (!result) {
        setError("Ticket not found");
        return;
      }
      openTicket(result);
    } catch (searchError) {
      console.error(searchError);
      setError("Search failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <header className="sticky top-0 z-[9999] border-b border-outline-muted bg-surface-canvas/90 px-4 py-2 backdrop-blur">
      <div className="flex w-full items-center justify-end">
        <form className="flex flex-col items-end gap-1" onSubmit={handleSubmit}>
          <div className="relative">
            <div
              className={
                "flex h-10 items-center overflow-hidden rounded-full transition-all duration-300 ease-out " +
                (isExpanded
                  ? "w-[320px] border border-outline-muted bg-surface-base shadow-inner sm:w-[380px]"
                  : "w-10 border border-transparent bg-transparent shadow-none")
              }
            >
              <button
                type="button"
                aria-label="Open search"
                className="flex h-10 w-10 items-center justify-center text-ink-muted transition hover:text-ink-primary"
                onClick={() => setExpanded(true)}
              >
                <SearchIcon className="h-5 w-5" />
              </button>
              <input
                ref={inputRef}
                type="text"
                className={
                  "h-full flex-1 bg-transparent pr-2 text-sm text-ink-primary outline-none transition-all duration-200 " +
                  (isExpanded ? "opacity-100" : "pointer-events-none opacity-0")
                }
                placeholder="Search ticket ID, event code, or Zendesk #"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !value) {
                    setExpanded(false);
                  }
                }}
                onBlur={(event) => {
                  const next = event.relatedTarget as HTMLElement | null;
                  if (next?.dataset.searchSubmit === "true") return;
                  if (value.trim().length === 0) {
                    setExpanded(false);
                  }
                }}
                aria-label="Search tickets"
              />
              <button
                type="submit"
                data-search-submit="true"
                className={
                  "h-full rounded-r-full bg-accent-strong px-3 text-sm font-medium leading-none text-ink-inverted transition " +
                  (isExpanded ? "opacity-100" : "pointer-events-none opacity-0")
                }
                disabled={pending}
              >
                Go
              </button>
            </div>
            {isExpanded && searchQuery.length > 0 ? (
              <div className="absolute right-0 z-[999] mt-2 w-[320px] overflow-hidden rounded-lg border border-outline-muted bg-surface-raised shadow-[var(--shadow-pane)] sm:w-[380px]">
                <div className="max-h-64 overflow-auto bg-surface-raised">
                  {ticketsQuery.isLoading ? (
                    <div className="px-3 py-2 text-sm text-ink-muted">Searching...</div>
                  ) : ticketsQuery.data && ticketsQuery.data.length > 0 ? (
                    ticketsQuery.data.map((ticket) => (
                      <button
                        key={ticket.id}
                        type="button"
                        data-search-submit="true"
                        onClick={() => openTicket(ticket)}
                        className="flex w-full flex-col gap-1 bg-surface-base px-3 py-2 text-left text-sm text-ink-primary transition hover:bg-surface-muted"
                      >
                        <span className="font-medium">{ticket.title}</span>
                        <span className="text-xs text-ink-subtle">
                          {ticket.eventCode ? `Event ${ticket.eventCode}` : `Ticket ${ticket.id}`}
                          {ticket.zendeskTicketNumber ? ` · Zendesk ${ticket.zendeskTicketNumber}` : ""}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-ink-muted">No tickets found.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <p
            className={
              "text-xs transition-all duration-200 " +
              (isExpanded ? "max-h-6 opacity-100" : "max-h-0 opacity-0") +
              " " +
              (error ? "text-status-danger" : "text-ink-subtle")
            }
          >
            {error ?? "Enter ticket ID, event code, or Zendesk #"}
          </p>
        </form>
      </div>
    </header>
  );
}
