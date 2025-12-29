"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";

type BuildingDraft = {
  id: string;
  name: string;
  acronym: string;
  rooms: string[];
  roomField: string;
};

function createDraft(): BuildingDraft {
  return { id: crypto.randomUUID(), name: "", acronym: "", rooms: [], roomField: "" };
}

export function BuildingsForm({ status, onUpdated }: { status: SetupStatusData; onUpdated: () => void }) {
  const mutation = api.setup.createBuildings.useMutation({
    onSuccess: () => {
      setDrafts([]);
      onUpdated();
    },
  });
  const [drafts, setDrafts] = useState<BuildingDraft[]>(() =>
    status.buildings.length > 0 ? [] : [createDraft()],
  );
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => status.buildings, [status.buildings]);
  const prevExistingCount = useRef(existing.length);

  useEffect(() => {
    if (prevExistingCount.current === 0 && existing.length > 0) {
      setDrafts([]);
    } else if (existing.length === 0 && drafts.length === 0) {
      setDrafts([createDraft()]);
    }
    prevExistingCount.current = existing.length;
  }, [drafts.length, existing.length]);

  const addRoom = (id: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft;
        const room = draft.roomField.trim();
        if (!room) return draft;
        if (draft.rooms.includes(room)) {
          return { ...draft, roomField: "" };
        }
        return { ...draft, rooms: [...draft.rooms, room], roomField: "" };
      }),
    );
  };

  const removeRoom = (id: string, room: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft;
        return { ...draft, rooms: draft.rooms.filter((value) => value !== room) };
      }),
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload = drafts
      .map((draft) => ({
        name: draft.name.trim(),
        acronym: draft.acronym.trim(),
        rooms: draft.rooms,
      }))
      .filter((draft) => draft.name && draft.acronym && draft.rooms.length > 0);
    if (payload.length === 0) {
      setError("Add at least one building with room numbers.");
      return;
    }
    await mutation.mutateAsync({ buildings: payload });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Buildings & rooms</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Capture every facility abbreviation and the rooms you schedule.
        </p>
      </div>
      {existing.length > 0 ? (
        <div className="space-y-4 rounded-md border border-outline-muted bg-surface-muted p-4 text-sm">
          <div className="text-xs uppercase text-ink-subtle">Existing</div>
          {existing.map((building) => (
            <div key={building.id}>
              <div className="font-semibold">
                {building.name} <span className="text-ink-subtle">({building.acronym})</span>
              </div>
              <div className="text-ink-muted">{building.rooms.map((room) => room.roomNumber).join(", ")}</div>
            </div>
          ))}
        </div>
      ) : null}
      {drafts.length === 0 ? (
        <button
          type="button"
          onClick={() => setDrafts([createDraft()])}
          className="w-full rounded-md border border-outline-muted px-4 py-2 text-sm text-ink-muted hover:border-outline-strong"
        >
          + Add another building
        </button>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
        {drafts.map((draft, index) => (
          <div key={draft.id} className="rounded-md border border-outline-muted bg-surface-muted p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Building {index + 1}</div>
              {drafts.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((item) => item.id !== draft.id))}
                  className="text-xs text-ink-subtle hover:text-ink-primary"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs uppercase text-ink-subtle">Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, name: e.target.value } : item)))}
                  className="w-full rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
                  placeholder="Ben Hill Griffin"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase text-ink-subtle">Acronym</label>
                <input
                  value={draft.acronym}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, acronym: e.target.value } : item)))
                  }
                  className="w-full rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm uppercase outline-none ring-accent-default/40 focus:ring"
                  placeholder="BHG"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs uppercase text-ink-subtle">Rooms</label>
              <div className="flex gap-2">
                <input
                  value={draft.roomField}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, roomField: e.target.value } : item)))
                  }
                  className="flex-1 rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
                  placeholder="201"
                />
                <button
                  type="button"
                  onClick={() => addRoom(draft.id)}
                  className="rounded-md border border-outline-accent px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-primary hover:bg-accent-muted"
                >
                  Add room
                </button>
              </div>
              {draft.rooms.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {draft.rooms.map((room) => (
                    <span
                      key={room}
                      className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-raised px-3 py-1 text-xs"
                    >
                      {room}
                      <button type="button" className="text-ink-subtle" onClick={() => removeRoom(draft.id, room)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-subtle">Add each room you schedule (e.g., 135, 210A).</p>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDrafts((prev) => [...prev, createDraft()])}
          className="w-full rounded-md border border-outline-muted px-4 py-2 text-sm text-ink-muted hover:border-outline-strong"
        >
          + Add another building
        </button>
        {error ? <p className="text-sm text-status-danger">{error}</p> : null}
        {mutation.error ? <p className="text-sm text-status-danger">{mutation.error.message}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:opacity-60"
        >
          {mutation.isPending ? "Saving..." : "Save buildings"}
        </button>
        </form>
      )}
    </div>
  );
}
