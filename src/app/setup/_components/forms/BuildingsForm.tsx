"use client";

import { useMemo, useState } from "react";

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
      setDrafts([createDraft()]);
      onUpdated();
    },
  });
  const [drafts, setDrafts] = useState<BuildingDraft[]>([createDraft()]);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => status.buildings, [status.buildings]);

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
        <p className="mt-1 text-sm text-white/60">
          Capture every facility abbreviation and the rooms you schedule.
        </p>
      </div>
      {existing.length > 0 ? (
        <div className="space-y-4 rounded-md border border-white/10 bg-black/60 p-4 text-sm">
          <div className="text-xs uppercase text-white/50">Existing</div>
          {existing.map((building) => (
            <div key={building.id}>
              <div className="font-semibold">
                {building.name} <span className="text-white/50">({building.acronym})</span>
              </div>
              <div className="text-white/60">{building.rooms.map((room) => room.roomNumber).join(", ")}</div>
            </div>
          ))}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        {drafts.map((draft, index) => (
          <div key={draft.id} className="rounded-md border border-white/10 bg-black/50 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Building {index + 1}</div>
              {drafts.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((item) => item.id !== draft.id))}
                  className="text-xs text-white/50 hover:text-white"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs uppercase text-white/50">Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, name: e.target.value } : item)))}
                  className="w-full rounded-md border border-white/15 bg-black/60 px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring"
                  placeholder="Ben Hill Griffin"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase text-white/50">Acronym</label>
                <input
                  value={draft.acronym}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, acronym: e.target.value } : item)))
                  }
                  className="w-full rounded-md border border-white/15 bg-black/60 px-3 py-2 text-sm uppercase outline-none ring-emerald-500/50 focus:ring"
                  placeholder="BHG"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs uppercase text-white/50">Rooms</label>
              <div className="flex gap-2">
                <input
                  value={draft.roomField}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, roomField: e.target.value } : item)))
                  }
                  className="flex-1 rounded-md border border-white/15 bg-black/60 px-3 py-2 text-sm outline-none ring-emerald-500/50 focus:ring"
                  placeholder="201"
                />
                <button
                  type="button"
                  onClick={() => addRoom(draft.id)}
                  className="rounded-md border border-emerald-400/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-300 hover:bg-emerald-400/10"
                >
                  Add room
                </button>
              </div>
              {draft.rooms.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {draft.rooms.map((room) => (
                    <span
                      key={room}
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-xs"
                    >
                      {room}
                      <button type="button" className="text-white/60" onClick={() => removeRoom(draft.id, room)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-white/50">Add each room you schedule (e.g., 135, 210A).</p>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDrafts((prev) => [...prev, createDraft()])}
          className="w-full rounded-md border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-white/40"
        >
          + Add another building
        </button>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {mutation.error ? <p className="text-sm text-red-300">{mutation.error.message}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {mutation.isPending ? "Saving..." : "Save buildings"}
        </button>
      </form>
    </div>
  );
}
