"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "~/trpc/react";
import { SearchIcon } from "./icons";

type GlobalSearchProps = {
  enabled: boolean;
};

export function GlobalSearch({ enabled }: GlobalSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const utils = api.useUtils();
  const [value, setValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const isExpanded = expanded || value.length > 0;

  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus();
    }
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) {
      setSearchQuery("");
      setError(null);
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
  const ticketResults = ticketsQuery.data ?? [];

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery, ticketResults.length]);

  useEffect(() => {
    if (highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (!enabled) return null;

  const openTicket = (result: { id: number }) => {
    setValue("");
    setExpanded(false);
    const returnTo =
      pathname && pathname !== "/calendar"
        ? `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
        : "";
    const returnParam = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
    router.push(`/calendar?eventId=${result.id}${returnParam}`);
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
    <header
      className={
        "sticky top-0 z-[9999] flex h-16 items-start border-b border-outline-muted bg-surface-canvas/90 px-4 pt-2 backdrop-blur"
      }
    >
      <div className="flex w-full items-start justify-end">
        <form className="flex flex-col items-end" onSubmit={handleSubmit}>
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
                  if (event.key === "ArrowDown") {
                    if (ticketResults.length === 0) return;
                    event.preventDefault();
                    setHighlightedIndex((prev) =>
                      Math.min(prev + 1, ticketResults.length - 1),
                    );
                  } else if (event.key === "ArrowUp") {
                    if (ticketResults.length === 0) return;
                    event.preventDefault();
                    setHighlightedIndex((prev) =>
                      prev < 0 ? ticketResults.length - 1 : Math.max(prev - 1, 0),
                    );
                  } else if (event.key === "Enter") {
                    if (
                      highlightedIndex >= 0 &&
                      highlightedIndex < ticketResults.length
                    ) {
                      event.preventDefault();
                      openTicket(ticketResults[highlightedIndex]!);
                    }
                  } else if (event.key === "Escape" && !value) {
                    setExpanded(false);
                  } else if (event.key === "Escape") {
                    setHighlightedIndex(-1);
                  }
                }}
                onBlur={(event) => {
                  const next = event.relatedTarget as HTMLElement | null;
                  if (next?.dataset.searchSubmit === "true") return;
                  if (value.trim().length === 0) {
                    setExpanded(false);
                  }
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isExpanded && searchQuery.length > 0}
                aria-controls={listboxId}
                aria-activedescendant={
                  highlightedIndex >= 0
                    ? `${listboxId}-${highlightedIndex}`
                    : undefined
                }
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
              <div
                id={listboxId}
                role="listbox"
                className="absolute right-0 z-[999] mt-2 w-[320px] overflow-hidden rounded-lg border border-outline-muted bg-surface-raised shadow-[var(--shadow-pane)] sm:w-[380px]"
              >
                <div className="max-h-64 overflow-auto bg-surface-raised">
                  {ticketsQuery.isLoading ? (
                    <div className="px-3 py-2 text-sm text-ink-muted">Searching...</div>
                  ) : ticketResults.length > 0 ? (
                    ticketResults.map((ticket, index) => (
                      <button
                        key={ticket.id}
                        type="button"
                        id={`${listboxId}-${index}`}
                        role="option"
                        aria-selected={index === highlightedIndex}
                        data-search-submit="true"
                        ref={(node) => {
                          optionRefs.current[index] = node;
                        }}
                        onClick={() => openTicket(ticket)}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={
                          "flex w-full flex-col gap-1 bg-surface-base px-3 py-2 text-left text-sm text-ink-primary transition " +
                          (index === highlightedIndex
                            ? "bg-surface-muted"
                            : "hover:bg-surface-muted")
                        }
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
        </form>
      </div>
    </header>
  );
}
