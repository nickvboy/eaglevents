"use client";

import { useEffect, useMemo, useState } from "react";

import { SearchIcon } from "~/app/_components/icons";
import { api, type RouterOutputs } from "~/trpc/react";

type RoleOption = "admin" | "manager" | "employee";

type FormState = {
  displayName: string;
  firstName: string;
  lastName: string;
  profileEmail: string;
  phoneNumber: string;
  dateOfBirth: string;
  primaryRole: RoleOption;
};

type AdminUser = RouterOutputs["admin"]["users"]["users"][number];

const roleOptions: Array<{ value: RoleOption; label: string; helper: string }> = [
  { value: "admin", label: "Administrator", helper: "Full access to all admin tools" },
  { value: "manager", label: "Manager", helper: "Can manage teams and schedules" },
  { value: "employee", label: "Employee", helper: "Can view assigned events" },
];

function createDefaultForm(): FormState {
  return {
    displayName: "",
    firstName: "",
    lastName: "",
    profileEmail: "",
    phoneNumber: "",
    dateOfBirth: "",
    primaryRole: "employee",
  };
}

function buildFormStateFromUser(user: AdminUser | null | undefined): FormState {
  if (!user) {
    return createDefaultForm();
  }

  return {
    displayName: user.displayName ?? "",
    firstName: user.profile?.firstName ?? "",
    lastName: user.profile?.lastName ?? "",
    profileEmail: user.profile?.email ?? user.email ?? "",
    phoneNumber: user.profile?.phoneNumber ?? "",
    dateOfBirth: formatDateForInput(user.profile?.dateOfBirth),
    primaryRole: user.primaryRole ?? "employee",
  };
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateCell(value: Date | string | null | undefined) {
  const date = coerceDate(value);
  return date ? date.toLocaleDateString() : "No activity";
}

function formatDateForInput(value: Date | string | null | undefined) {
  const date = coerceDate(value);
  return date && typeof date.toISOString === "function" ? date.toISOString().slice(0, 10) : "";
}

export function UsersView() {
  const { data, isLoading, isError, refetch } = api.admin.users.useQuery(undefined, {
    staleTime: 45_000,
  });
  const utils = api.useUtils();
  const mutation = api.admin.updateUser.useMutation({
    onSuccess: async () => {
      await utils.admin.users.invalidate();
    },
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>(createDefaultForm);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const users = data?.users ?? [];

  useEffect(() => {
    if (users.length > 0 && selectedUserId === null) {
      setSelectedUserId(users[0]!.id);
    }
  }, [users, selectedUserId]);

  const filteredUsers = useMemo(() => {
    if (!searchTerm) return users;
    const term = searchTerm.toLowerCase();
    return users.filter((user) => {
      const haystack = [
        user.displayName,
        user.username,
        user.email,
        user.profile?.firstName,
        user.profile?.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [users, searchTerm]);

  const selectedUser = filteredUsers.find((user) => user.id === selectedUserId) ?? users.find((user) => user.id === selectedUserId) ?? null;

  useEffect(() => {
    setFormState(buildFormStateFromUser(selectedUser));
  }, [selectedUser]);

  const hasValidProfile =
    formState.firstName.trim().length > 0 &&
    formState.lastName.trim().length > 0 &&
    formState.profileEmail.trim().length > 0 &&
    formState.phoneNumber.trim().length > 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser) return;
    setFeedback(null);

    try {
      await mutation.mutateAsync({
        userId: selectedUser.id,
        displayName: formState.displayName.trim(),
        profile: hasValidProfile
          ? {
              firstName: formState.firstName.trim(),
              lastName: formState.lastName.trim(),
              email: formState.profileEmail.trim(),
              phoneNumber: formState.phoneNumber.trim(),
              dateOfBirth: formState.dateOfBirth || null,
            }
          : undefined,
        primaryRole: formState.primaryRole,
      });
      setFeedback({ type: "success", message: "User details updated" });
    } catch (error) {
      setFeedback({ type: "error", message: (error as Error).message ?? "Failed to update user" });
    }
  };

  const handleReset = () => {
    if (!selectedUser) return;
    setFormState(buildFormStateFromUser(selectedUser));
    setFeedback(null);
  };

  if (isLoading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="h-96 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
        <div className="h-96 animate-pulse rounded-2xl border border-outline-muted bg-surface-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 text-sm text-status-danger">
        Unable to load users. Please refresh.
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <section className="flex flex-col rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">User Directory</h2>
            <p className="text-sm text-ink-muted">Search, review, and select a user to manage their details.</p>
          </div>
          <div className="flex w-full max-w-xs items-center gap-2 rounded-full border border-outline-muted bg-surface-muted px-4 py-2">
            <SearchIcon className="text-ink-muted" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search users..."
              className="flex-1 bg-transparent text-sm text-ink-primary placeholder:text-ink-faint focus:outline-none"
            />
          </div>
        </header>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-outline-muted">
          <table className="min-w-full divide-y divide-outline-muted text-sm text-ink-primary">
            <thead className="bg-surface-muted text-left uppercase tracking-wide text-xs text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3">Role</th>
                <th scope="col" className="px-4 py-3">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-muted">
              {filteredUsers.map((user) => {
                const isActive = user.id === selectedUserId;
                return (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedUserId(user.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedUserId(user.id);
                      }
                    }}
                    className={
                      "cursor-pointer transition hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-strong " +
                      (isActive ? "bg-accent-muted" : "")
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-ink-primary">{user.displayName || user.username}</span>
                        <span className="text-xs text-ink-faint">Created {user.createdAt.toLocaleDateString()}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-subtle">{user.email}</td>
                    <td className="px-4 py-3 text-ink-subtle capitalize">{user.primaryRole ?? "Unassigned"}</td>
                    <td className="px-4 py-3 text-ink-subtle">{formatDateCell(user.lastActivity)}</td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-muted">
                    No users match your search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-full border border-outline-muted px-4 py-2 text-xs font-semibold text-ink-subtle transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-strong"
          >
            Refresh list
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">User Details</h2>
            <p className="text-sm text-ink-muted">
              Update profile information and role assignments.
            </p>
          </div>
        </header>

        {!selectedUser ? (
          <div className="mt-8 rounded-2xl border border-dashed border-outline-muted bg-surface-muted px-4 py-10 text-center text-sm text-ink-muted">
            Select a user from the directory to edit their details.
          </div>
        ) : (
          <form className="mt-6 flex flex-col gap-6" onSubmit={handleSubmit}>
            <div className="grid gap-4">
              <label className="flex flex-col gap-2 text-sm text-ink-primary">
                <span>Display name</span>
                <input
                  value={formState.displayName}
                  onChange={(event) => setFormState((prev) => ({ ...prev, displayName: event.target.value }))}
                  className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                  placeholder="Display name"
                  required
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>First name</span>
                  <input
                    value={formState.firstName}
                    onChange={(event) => setFormState((prev) => ({ ...prev, firstName: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                    placeholder="First name"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Last name</span>
                  <input
                    value={formState.lastName}
                    onChange={(event) => setFormState((prev) => ({ ...prev, lastName: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                    placeholder="Last name"
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Contact email</span>
                  <input
                    type="email"
                    value={formState.profileEmail}
                    onChange={(event) => setFormState((prev) => ({ ...prev, profileEmail: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                    placeholder="user@example.com"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Phone number</span>
                  <input
                    value={formState.phoneNumber}
                    onChange={(event) => setFormState((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                    placeholder="+1 555 555 0101"
                    required
                  />
                </label>
              </div>
              <label className="flex flex-col gap-2 text-sm text-ink-primary md:max-w-[200px]">
                <span>Date of birth</span>
                <input
                  type="date"
                  value={formState.dateOfBirth}
                  onChange={(event) => setFormState((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
                  className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                />
              </label>
            </div>

            <fieldset className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
              <legend className="px-2 text-sm font-semibold text-ink-primary">Primary role</legend>
              <div className="mt-3 flex flex-col gap-3">
                {roleOptions.map((option) => {
                  const checked = formState.primaryRole === option.value;
                  return (
                    <label
                      key={option.value}
                      className={
                        "flex cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2 text-sm transition " +
                        (checked
                          ? "border-outline-accent bg-accent-muted text-accent-soft"
                          : "border-outline-muted bg-transparent text-ink-subtle hover:border-outline-muted")
                      }
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="role"
                          value={option.value}
                          checked={checked}
                          onChange={() => setFormState((prev) => ({ ...prev, primaryRole: option.value }))}
                          className="h-4 w-4 accent-accent-strong"
                        />
                        <span className="font-medium">{option.label}</span>
                      </div>
                      <span className="pl-7 text-xs text-ink-muted">{option.helper}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {feedback ? (
              <div
                className={
                  "rounded-xl border px-3 py-2 text-sm " +
                  (feedback.type === "success"
                    ? "border-outline-accent bg-accent-muted text-accent-soft"
                    : "border-status-danger bg-status-danger-surface text-status-danger")
                }
              >
                {feedback.message}
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="rounded-full bg-accent-strong px-5 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mutation.isPending ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-full border border-outline-muted px-4 py-2 text-sm text-ink-subtle transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
              >
                Reset
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}


