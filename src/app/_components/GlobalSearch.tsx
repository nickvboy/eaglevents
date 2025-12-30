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

  if (!enabled) return null;

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
      const params = new URLSearchParams({
        eventId: String(result.id),
        date: result.startDatetime.toISOString(),
        calendarId: String(result.calendarId),
      });
      setValue("");
      router.push(`/calendar?${params.toString()}`);
    } catch (searchError) {
      console.error(searchError);
      setError("Search failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-outline-muted bg-surface-canvas/90 px-4 py-2 backdrop-blur">
      <div className="flex w-full items-center justify-end">
        <form className="flex flex-col items-end gap-1" onSubmit={handleSubmit}>
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
