"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";

type DepartmentTreeNode = SetupStatusData["departments"]["roots"][number];

type DepartmentDraft = {
  id: string;
  name: string;
  divisions: string[];
  divisionField: string;
};

const createDraft = (): DepartmentDraft => ({
  id: crypto.randomUUID(),
  name: "",
  divisions: [],
  divisionField: "",
});

export function DepartmentsForm({ status, onUpdated }: { status: SetupStatusData; onUpdated: () => void }) {
  const mutation = api.setup.createDepartments.useMutation({
    onSuccess: () => {
      setDrafts([createDraft()]);
      onUpdated();
    },
  });

  const [drafts, setDrafts] = useState<DepartmentDraft[]>([createDraft()]);
  const [error, setError] = useState<string | null>(null);

  const addDivision = (id: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft;
        const division = draft.divisionField.trim();
        if (division.length < 2) return draft;
        if (draft.divisions.includes(division)) return { ...draft, divisionField: "" };
        return { ...draft, divisions: [...draft.divisions, division], divisionField: "" };
      }),
    );
  };

  const removeDivision = (id: string, name: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft;
        return { ...draft, divisions: draft.divisions.filter((value) => value !== name) };
      }),
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload = drafts
      .map((draft) => ({
        name: draft.name.trim(),
        divisions: draft.divisions.map((name) => ({ name: name.trim() })).filter((div) => div.name.length >= 2),
      }))
      .filter((draft) => draft.name.length >= 2);
    if (payload.length === 0) {
      setError("Add at least one department with a name of at least 2 characters.");
      return;
    }
    await mutation.mutateAsync({ departments: payload });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Departments & divisions</h2>
        <p className="mt-1 text-sm text-ink-muted">Model reporting lines so calendars inherit permissions.</p>
      </div>
      {status.departments.roots.length > 0 ? (
        <div className="rounded-md border border-outline-muted bg-surface-muted p-4 text-sm">
          <div className="text-xs uppercase text-ink-subtle">Existing</div>
          <div className="mt-2 space-y-3">
            {status.departments.roots.map((dept: DepartmentTreeNode) => (
              <div key={dept.id}>
                <div className="font-semibold">{dept.name}</div>
                {dept.children.length > 0 ? (
                  <div className="mt-1 text-ink-muted">
                    Divisions: {dept.children.map((child: DepartmentTreeNode) => child.name).join(", ")}
                  </div>
                ) : (
                  <div className="text-ink-subtle">No divisions yet</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        {drafts.map((draft, index) => (
          <div key={draft.id} className="rounded-md border border-outline-muted bg-surface-muted p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Department {index + 1}</div>
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
            <div className="mt-3">
              <label className="mb-1 block text-xs uppercase text-ink-subtle">Name</label>
              <input
                value={draft.name}
                onChange={(e) =>
                  setDrafts((prev) => prev.map((item) => (item.id === draft.id ? { ...item, name: e.target.value } : item)))
                }
                className="w-full rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
                placeholder="Event Production"
              />
            </div>
            <div className="mt-4">
              <label className="mb-1 block text-xs uppercase text-ink-subtle">Divisions (optional)</label>
              <div className="flex gap-2">
                <input
                  value={draft.divisionField}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((item) => (item.id === draft.id ? { ...item, divisionField: e.target.value } : item)),
                    )
                  }
                  className="flex-1 rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
                  placeholder="Broadcast Ops"
                />
                <button
                  type="button"
                  onClick={() => addDivision(draft.id)}
                  className="rounded-md border border-outline-accent px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-primary hover:bg-accent-muted"
                >
                  Add division
                </button>
              </div>
              {draft.divisions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {draft.divisions.map((division) => (
                    <span key={division} className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-raised px-3 py-1">
                      {division}
                      <button type="button" onClick={() => removeDivision(draft.id, division)} className="text-ink-subtle">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-subtle">Divisions inherit their parent department.</p>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDrafts((prev) => [...prev, createDraft()])}
          className="w-full rounded-md border border-outline-muted px-4 py-2 text-sm text-ink-muted hover:border-outline-strong"
        >
          + Add another department
        </button>
        {error ? <p className="text-sm text-status-danger">{error}</p> : null}
        {mutation.error ? <p className="text-sm text-status-danger">{mutation.error.message}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:opacity-60"
        >
          {mutation.isPending ? "Saving..." : "Save departments"}
        </button>
      </form>
    </div>
  );
}
