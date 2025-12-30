"use client";

import { useEffect, useState } from "react";

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

const createDraftFromExisting = (dept: DepartmentTreeNode): DepartmentDraft => ({
  id: String(dept.id),
  name: dept.name ?? "",
  divisions: dept.children.map((child) => child.name),
  divisionField: "",
});

export function DepartmentsForm({ status, onUpdated }: { status: SetupStatusData; onUpdated: () => void }) {
  const createMutation = api.setup.createDepartments.useMutation({
    onSuccess: () => {
      setHasLocalChanges(false);
      onUpdated();
    },
  });
  const updateMutation = api.setup.updateDepartments.useMutation({
    onSuccess: () => {
      setHasLocalChanges(false);
      onUpdated();
    },
  });

  const [drafts, setDrafts] = useState<DepartmentDraft[]>(() =>
    status.departments.roots.length > 0 ? status.departments.roots.map(createDraftFromExisting) : [createDraft()],
  );
  const [error, setError] = useState<string | null>(null);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);

  useEffect(() => {
    if (status.departments.roots.length > 0 && !hasLocalChanges) {
      setDrafts(status.departments.roots.map(createDraftFromExisting));
    } else if (drafts.length === 0) {
      setDrafts([createDraft()]);
    }
  }, [status.departments.roots, drafts.length, hasLocalChanges]);

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
    setHasLocalChanges(true);
  };

  const removeDivision = (id: string, name: string) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft;
        return { ...draft, divisions: draft.divisions.filter((value) => value !== name) };
      }),
    );
    setHasLocalChanges(true);
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
    if (status.departments.roots.length > 0) {
      await updateMutation.mutateAsync({ departments: payload });
    } else {
      await createMutation.mutateAsync({ departments: payload });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Departments & divisions</h2>
        <p className="mt-1 text-sm text-ink-muted">Model reporting lines so calendars inherit permissions.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        {drafts.map((draft, index) => (
          <div key={draft.id} className="rounded-md border border-outline-muted bg-surface-muted p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Department {index + 1}</div>
              {drafts.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
                    setHasLocalChanges(true);
                  }}
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
                onChange={(e) => {
                  setDrafts((prev) =>
                    prev.map((item) => (item.id === draft.id ? { ...item, name: e.target.value } : item)),
                  );
                  setHasLocalChanges(true);
                }}
                className="w-full rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
                placeholder="Event Production"
              />
            </div>
            <div className="mt-4">
              <label className="mb-1 block text-xs uppercase text-ink-subtle">Divisions (optional)</label>
              <div className="flex gap-2">
                <input
                  value={draft.divisionField}
                  onChange={(e) => {
                    setDrafts((prev) =>
                      prev.map((item) => (item.id === draft.id ? { ...item, divisionField: e.target.value } : item)),
                    );
                    setHasLocalChanges(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addDivision(draft.id);
                    }
                  }}
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
                    <span
                      key={division}
                      className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-raised px-3 py-1"
                    >
                      {division}
                      <button
                        type="button"
                        onClick={() => removeDivision(draft.id, division)}
                        className="text-ink-subtle"
                      >
                        x
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
          onClick={() => {
            setDrafts((prev) => [...prev, createDraft()]);
            setHasLocalChanges(true);
          }}
          className="w-full rounded-md border border-outline-muted px-4 py-2 text-sm text-ink-muted hover:border-outline-strong"
        >
          + Add another department
        </button>
        {error ? <p className="text-sm text-status-danger">{error}</p> : null}
        {createMutation.error ? <p className="text-sm text-status-danger">{createMutation.error.message}</p> : null}
        {updateMutation.error ? <p className="text-sm text-status-danger">{updateMutation.error.message}</p> : null}
        <button
          type="submit"
          disabled={createMutation.isPending || updateMutation.isPending}
          className="rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:opacity-60"
        >
          {createMutation.isPending || updateMutation.isPending
            ? "Saving..."
            : status.departments.roots.length > 0
              ? "Update departments"
              : "Save departments"}
        </button>
      </form>
    </div>
  );
}
