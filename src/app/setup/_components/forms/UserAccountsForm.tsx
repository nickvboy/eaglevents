"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type RouterOutputs } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";

type ScopeOption = {
  label: string;
  scopeType: "business" | "department" | "division";
  scopeId: number;
};

type DepartmentFlatNode = SetupStatusData["departments"]["flat"][number];

type AssignmentDraft = {
  id: string;
  scopeType: ScopeOption["scopeType"];
  scopeId: number;
  roleType: "admin" | "co_admin" | "manager" | "employee";
};

type Credential = { identifier: string; password: string };
type GeneratedDefaultUser = RouterOutputs["setup"]["createDefaultUsers"]["generatedUsers"][number];

const roleLabels: Record<AssignmentDraft["roleType"], string> = {
  admin: "Admin",
  co_admin: "Co-admin",
  manager: "Manager",
  employee: "Employee",
};

const PHONE_DIGIT_LIMIT = 10;

const extractPhoneDigits = (value: string) => value.replace(/\D/g, "").slice(0, PHONE_DIGIT_LIMIT);

const formatPhone = (value: string) => {
  const digits = extractPhoneDigits(value);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export function UserAccountsForm({
  status,
  onUpdated,
  onRememberCredential,
  rememberedCredential,
}: {
  status: SetupStatusData;
  onUpdated: () => void;
  onRememberCredential: (credentials: Credential | null) => void;
  rememberedCredential: Credential | null;
}) {
  const scopeOptions = useMemo<ScopeOption[]>(() => {
    if (!status.business) return [];
    const base: ScopeOption[] = [
      { label: `${status.business.name} (Business)`, scopeType: "business", scopeId: status.business.id },
    ];
    status.departments.flat.forEach((dept: DepartmentFlatNode) => {
      if (dept.parentDepartmentId === null) {
        base.push({ label: `${dept.name} (Department)`, scopeType: "department", scopeId: dept.id });
      } else {
        base.push({ label: `${dept.name} (Division)`, scopeType: "division", scopeId: dept.id });
      }
    });
    return base;
  }, [status.business, status.departments.flat]);

  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const createEmptyForm = () => ({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    username: "",
    password: "",
    dateOfBirth: "",
    assignments: [] as AssignmentDraft[],
    rememberForLogin: false,
  });
  const [form, setForm] = useState(createEmptyForm);
  const [generatedDefaults, setGeneratedDefaults] = useState<GeneratedDefaultUser[]>([]);

  useEffect(() => {
    if (scopeOptions.length === 0 || editingUserId) return;
    setForm((prev) => {
      if (prev.assignments.length > 0) return prev;
      return {
        ...prev,
        assignments: [
          {
            id: crypto.randomUUID(),
            scopeType: scopeOptions[0]!.scopeType,
            scopeId: scopeOptions[0]!.scopeId,
            roleType: "admin",
          },
        ],
      };
    });
  }, [scopeOptions, editingUserId]);

  const mutation = api.setup.createUsersWithRoles.useMutation({
    onSuccess: () => {
      onUpdated();
      setEditingUserId(null);
      setForm(() => {
        const base = createEmptyForm();
        return {
          ...base,
          assignments:
            scopeOptions.length > 0
              ? [
                  {
                    id: crypto.randomUUID(),
                    scopeType: scopeOptions[0]!.scopeType,
                    scopeId: scopeOptions[0]!.scopeId,
                    roleType: "admin",
                  },
                ]
              : [],
        };
      });
    },
  });

  const updateMutation = api.setup.updateUserWithRoles.useMutation({
    onSuccess: () => {
      onUpdated();
      setEditingUserId(null);
      setForm(() => {
        const base = createEmptyForm();
        return {
          ...base,
          assignments:
            scopeOptions.length > 0
              ? [
                  {
                    id: crypto.randomUUID(),
                    scopeType: scopeOptions[0]!.scopeType,
                    scopeId: scopeOptions[0]!.scopeId,
                    roleType: "admin",
                  },
                ]
              : [],
        };
      });
    },
  });

  const createDefaultUsersMutation = api.setup.createDefaultUsers.useMutation({
    onSuccess: (data) => {
      onUpdated();
      if (data) {
        setGeneratedDefaults(data.generatedUsers);
      }
    },
  });

  const clearAccountsMutation = api.setup.clearAllAccounts.useMutation({
    onSuccess: () => {
      onUpdated();
      onRememberCredential(null);
      setGeneratedDefaults([]);
    },
  });

  const groupedRoles = useMemo(() => {
    const map = new Map<string, { key: string; label: string; entries: string[] }>();
    scopeOptions.forEach((option) => {
      const key = `${option.scopeType}:${option.scopeId}`;
      map.set(key, { key, label: option.label, entries: [] });
    });
    status.roles.forEach((role) => {
      const key = `${role.scopeType}:${role.scopeId}`;
      const entry = role.user
        ? `${role.user.displayName || role.user.username} (${roleLabels[role.roleType]})`
        : `${role.roleType}`;
      if (!map.has(key)) {
        map.set(key, { key, label: role.scopeLabel, entries: [entry] });
      } else {
        map.get(key)!.entries.push(entry);
      }
    });
    return Array.from(map.values());
  }, [scopeOptions, status.roles]);

  const existingUsers = useMemo(() => {
    const map = new Map<number, { userId: number; displayName: string; username: string; email: string; profile: { firstName: string; lastName: string; email: string; phoneNumber: string; dateOfBirth: string | null }; assignments: AssignmentDraft[] }>();
    status.roles.forEach((role) => {
      if (!role.user) return;
      const entry =
        map.get(role.user.id) ??
        (() => {
          const created = {
            userId: role.user.id,
            displayName: role.user.displayName ?? role.user.username,
            username: role.user.username,
            email: role.user.email,
            profile: {
              firstName: role.profile?.firstName ?? "",
              lastName: role.profile?.lastName ?? "",
              email: role.profile?.email ?? role.user.email,
              phoneNumber: role.profile?.phoneNumber ?? "",
              dateOfBirth: role.profile?.dateOfBirth ?? null,
            },
            assignments: [] as AssignmentDraft[],
          };
          map.set(role.user.id, created);
          return created;
        })();
      const key = `${role.scopeType}:${role.scopeId}:${role.roleType}`;
      const hasAssignment = entry.assignments.some((assignment) => `${assignment.scopeType}:${assignment.scopeId}:${assignment.roleType}` === key);
      if (!hasAssignment) {
        entry.assignments.push({
          id: crypto.randomUUID(),
          scopeType: role.scopeType,
          scopeId: role.scopeId,
          roleType: role.roleType,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [status.roles]);

  useEffect(() => {
    if (!editingUserId) return;
    const target = existingUsers.find((user) => user.userId === editingUserId);
    if (!target) {
      setEditingUserId(null);
      return;
    }
    setForm({
      firstName: target.profile.firstName,
      lastName: target.profile.lastName,
      email: target.profile.email || target.email,
      phoneNumber: target.profile.phoneNumber,
      username: target.username,
      password: "",
      dateOfBirth: target.profile.dateOfBirth ?? "",
      assignments: target.assignments.length > 0 ? target.assignments : [],
      rememberForLogin: false,
    });
  }, [editingUserId, existingUsers]);

  const phoneDisplay = useMemo(() => formatPhone(form.phoneNumber), [form.phoneNumber]);

  const updateAssignment = (id: string, updates: Partial<AssignmentDraft>) => {
    setForm((prev) => ({
      ...prev,
      assignments: prev.assignments.map((assignment) =>
        assignment.id === id ? { ...assignment, ...updates } : assignment,
      ),
    }));
  };

  const addAssignment = () => {
    if (scopeOptions.length === 0) return;
    setForm((prev) => ({
      ...prev,
      assignments: [
        ...prev.assignments,
        {
          id: crypto.randomUUID(),
          scopeType: scopeOptions[0]!.scopeType,
          scopeId: scopeOptions[0]!.scopeId,
          roleType: "manager",
        },
      ],
    }));
  };

  const removeAssignment = (id: string) => {
    setForm((prev) => ({
      ...prev,
      assignments: prev.assignments.length > 1 ? prev.assignments.filter((assignment) => assignment.id !== id) : prev.assignments,
    }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.assignments.length === 0) return;
    const roleAssignments = form.assignments.map(({ scopeId, scopeType, roleType }) => ({
      scopeId,
      scopeType,
      roleType,
    }));
    if (editingUserId) {
      await updateMutation.mutateAsync({
        userId: editingUserId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phoneNumber: form.phoneNumber,
        username: form.username.trim(),
        password: form.password.trim() ? form.password : undefined,
        dateOfBirth: form.dateOfBirth ? form.dateOfBirth : null,
        roleAssignments,
      });
      return;
    }
    await mutation.mutateAsync({
      users: [
        {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phoneNumber: form.phoneNumber,
          username: form.username.trim(),
          password: form.password,
          dateOfBirth: form.dateOfBirth || undefined,
          roleAssignments,
        },
      ],
    });
    if (form.rememberForLogin) {
      const identifier = form.email.trim() || form.username.trim();
      if (identifier && form.password) {
        onRememberCredential({ identifier, password: form.password });
      }
    }
  };

  if (!status.business) {
    return (
      <div>
        <p className="text-sm text-ink-muted">Complete the earlier steps before adding user accounts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Create team accounts</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Each scope needs an admin. Add optional manager/employee roles for scheduling workflows.
        </p>
      </div>
      <div className="rounded-md border border-outline-muted bg-surface-muted p-4 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase text-ink-subtle">Current assignments</div>
          <div className="flex gap-2">
            {status.missingAdmins.length > 0 ? (
              <button
                type="button"
                onClick={() => createDefaultUsersMutation.mutate()}
                disabled={createDefaultUsersMutation.isPending}
                className="rounded-md border border-outline-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-primary transition hover:bg-accent-muted disabled:opacity-60"
              >
                {createDefaultUsersMutation.isPending ? "Creating..." : "Create default accounts"}
              </button>
            ) : null}
            {status.roles.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to delete all user accounts? This cannot be undone.")) {
                    clearAccountsMutation.mutate();
                  }
                }}
                disabled={clearAccountsMutation.isPending}
                className="rounded-md border border-status-danger px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-status-danger transition hover:bg-status-danger-surface disabled:opacity-60"
              >
                {clearAccountsMutation.isPending ? "Clearing..." : "Clear all accounts"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-2 space-y-3">
          {groupedRoles.map((group) => (
            <div key={group.key}>
              <div className="font-semibold">{group.label}</div>
              {group.entries.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-ink-muted">
                  {group.entries.map((entry, idx) => (
                    <li key={`${group.key}-${idx}`}>{entry}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-ink-subtle">No users yet</div>
              )}
            </div>
          ))}
        </div>
        {status.missingAdmins.length > 0 ? (
          <div className="mt-3 rounded border border-status-warning bg-status-warning-surface/40 p-2 text-xs text-status-warning">
            <div className="font-semibold">Missing admins:</div>
            <ul className="mt-1 list-disc pl-5">
              {status.missingAdmins.map((missing) => (
                <li key={`${missing.scopeType}-${missing.scopeId}`}>{missing.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {createDefaultUsersMutation.error ? (
          <p className="mt-2 text-xs text-status-danger">{createDefaultUsersMutation.error.message}</p>
        ) : null}
        {clearAccountsMutation.error ? (
          <p className="mt-2 text-xs text-status-danger">{clearAccountsMutation.error.message}</p>
        ) : null}
      </div>
      {generatedDefaults.length > 0 ? (
        <div className="rounded-md border border-outline-muted bg-surface-muted p-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase text-ink-subtle">Generated default accounts</div>
              <p className="mt-1 text-xs text-ink-muted">Copy these credentials before leaving this page.</p>
            </div>
            <button
              type="button"
              onClick={() => setGeneratedDefaults([])}
              className="text-xs text-ink-muted transition hover:text-ink-primary"
            >
              Clear list
            </button>
          </div>
          <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
            {generatedDefaults.map((user) => (
              <div key={`${user.username}-${user.roleType}`} className="rounded border border-outline-muted bg-surface-muted p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{user.scopeLabel}</span>
                  <span className="text-xs uppercase text-ink-muted">{roleLabels[user.roleType] ?? user.roleType}</span>
                </div>
                <div className="mt-2 grid gap-1 font-mono text-[11px] text-ink-primary">
                  <span>username: {user.username}</span>
                  <span>password: {user.password}</span>
                  <span>email: {user.email}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {existingUsers.length > 0 ? (
        <div className="rounded-md border border-outline-muted bg-surface-muted p-4 text-sm">
          <div className="text-xs uppercase text-ink-subtle">Edit existing accounts</div>
          <div className="mt-3 grid gap-2">
            {existingUsers.map((user) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => setEditingUserId(user.userId)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                  editingUserId === user.userId
                    ? "border-outline-accent bg-accent-muted/40"
                    : "border-outline-muted hover:border-outline-strong"
                }`}
              >
                <div className="font-semibold">{user.displayName || user.username}</div>
                <div className="text-xs text-ink-muted">{user.email}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-primary">
            {editingUserId ? "Edit account" : "Create new account"}
          </h3>
          {editingUserId ? (
            <button
              type="button"
              onClick={() => {
                setEditingUserId(null);
                setForm(() => {
                  const base = createEmptyForm();
                  return {
                    ...base,
                    assignments:
                      scopeOptions.length > 0
                        ? [
                            {
                              id: crypto.randomUUID(),
                              scopeType: scopeOptions[0]!.scopeType,
                              scopeId: scopeOptions[0]!.scopeId,
                              roleType: "admin",
                            },
                          ]
                        : [],
                  };
                });
              }}
              className="text-xs text-ink-muted hover:text-ink-primary"
            >
              Cancel edit
            </button>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase text-ink-subtle">First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              placeholder="Riley"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase text-ink-subtle">Last name</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              placeholder="Jordan"
              required
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase text-ink-subtle">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              placeholder="riley@example.edu"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase text-ink-subtle">Phone</label>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phoneDisplay}
              onChange={(e) => {
                const digits = extractPhoneDigits(e.target.value);
                setForm((prev) => ({
                  ...prev,
                  phoneNumber: digits,
                }));
              }}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              placeholder="(555) 123-4567"
              required
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase text-ink-subtle">Username</label>
            <input
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              placeholder="riley.jordan"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase text-ink-subtle">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              placeholder={editingUserId ? "Leave blank to keep current password" : "Strong password"}
              required={!editingUserId}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase text-ink-subtle">Date of birth (optional)</label>
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
            className="w-full rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
          />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase text-ink-subtle">Role assignments</label>
            <button
              type="button"
              onClick={addAssignment}
              className="text-xs font-semibold text-ink-primary hover:text-accent-soft"
            >
              + Add assignment
            </button>
          </div>
          {form.assignments.map((assignment) => (
            <div key={assignment.id} className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
              <select
                value={`${assignment.scopeType}:${assignment.scopeId}`}
                onChange={(e) => {
                  const [scopeType, scopeId] = e.target.value.split(":");
                  updateAssignment(assignment.id, {
                    scopeType: scopeType as ScopeOption["scopeType"],
                    scopeId: Number(scopeId),
                  });
                }}
                className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              >
                {scopeOptions.map((option) => (
                  <option key={`${option.scopeType}-${option.scopeId}`} value={`${option.scopeType}:${option.scopeId}`}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={assignment.roleType}
                onChange={(e) => updateAssignment(assignment.id, { roleType: e.target.value as AssignmentDraft["roleType"] })}
                className="rounded-md border border-outline-muted bg-surface-muted px-3 py-2 text-sm outline-none ring-accent-default/40 focus:ring"
              >
                <option value="admin">Admin</option>
                <option value="co_admin">Co-admin</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
              </select>
              <button type="button" className="text-xs text-ink-subtle hover:text-ink-primary" onClick={() => removeAssignment(assignment.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={form.rememberForLogin}
            onChange={(e) => setForm((prev) => ({ ...prev, rememberForLogin: e.target.checked }))}
            className="h-4 w-4 rounded border-outline-muted/60 bg-surface-raised"
            disabled={!!editingUserId}
          />
          Use this account to sign in after setup
        </label>
        {rememberedCredential ? (
          <p className="text-xs text-ink-primary">Will sign in as {rememberedCredential.identifier} once setup completes.</p>
        ) : null}
        {mutation.error ? <p className="text-sm text-status-danger">{mutation.error.message}</p> : null}
        {updateMutation.error ? <p className="text-sm text-status-danger">{updateMutation.error.message}</p> : null}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending || updateMutation.isPending}
            className="rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:opacity-60"
          >
            {mutation.isPending || updateMutation.isPending
              ? "Saving..."
              : editingUserId
                ? "Save changes"
                : "Create account"}
          </button>
          {!editingUserId ? (
            <button
              type="button"
              onClick={() => onRememberCredential(null)}
              className="text-xs text-ink-muted hover:text-ink-primary"
            >
              Clear saved credentials
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

