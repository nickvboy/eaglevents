"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { SearchIcon, XIcon } from "~/app/_components/icons";
import { api, type RouterOutputs } from "~/trpc/react";

type RoleOption = "admin" | "co_admin" | "manager" | "employee";

type FormState = {
  displayName: string;
  firstName: string;
  lastName: string;
  profileEmail: string;
  phoneNumber: string;
  dateOfBirth: string;
  primaryRole: RoleOption;
};

type CreateFormState = {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  dateOfBirth: string;
  primaryRole: RoleOption;
  scopeKeys: string[];
};

type AdminUser = RouterOutputs["admin"]["users"]["users"][number];

const roleOptions: Array<{ value: RoleOption; label: string; helper: string }> = [
  { value: "admin", label: "Administrator", helper: "Full access to all admin tools" },
  { value: "co_admin", label: "Co-admin", helper: "Day-to-day admin access without full ownership" },
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

function createDefaultCreateForm(): CreateFormState {
  return {
    username: "",
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    phoneNumber: "",
    dateOfBirth: "",
    primaryRole: "employee",
    scopeKeys: [],
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

function formatPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function resolveDisplayName(user: Pick<AdminUser, "displayName" | "username">) {
  const trimmed = user.displayName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : user.username;
}

export function UsersView() {
  const { data: session } = useSession();
  const { data: permissions } = api.admin.permissions.useQuery();
  const { data, isLoading, isError, refetch } = api.admin.users.useQuery(undefined, {
    staleTime: 45_000,
  });
  const canManageUsers = permissions?.capabilities.includes("users:manage") ?? false;
  const canGrantVisibility = permissions?.capabilities.includes("visibility_grants:manage") ?? false;
  const hasBusinessAdmin = permissions?.roles.some((role) => role.scopeType === "business" && role.roleType === "admin") ?? false;
  const hasBusinessCoAdmin =
    permissions?.roles.some((role) => role.scopeType === "business" && role.roleType === "co_admin") ?? false;
  const isManager = permissions?.roles.some((role) => role.roleType === "manager") ?? false;
  const canEditRoles = hasBusinessAdmin || hasBusinessCoAdmin;
  const canAssignAdminRoles = hasBusinessAdmin || hasBusinessCoAdmin;
  const canCreateUsers = hasBusinessAdmin || hasBusinessCoAdmin || isManager;
  const canCreateEmployeeOnly = isManager && !hasBusinessAdmin && !hasBusinessCoAdmin;
  const { data: companyOverview } = api.admin.companyOverview.useQuery(undefined, {
    enabled: canGrantVisibility,
    staleTime: 60_000,
  });
  const utils = api.useUtils();
  const mutation = api.admin.updateUser.useMutation({
    onSuccess: async () => {
      await utils.admin.users.invalidate();
    },
  });
  const createMutation = api.admin.createUser.useMutation({
    onSuccess: async (created) => {
      await utils.admin.users.invalidate();
      if (created?.id) {
        setSelectedUserId(created.id);
      }
    },
  });
  const deleteMutation = api.admin.deleteUser.useMutation({
    onSuccess: async () => {
      await utils.admin.users.invalidate();
    },
  });
  const addGrantMutation = api.admin.addVisibilityGrant.useMutation({
    onSuccess: async () => {
      await utils.admin.users.invalidate();
    },
  });
  const removeGrantMutation = api.admin.removeVisibilityGrant.useMutation({
    onSuccess: async () => {
      await utils.admin.users.invalidate();
    },
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [formState, setFormState] = useState<FormState>(createDefaultForm);
  const [createFormState, setCreateFormState] = useState<CreateFormState>(createDefaultCreateForm);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [grantScopeKey, setGrantScopeKey] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const users = useMemo(() => data?.users ?? [], [data?.users]);
  const scopeOptions = useMemo(() => {
    if (!companyOverview) return [];
    const options: Array<{ value: string; label: string }> = [];
    if (companyOverview.business && (hasBusinessAdmin || hasBusinessCoAdmin)) {
      options.push({
        value: `business:${companyOverview.business.id}`,
        label: `${companyOverview.business.name} (Business)`,
      });
    }
    const departments = companyOverview.departments?.flat ?? [];
    for (const dept of departments) {
      const isDivision = dept.parentDepartmentId !== null;
      const scopeType = isDivision ? "division" : "department";
      options.push({
        value: `${scopeType}:${dept.id}`,
        label: `${dept.name} (${isDivision ? "Division" : "Department"})`,
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [companyOverview, hasBusinessAdmin, hasBusinessCoAdmin]);

  useEffect(() => {
    if (users.length === 0) {
      if (selectedUserId !== null) {
        setSelectedUserId(null);
      }
      return;
    }
    if (selectedUserId === null || !users.some((user) => user.id === selectedUserId)) {
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
  const sessionUserId = session?.user?.id;
  const currentUserId = sessionUserId && Number.isFinite(Number(sessionUserId)) ? Number(sessionUserId) : null;
  const isSelfSelected = Boolean(selectedUser && currentUserId !== null && selectedUser.id === currentUserId);
  const isDeactivated = selectedUser ? !selectedUser.isActive : false;

  useEffect(() => {
    setFormState(buildFormStateFromUser(selectedUser));
  }, [selectedUser]);

  useEffect(() => {
    setGrantScopeKey("");
    setGrantReason("");
  }, [selectedUserId]);

  const hasValidProfile =
    formState.firstName.trim().length > 0 &&
    formState.lastName.trim().length > 0 &&
    formState.profileEmail.trim().length > 0 &&
    formState.phoneNumber.trim().length > 0;

  const isEditRoleOptionDisabled = (value: RoleOption) => {
    if (!canEditRoles) return true;
    if ((value === "admin" || value === "co_admin") && !canAssignAdminRoles) return true;
    return false;
  };

  const isCreateRoleOptionDisabled = (value: RoleOption) => {
    if (!canCreateUsers) return true;
    if (canCreateEmployeeOnly) return value !== "employee";
    if ((value === "admin" || value === "co_admin") && !canAssignAdminRoles) return true;
    return false;
  };

  const businessScopeOption = useMemo(
    () => scopeOptions.find((option) => option.value.startsWith("business:")) ?? null,
    [scopeOptions],
  );
  const requiresBusinessScope = createFormState.primaryRole === "admin" || createFormState.primaryRole === "co_admin";
  const scopeSelectDisabled = requiresBusinessScope && Boolean(businessScopeOption);

  useEffect(() => {
    if (requiresBusinessScope && businessScopeOption) {
      if (createFormState.scopeKeys.length !== 1 || createFormState.scopeKeys[0] !== businessScopeOption.value) {
        setCreateFormState((prev) => ({ ...prev, scopeKeys: [businessScopeOption.value] }));
      }
      return;
    }
    if (createFormState.scopeKeys.length === 0 && scopeOptions.length > 0) {
      const fallback = scopeOptions.find((option) => !option.value.startsWith("business:")) ?? scopeOptions[0];
      if (fallback) {
        setCreateFormState((prev) => ({ ...prev, scopeKeys: [fallback.value] }));
      }
    }
  }, [businessScopeOption, createFormState.primaryRole, createFormState.scopeKeys, requiresBusinessScope, scopeOptions]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser) return;
    setFeedback(null);

    try {
      const primaryRole = canEditRoles ? formState.primaryRole : undefined;
      const trimmedDateOfBirth = formState.dateOfBirth.trim();
      await mutation.mutateAsync({
        userId: selectedUser.id,
        displayName: formState.displayName.trim(),
        profile: hasValidProfile
          ? {
              firstName: formState.firstName.trim(),
              lastName: formState.lastName.trim(),
              email: formState.profileEmail.trim(),
              phoneNumber: formState.phoneNumber.trim(),
              dateOfBirth: trimmedDateOfBirth.length > 0 ? trimmedDateOfBirth : null,
            }
          : undefined,
        primaryRole,
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

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateUsers) return;
    setFeedback(null);

    try {
      if (scopeOptions.length > 0 && createFormState.scopeKeys.length === 0) {
        setFeedback({ type: "error", message: "Select a scope for this user." });
        return;
      }
      if (requiresBusinessScope && !businessScopeOption) {
        setFeedback({ type: "error", message: "Business scope is required for admin roles." });
        return;
      }
      const scopes = createFormState.scopeKeys
        .map((key) => {
          const scopeParts = key.split(":");
          const scopeType = scopeParts[0] as "business" | "department" | "division" | undefined;
          const scopeId = scopeParts[1] ? Number(scopeParts[1]) : undefined;
          if (!scopeType || !Number.isFinite(scopeId)) return null;
          return { scopeType, scopeId };
        })
        .filter((scope): scope is { scopeType: "business" | "department" | "division"; scopeId: number } => Boolean(scope));
      const trimmedDateOfBirth = createFormState.dateOfBirth.trim();
      await createMutation.mutateAsync({
        username: createFormState.username.trim(),
        email: createFormState.email.trim(),
        password: createFormState.password,
        firstName: createFormState.firstName.trim(),
        lastName: createFormState.lastName.trim(),
        phoneNumber: createFormState.phoneNumber.trim(),
        dateOfBirth: trimmedDateOfBirth.length > 0 ? trimmedDateOfBirth : undefined,
        primaryRole: createFormState.primaryRole,
        scopes: scopes.length > 0 ? scopes : undefined,
      });
      setIsCreateOpen(false);
      setCreateFormState(createDefaultCreateForm());
      setFeedback({ type: "success", message: "User created" });
    } catch (error) {
      setFeedback({ type: "error", message: (error as Error).message ?? "Failed to create user" });
    }
  };

  const handleDelete = async () => {
    if (!selectedUser || isSelfSelected || isDeactivated || !canCreateUsers) return;
    setFeedback(null);

    try {
      await deleteMutation.mutateAsync({ userId: selectedUser.id });
      setSelectedUserId(null);
      setIsDeleteOpen(false);
      setFeedback({ type: "success", message: "User deactivated" });
    } catch (error) {
      setFeedback({ type: "error", message: (error as Error).message ?? "Failed to deactivate user" });
    }
  };

  const handleAddGrant = async () => {
    if (!selectedUser || !grantScopeKey || !canGrantVisibility) return;
    const [scopeType, scopeIdRaw] = grantScopeKey.split(":");
    const scopeId = Number(scopeIdRaw);
    if (!scopeType || !Number.isFinite(scopeId)) return;
    try {
      const trimmedReason = grantReason.trim();
      await addGrantMutation.mutateAsync({
        userId: selectedUser.id,
        scopeType: scopeType as "business" | "department" | "division",
        scopeId,
        reason: trimmedReason.length > 0 ? trimmedReason : undefined,
      });
      setGrantScopeKey("");
      setGrantReason("");
    } catch (error) {
      setFeedback({ type: "error", message: (error as Error).message ?? "Failed to add visibility grant" });
    }
  };

  const handleRemoveGrant = async (grantId: number) => {
    if (!canGrantVisibility) return;
    try {
      await removeGrantMutation.mutateAsync({ grantId });
    } catch (error) {
      setFeedback({ type: "error", message: (error as Error).message ?? "Failed to remove visibility grant" });
    }
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
          <div className="flex flex-wrap items-center gap-2">
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
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              disabled={!canCreateUsers}
              className="rounded-full bg-accent-strong px-4 py-2 text-xs font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add user
            </button>
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
                        <span className="font-medium text-ink-primary">{resolveDisplayName(user)}</span>
                        <span className="text-xs text-ink-faint">Created {user.createdAt.toLocaleDateString()}</span>
                        {!user.isActive ? (
                          <span className="text-xs font-semibold uppercase tracking-wide text-status-danger">Deactivated</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-subtle">{user.email}</td>
                    <td className="px-4 py-3 text-ink-subtle capitalize">
                      {user.primaryRole ? user.primaryRole.replace("_", " ") : "Unassigned"}
                    </td>
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

            <div className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
              <div className="text-sm font-semibold text-ink-primary">Role assignments</div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink-subtle">
                {selectedUser.roles.length === 0 ? (
                  <span className="text-xs text-ink-muted">No role assignments yet.</span>
                ) : (
                  selectedUser.roles.map((role) => (
                    <span
                      key={`${role.roleType}-${role.scopeType}-${role.scopeId}`}
                      className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-muted px-3 py-1 text-xs text-ink-primary"
                    >
                      <span className="font-semibold capitalize">{role.roleType.replace("_", " ")}</span>
                      <span className="text-ink-muted">{role.scopeLabel}</span>
                    </span>
                  ))
                )}
              </div>
            </div>

            <fieldset className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
              <legend className="px-2 text-sm font-semibold text-ink-primary">Primary role</legend>
              <div className="mt-3 flex flex-col gap-3">
                {roleOptions.map((option) => {
                  const checked = formState.primaryRole === option.value;
                  const disabled = isEditRoleOptionDisabled(option.value);
                  return (
                    <label
                      key={option.value}
                      className={
                        "flex flex-col gap-1 rounded-xl border px-3 py-2 text-sm transition " +
                        (checked
                          ? "border-outline-accent bg-accent-muted text-accent-soft"
                          : "border-outline-muted bg-transparent text-ink-subtle hover:border-outline-muted") +
                        (disabled ? " cursor-not-allowed opacity-60" : " cursor-pointer")
                      }
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="role"
                          value={option.value}
                          checked={checked}
                          disabled={disabled}
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
            {!canEditRoles ? (
              <p className="text-xs text-ink-muted">Role assignments can only be updated by workspace admins.</p>
            ) : null}

            {canGrantVisibility ? (
              <div className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
                <div className="text-sm font-semibold text-ink-primary">Visibility grants</div>
                <p className="mt-1 text-xs text-ink-muted">Give this user access to additional departments or divisions.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedUser.visibilityGrants.length === 0 ? (
                    <span className="text-xs text-ink-muted">No visibility grants yet.</span>
                  ) : (
                    selectedUser.visibilityGrants.map((grant) => (
                      <span
                        key={grant.id}
                        className="inline-flex items-center gap-2 rounded-full border border-outline-muted bg-surface-muted px-3 py-1 text-xs text-ink-primary"
                      >
                        <span>{grant.scopeLabel}</span>
                        <button
                          type="button"
                          className="text-ink-faint transition hover:text-status-danger"
                          onClick={() => handleRemoveGrant(grant.id)}
                          aria-label="Remove visibility grant"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1.2fr_auto]">
                  <label className="flex flex-col gap-2 text-xs text-ink-muted">
                    <span>Scope</span>
                    <select
                      value={grantScopeKey}
                      onChange={(event) => setGrantScopeKey(event.target.value)}
                      className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                    >
                      <option value="">Select a scope</option>
                      {scopeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-xs text-ink-muted">
                    <span>Reason (optional)</span>
                    <input
                      value={grantReason}
                      onChange={(event) => setGrantReason(event.target.value)}
                      className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                      placeholder="Reason for access"
                      maxLength={255}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddGrant}
                      disabled={!grantScopeKey || addGrantMutation.isPending}
                      className="rounded-full bg-accent-strong px-4 py-2 text-xs font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {addGrantMutation.isPending ? "Adding..." : "Add grant"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

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
              <button
                type="button"
                onClick={() => setIsDeleteOpen(true)}
                disabled={deleteMutation.isPending || isSelfSelected || isDeactivated || !canManageUsers}
                className="rounded-full border border-status-danger px-4 py-2 text-sm font-semibold text-status-danger transition hover:bg-status-danger-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:border-status-danger/50 disabled:text-status-danger/50"
              >
                {deleteMutation.isPending ? "Deactivating..." : "Deactivate user"}
              </button>
            </div>
            {isSelfSelected ? (
              <p className="text-xs text-ink-muted">You cannot deactivate your own account.</p>
            ) : null}
            {isDeactivated ? (
              <p className="text-xs text-ink-muted">This account is already deactivated.</p>
            ) : null}
            {!canManageUsers ? (
              <p className="text-xs text-ink-muted">You do not have access to manage users.</p>
            ) : !canCreateUsers ? (
              <p className="text-xs text-ink-muted">Only admins, co-admins, and managers can create or deactivate users.</p>
            ) : null}
          </form>
        )}
      </section>
      {isDeleteOpen && selectedUser ? (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center bg-[var(--color-overlay-backdrop)] px-4 py-8">
          <div className="w-full max-w-md rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
            <h3 className="text-lg font-semibold text-ink-primary">Deactivate user account</h3>
            <p className="mt-2 text-sm text-ink-muted">
              This will remove{" "}
              <span className="font-semibold text-ink-primary">{resolveDisplayName(selectedUser)}</span>
              {" "}from the platform while keeping their events and history intact.
            </p>
            <div className="mt-4 rounded-xl border border-status-danger/40 bg-status-danger-surface px-3 py-2 text-xs text-status-danger">
              They will no longer be able to sign in.
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsDeleteOpen(false)}
                className="rounded-full border border-outline-muted px-4 py-2 text-sm text-ink-subtle transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-full bg-status-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-status-danger/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-danger disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deactivating..." : "Deactivate user"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isCreateOpen ? (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center bg-[var(--color-overlay-backdrop)] px-4 py-8">
          <div className="max-h-[calc(100vh-4rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
            <h3 className="text-lg font-semibold text-ink-primary">Add user</h3>
            <p className="mt-2 text-sm text-ink-muted">Create a new account with a primary role.</p>
            <form className="mt-6 grid gap-4" onSubmit={handleCreate}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>First name</span>
                  <input
                    value={createFormState.firstName}
                    onChange={(event) => setCreateFormState((prev) => ({ ...prev, firstName: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                    maxLength={100}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Last name</span>
                  <input
                    value={createFormState.lastName}
                    onChange={(event) => setCreateFormState((prev) => ({ ...prev, lastName: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                    maxLength={100}
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Username</span>
                  <input
                    value={createFormState.username}
                    onChange={(event) => setCreateFormState((prev) => ({ ...prev, username: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                    placeholder="yourname"
                    autoComplete="username"
                    minLength={3}
                    maxLength={50}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Email</span>
                  <input
                    type="email"
                    value={createFormState.email}
                    onChange={(event) => setCreateFormState((prev) => ({ ...prev, email: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                    placeholder="you@example.com"
                    autoComplete="email"
                    maxLength={255}
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Password</span>
                  <input
                    type="password"
                    value={createFormState.password}
                    onChange={(event) => setCreateFormState((prev) => ({ ...prev, password: event.target.value }))}
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                    placeholder="Enter a strong password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-ink-primary">
                  <span>Phone number</span>
                  <input
                    value={createFormState.phoneNumber}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({ ...prev, phoneNumber: formatPhoneInput(event.target.value) }))
                    }
                    className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary outline-none ring-accent-default/40 placeholder:text-ink-faint focus:ring"
                    placeholder="+1 555 555 0101"
                    maxLength={32}
                    required
                  />
                </label>
              </div>
              <label className="flex flex-col gap-2 text-sm text-ink-primary md:max-w-[220px]">
                <span>Date of birth</span>
                <input
                  type="date"
                  value={createFormState.dateOfBirth}
                  onChange={(event) => setCreateFormState((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
                  className="rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none"
                />
              </label>
              <fieldset className="rounded-2xl border border-outline-muted bg-surface-muted p-4">
                <legend className="px-2 text-sm font-semibold text-ink-primary">Primary role</legend>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {roleOptions.map((option) => {
                    const disabled = isCreateRoleOptionDisabled(option.value);
                    return (
                      <label
                        key={option.value}
                        className={
                          "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition " +
                          (createFormState.primaryRole === option.value
                            ? "border-outline-accent bg-accent-muted text-accent-soft"
                            : "border-outline-muted bg-transparent text-ink-subtle hover:border-outline-muted") +
                          (disabled ? " cursor-not-allowed opacity-60" : " cursor-pointer")
                        }
                      >
                        <input
                          type="radio"
                          name="create-role"
                          value={option.value}
                          checked={createFormState.primaryRole === option.value}
                          disabled={disabled}
                          onChange={() => setCreateFormState((prev) => ({ ...prev, primaryRole: option.value }))}
                          className="h-4 w-4 accent-accent-strong"
                        />
                        <span className="font-medium">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <label className="flex flex-col gap-2 text-sm text-ink-primary">
                <span>Scope</span>
                <select
                  value={createFormState.scopeKeys}
                  onChange={(event) => {
                    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                    setCreateFormState((prev) => ({ ...prev, scopeKeys: selected }));
                  }}
                  multiple
                  className="min-h-[120px] rounded-lg border border-outline-muted bg-surface-muted px-3 py-2 text-sm text-ink-primary focus:border-outline-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={scopeSelectDisabled}
                >
                  {scopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {requiresBusinessScope ? (
                  <span className="text-xs text-ink-muted">Admin roles are assigned to the full business scope.</span>
                ) : (
                  <span className="text-xs text-ink-muted">Hold Ctrl/Cmd to select multiple scopes.</span>
                )}
              </label>
              <div className="mt-2 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setCreateFormState(createDefaultCreateForm());
                  }}
                  className="rounded-full border border-outline-muted px-4 py-2 text-sm text-ink-subtle transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !canCreateUsers}
                  className="rounded-full bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createMutation.isPending ? "Creating..." : "Create user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}


