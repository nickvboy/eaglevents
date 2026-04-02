"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { SearchIcon, XIcon } from "~/app/_components/icons";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  createRoleAssignmentDraft,
  RoleAssignmentsEditor,
  type RoleAssignmentDraft,
  type RoleOption,
  type RoleScopeOption,
} from "./RoleAssignmentsEditor";

type FormState = {
  displayName: string;
  firstName: string;
  lastName: string;
  profileEmail: string;
  phoneNumber: string;
  affiliation: "staff" | "faculty" | "student";
  dateOfBirth: string;
};

type CreateFormState = {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  affiliation: "staff" | "faculty" | "student";
  dateOfBirth: string;
};

type AdminUser = RouterOutputs["admin"]["users"]["users"][number];
const profileAffiliationOptions = [
  { value: "staff", label: "Staff" },
  { value: "faculty", label: "Faculty" },
  { value: "student", label: "Student" },
] as const;

function createDefaultForm(): FormState {
  return {
    displayName: "",
    firstName: "",
    lastName: "",
    profileEmail: "",
    phoneNumber: "",
    affiliation: "staff",
    dateOfBirth: "",
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
    affiliation: "staff",
    dateOfBirth: "",
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
    affiliation: user.profile?.affiliation ?? "staff",
    dateOfBirth: formatDateForInput(user.profile?.dateOfBirth),
  };
}

function buildRoleAssignmentsDraftFromUser(
  user: AdminUser | null | undefined,
): RoleAssignmentDraft[] {
  if (!user) return [];
  return user.roles.map((role, index) => ({
    id: `existing-${user.id}-${index}`,
    roleType: role.roleType,
    scopeKey: `${role.scopeType}:${role.scopeId}`,
  }));
}

function parseScopeKey(scopeKey: string) {
  const [scopeTypeRaw, scopeIdRaw] = scopeKey.split(":");
  const scopeId = Number(scopeIdRaw);
  if (!scopeTypeRaw || !Number.isFinite(scopeId)) return null;
  if (
    scopeTypeRaw !== "business" &&
    scopeTypeRaw !== "department" &&
    scopeTypeRaw !== "division"
  )
    return null;
  return {
    scopeType: scopeTypeRaw,
    scopeId,
  } as const;
}

function validateRoleAssignmentDrafts(
  assignments: RoleAssignmentDraft[],
  scopeOptions: RoleScopeOption[],
) {
  if (assignments.length === 0) {
    return "Add at least one role assignment.";
  }

  const availableScopeKeys = new Set(
    scopeOptions.map((option) => option.value),
  );
  const seen = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.scopeKey) {
      return "Each role assignment needs a scope.";
    }
    if (!availableScopeKeys.has(assignment.scopeKey)) {
      return "One or more role assignments uses a scope that is no longer available.";
    }
    const key = `${assignment.roleType}:${assignment.scopeKey}`;
    if (seen.has(key)) {
      return "Duplicate role assignments are not allowed.";
    }
    seen.add(key);
  }

  return null;
}

function serializeRoleAssignments(assignments: RoleAssignmentDraft[]) {
  return assignments
    .map((assignment) => {
      const parsed = parseScopeKey(assignment.scopeKey);
      if (!parsed) return null;
      return {
        roleType: assignment.roleType,
        scopeType: parsed.scopeType,
        scopeId: parsed.scopeId,
      };
    })
    .filter(
      (
        assignment,
      ): assignment is {
        roleType: RoleOption;
        scopeType: "business" | "department" | "division";
        scopeId: number;
      } => Boolean(assignment),
    );
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
  return date && typeof date.toISOString === "function"
    ? date.toISOString().slice(0, 10)
    : "";
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
  const { data, isLoading, isError, refetch } = api.admin.users.useQuery(
    undefined,
    {
      staleTime: 45_000,
    },
  );
  const canManageUsers =
    permissions?.capabilities.includes("users:manage") ?? false;
  const canGrantVisibility =
    permissions?.capabilities.includes("visibility_grants:manage") ?? false;
  const hasBusinessAdmin =
    permissions?.roles.some(
      (role) => role.scopeType === "business" && role.roleType === "admin",
    ) ?? false;
  const hasBusinessCoAdmin =
    permissions?.roles.some(
      (role) => role.scopeType === "business" && role.roleType === "co_admin",
    ) ?? false;
  const isManager =
    permissions?.roles.some((role) => role.roleType === "manager") ?? false;
  const canEditRoles = hasBusinessAdmin;
  const canAssignAdminRoles = hasBusinessAdmin;
  const canCreateUsers = hasBusinessAdmin || hasBusinessCoAdmin || isManager;
  const canCreateEmployeeOnly =
    isManager && !hasBusinessAdmin && !hasBusinessCoAdmin;
  const { data: companyOverview } = api.admin.companyOverview.useQuery(
    undefined,
    {
      enabled: canGrantVisibility || canEditRoles || canCreateUsers,
      staleTime: 60_000,
    },
  );
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
  const [createFormState, setCreateFormState] = useState<CreateFormState>(
    createDefaultCreateForm,
  );
  const [roleAssignmentsDraft, setRoleAssignmentsDraft] = useState<
    RoleAssignmentDraft[]
  >([]);
  const [createRoleAssignmentsDraft, setCreateRoleAssignmentsDraft] = useState<
    RoleAssignmentDraft[]
  >([]);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [grantScopeKey, setGrantScopeKey] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const users = useMemo(() => data?.users ?? [], [data?.users]);
  const scopeOptions = useMemo(() => {
    if (!companyOverview) return [];
    const options: RoleScopeOption[] = [];
    if (companyOverview.business && (hasBusinessAdmin || hasBusinessCoAdmin)) {
      options.push({
        value: `business:${companyOverview.business.id}`,
        label: `${companyOverview.business.name} (Business)`,
        scopeType: "business",
        scopeId: companyOverview.business.id,
      });
    }
    const departments = companyOverview.departments?.flat ?? [];
    for (const dept of departments) {
      const isDivision = dept.parentDepartmentId !== null;
      const scopeType = isDivision ? "division" : "department";
      options.push({
        value: `${scopeType}:${dept.id}`,
        label: `${dept.name} (${isDivision ? "Division" : "Department"})`,
        scopeType,
        scopeId: dept.id,
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
    if (
      selectedUserId === null ||
      !users.some((user) => user.id === selectedUserId)
    ) {
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

  const selectedUser =
    filteredUsers.find((user) => user.id === selectedUserId) ??
    users.find((user) => user.id === selectedUserId) ??
    null;
  const sessionUserId = session?.user?.id;
  const currentUserId =
    sessionUserId && Number.isFinite(Number(sessionUserId))
      ? Number(sessionUserId)
      : null;
  const isSelfSelected = Boolean(
    selectedUser && currentUserId !== null && selectedUser.id === currentUserId,
  );
  const isDeactivated = selectedUser ? !selectedUser.isActive : false;
  const canEditSelectedUserRoles = canEditRoles && !isSelfSelected;

  useEffect(() => {
    setFormState(buildFormStateFromUser(selectedUser));
    setRoleAssignmentsDraft(buildRoleAssignmentsDraftFromUser(selectedUser));
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

  const businessScopeOption = useMemo(
    () =>
      scopeOptions.find((option) => option.value.startsWith("business:")) ??
      null,
    [scopeOptions],
  );
  const editableScopeOptions = useMemo(() => {
    const options = new Map(
      scopeOptions.map((option) => [option.value, option]),
    );
    for (const role of selectedUser?.roles ?? []) {
      const key = `${role.scopeType}:${role.scopeId}`;
      if (!options.has(key)) {
        options.set(key, {
          value: key,
          label: role.scopeLabel,
          scopeType: role.scopeType,
          scopeId: role.scopeId,
        });
      }
    }
    return Array.from(options.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [scopeOptions, selectedUser]);
  const editableBusinessScopeOption = useMemo(
    () =>
      editableScopeOptions.find((option) => option.scopeType === "business") ??
      null,
    [editableScopeOptions],
  );
  const editRoleAssignmentsError = useMemo(
    () =>
      canEditSelectedUserRoles
        ? validateRoleAssignmentDrafts(
            roleAssignmentsDraft,
            editableScopeOptions,
          )
        : null,
    [canEditSelectedUserRoles, editableScopeOptions, roleAssignmentsDraft],
  );
  const createRoleAssignmentsError = useMemo(
    () =>
      canCreateUsers
        ? validateRoleAssignmentDrafts(createRoleAssignmentsDraft, scopeOptions)
        : null,
    [canCreateUsers, createRoleAssignmentsDraft, scopeOptions],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser) return;
    setFeedback(null);

    try {
      if (canEditSelectedUserRoles && editRoleAssignmentsError) {
        setFeedback({ type: "error", message: editRoleAssignmentsError });
        return;
      }
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
              affiliation: formState.affiliation,
              dateOfBirth:
                trimmedDateOfBirth.length > 0 ? trimmedDateOfBirth : null,
            }
          : undefined,
        roleAssignments: canEditSelectedUserRoles
          ? serializeRoleAssignments(roleAssignmentsDraft)
          : undefined,
      });
      setFeedback({ type: "success", message: "User details updated" });
    } catch (error) {
      setFeedback({
        type: "error",
        message: (error as Error).message ?? "Failed to update user",
      });
    }
  };

  const handleReset = () => {
    if (!selectedUser) return;
    setFormState(buildFormStateFromUser(selectedUser));
    setRoleAssignmentsDraft(buildRoleAssignmentsDraftFromUser(selectedUser));
    setFeedback(null);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateUsers) return;
    setFeedback(null);

    try {
      if (createRoleAssignmentsError) {
        setFeedback({ type: "error", message: createRoleAssignmentsError });
        return;
      }
      const trimmedDateOfBirth = createFormState.dateOfBirth.trim();
      await createMutation.mutateAsync({
        username: createFormState.username.trim(),
        email: createFormState.email.trim(),
        password: createFormState.password,
        firstName: createFormState.firstName.trim(),
        lastName: createFormState.lastName.trim(),
        phoneNumber: createFormState.phoneNumber.trim(),
        affiliation: createFormState.affiliation,
        dateOfBirth:
          trimmedDateOfBirth.length > 0 ? trimmedDateOfBirth : undefined,
        roleAssignments: serializeRoleAssignments(createRoleAssignmentsDraft),
      });
      setIsCreateOpen(false);
      setCreateFormState(createDefaultCreateForm());
      setCreateRoleAssignmentsDraft([]);
      setFeedback({ type: "success", message: "User created" });
    } catch (error) {
      setFeedback({
        type: "error",
        message: (error as Error).message ?? "Failed to create user",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedUser || isSelfSelected || isDeactivated || !canCreateUsers)
      return;
    setFeedback(null);

    try {
      await deleteMutation.mutateAsync({ userId: selectedUser.id });
      setSelectedUserId(null);
      setIsDeleteOpen(false);
      setFeedback({ type: "success", message: "User deactivated" });
    } catch (error) {
      setFeedback({
        type: "error",
        message: (error as Error).message ?? "Failed to deactivate user",
      });
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
      setFeedback({
        type: "error",
        message: (error as Error).message ?? "Failed to add visibility grant",
      });
    }
  };

  const handleRemoveGrant = async (grantId: number) => {
    if (!canGrantVisibility) return;
    try {
      await removeGrantMutation.mutateAsync({ grantId });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          (error as Error).message ?? "Failed to remove visibility grant",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="border-outline-muted bg-surface-muted h-96 animate-pulse rounded-2xl border" />
        <div className="border-outline-muted bg-surface-muted h-96 animate-pulse rounded-2xl border" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="border-status-danger bg-status-danger-surface text-status-danger rounded-2xl border p-6 text-sm">
        Unable to load users. Please refresh.
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <section className="border-outline-muted bg-surface-raised flex flex-col rounded-2xl border p-6 shadow-[var(--shadow-pane)]">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-ink-primary text-lg font-semibold">
              User Directory
            </h2>
            <p className="text-ink-muted text-sm">
              Search, review, and select a user to manage their details.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="border-outline-muted bg-surface-muted flex w-full max-w-xs items-center gap-2 rounded-full border px-4 py-2">
              <SearchIcon className="text-ink-muted" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search users..."
                className="text-ink-primary placeholder:text-ink-faint flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setCreateFormState(createDefaultCreateForm());
                setCreateRoleAssignmentsDraft([
                  createRoleAssignmentDraft(scopeOptions, businessScopeOption, {
                    employeeOnly: canCreateEmployeeOnly,
                    allowAdminRoles: canAssignAdminRoles,
                  }),
                ]);
                setIsCreateOpen(true);
              }}
              disabled={!canCreateUsers}
              className="bg-accent-strong text-ink-inverted hover:bg-accent-default focus-visible:outline-accent-strong rounded-full px-4 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add user
            </button>
          </div>
        </header>

        <div className="border-outline-muted mt-6 overflow-x-auto rounded-2xl border">
          <table className="divide-outline-muted text-ink-primary min-w-full divide-y text-sm">
            <thead className="bg-surface-muted text-ink-muted text-left text-xs tracking-wide uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Name
                </th>
                <th scope="col" className="px-4 py-3">
                  Email
                </th>
                <th scope="col" className="px-4 py-3">
                  Role
                </th>
                <th scope="col" className="px-4 py-3">
                  Last Activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-outline-muted divide-y">
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
                      "hover:bg-accent-muted focus-visible:outline-accent-strong cursor-pointer transition focus-visible:outline focus-visible:outline-2 " +
                      (isActive ? "bg-accent-muted" : "")
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-ink-primary font-medium">
                          {resolveDisplayName(user)}
                        </span>
                        <span className="text-ink-faint text-xs">
                          Created {user.createdAt.toLocaleDateString()}
                        </span>
                        {!user.isActive ? (
                          <span className="text-status-danger text-xs font-semibold tracking-wide uppercase">
                            Deactivated
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-ink-subtle px-4 py-3">{user.email}</td>
                    <td className="text-ink-subtle px-4 py-3 capitalize">
                      {user.primaryRole
                        ? user.primaryRole.replace("_", " ")
                        : "Unassigned"}
                    </td>
                    <td className="text-ink-subtle px-4 py-3">
                      {formatDateCell(user.lastActivity)}
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-ink-muted px-4 py-6 text-center text-sm"
                  >
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
            className="border-outline-muted text-ink-subtle hover:bg-surface-muted focus-visible:outline-accent-strong rounded-full border px-4 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2"
          >
            Refresh list
          </button>
        </div>
      </section>

      <section className="border-outline-muted bg-surface-raised rounded-2xl border p-6 shadow-[var(--shadow-pane)]">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-ink-primary text-lg font-semibold">
              User Details
            </h2>
            <p className="text-ink-muted text-sm">
              Update profile information and role assignments.
            </p>
          </div>
        </header>

        {!selectedUser ? (
          <div className="border-outline-muted bg-surface-muted text-ink-muted mt-8 rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
            Select a user from the directory to edit their details.
          </div>
        ) : (
          <form className="mt-6 flex flex-col gap-6" onSubmit={handleSubmit}>
            <div className="grid gap-4">
              <label className="text-ink-primary flex flex-col gap-2 text-sm">
                <span>Display name</span>
                <input
                  value={formState.displayName}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      displayName: event.target.value,
                    }))
                  }
                  className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                  placeholder="Display name"
                  required
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>First name</span>
                  <input
                    value={formState.firstName}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        firstName: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    placeholder="First name"
                    required
                  />
                </label>
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Last name</span>
                  <input
                    value={formState.lastName}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        lastName: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    placeholder="Last name"
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Contact email</span>
                  <input
                    type="email"
                    value={formState.profileEmail}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        profileEmail: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    placeholder="user@example.com"
                    required
                  />
                </label>
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Phone number</span>
                  <input
                    value={formState.phoneNumber}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        phoneNumber: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    placeholder="+1 555 555 0101"
                    required
                  />
                </label>
              </div>
              <label className="text-ink-primary flex flex-col gap-2 text-sm md:max-w-[200px]">
                <span>Affiliation</span>
                <select
                  value={formState.affiliation}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      affiliation: event.target.value as "staff" | "faculty" | "student",
                    }))
                  }
                  className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                >
                  {profileAffiliationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-ink-primary flex flex-col gap-2 text-sm md:max-w-[200px]">
                <span>Date of birth</span>
                <input
                  type="date"
                  value={formState.dateOfBirth}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      dateOfBirth: event.target.value,
                    }))
                  }
                  className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                />
              </label>
            </div>

            <RoleAssignmentsEditor
              assignments={roleAssignmentsDraft}
              onChange={setRoleAssignmentsDraft}
              scopeOptions={editableScopeOptions}
              businessScopeOption={editableBusinessScopeOption}
              readOnly={!canEditSelectedUserRoles}
              allowAdminRoles={canAssignAdminRoles}
              allowScopeTransitions={canEditSelectedUserRoles}
              validationMessage={editRoleAssignmentsError}
            />
            {!canEditRoles ? (
              <p className="text-ink-muted text-xs">
                Role assignments can only be updated by business-scope admins.
              </p>
            ) : isSelfSelected ? (
              <p className="text-ink-muted text-xs">
                You cannot change your own role assignments.
              </p>
            ) : null}

            {canGrantVisibility ? (
              <div className="border-outline-muted bg-surface-muted rounded-2xl border p-4">
                <div className="text-ink-primary text-sm font-semibold">
                  Visibility grants
                </div>
                <p className="text-ink-muted mt-1 text-xs">
                  Give this user access to additional departments or divisions.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedUser.visibilityGrants.length === 0 ? (
                    <span className="text-ink-muted text-xs">
                      No visibility grants yet.
                    </span>
                  ) : (
                    selectedUser.visibilityGrants.map((grant) => (
                      <span
                        key={grant.id}
                        className="border-outline-muted bg-surface-muted text-ink-primary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                      >
                        <span>{grant.scopeLabel}</span>
                        <button
                          type="button"
                          className="text-ink-faint hover:text-status-danger transition"
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
                  <label className="text-ink-muted flex flex-col gap-2 text-xs">
                    <span>Scope</span>
                    <select
                      value={grantScopeKey}
                      onChange={(event) => setGrantScopeKey(event.target.value)}
                      className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                    >
                      <option value="">Select a scope</option>
                      {scopeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-ink-muted flex flex-col gap-2 text-xs">
                    <span>Reason (optional)</span>
                    <input
                      value={grantReason}
                      onChange={(event) => setGrantReason(event.target.value)}
                      className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                      placeholder="Reason for access"
                      maxLength={255}
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddGrant}
                      disabled={!grantScopeKey || addGrantMutation.isPending}
                      className="bg-accent-strong text-ink-inverted hover:bg-accent-default focus-visible:outline-accent-strong rounded-full px-4 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
                disabled={
                  mutation.isPending ||
                  (canEditSelectedUserRoles &&
                    Boolean(editRoleAssignmentsError))
                }
                className="bg-accent-strong text-ink-inverted hover:bg-accent-default focus-visible:outline-accent-strong rounded-full px-5 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mutation.isPending ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="border-outline-muted text-ink-subtle hover:bg-surface-muted focus-visible:outline-accent-strong rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setIsDeleteOpen(true)}
                disabled={
                  deleteMutation.isPending ||
                  isSelfSelected ||
                  isDeactivated ||
                  !canManageUsers
                }
                className="border-status-danger text-status-danger hover:bg-status-danger-surface focus-visible:outline-status-danger disabled:border-status-danger/50 disabled:text-status-danger/50 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending
                  ? "Deactivating..."
                  : "Deactivate user"}
              </button>
            </div>
            {isSelfSelected ? (
              <p className="text-ink-muted text-xs">
                You cannot deactivate your own account.
              </p>
            ) : null}
            {isDeactivated ? (
              <p className="text-ink-muted text-xs">
                This account is already deactivated.
              </p>
            ) : null}
            {!canManageUsers ? (
              <p className="text-ink-muted text-xs">
                You do not have access to manage users.
              </p>
            ) : !canCreateUsers ? (
              <p className="text-ink-muted text-xs">
                Only admins, co-admins, and managers can create or deactivate
                users.
              </p>
            ) : null}
          </form>
        )}
      </section>
      {isDeleteOpen && selectedUser ? (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center bg-[var(--color-overlay-backdrop)] px-4 py-8">
          <div className="border-outline-muted bg-surface-raised w-full max-w-md rounded-2xl border p-6 shadow-[var(--shadow-pane)]">
            <h3 className="text-ink-primary text-lg font-semibold">
              Deactivate user account
            </h3>
            <p className="text-ink-muted mt-2 text-sm">
              This will remove{" "}
              <span className="text-ink-primary font-semibold">
                {resolveDisplayName(selectedUser)}
              </span>{" "}
              from the platform while keeping their events and history intact.
            </p>
            <div className="border-status-danger/40 bg-status-danger-surface text-status-danger mt-4 rounded-xl border px-3 py-2 text-xs">
              They will no longer be able to sign in.
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsDeleteOpen(false)}
                className="border-outline-muted text-ink-subtle hover:bg-surface-muted focus-visible:outline-accent-strong rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="bg-status-danger hover:bg-status-danger/90 focus-visible:outline-status-danger rounded-full px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending
                  ? "Deactivating..."
                  : "Deactivate user"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isCreateOpen ? (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center bg-[var(--color-overlay-backdrop)] px-4 py-8">
          <div className="border-outline-muted bg-surface-raised max-h-[calc(100vh-4rem)] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-[var(--shadow-pane)]">
            <h3 className="text-ink-primary text-lg font-semibold">Add user</h3>
            <p className="text-ink-muted mt-2 text-sm">
              Create a new account with explicit role assignments.
            </p>
            <form className="mt-6 grid gap-4" onSubmit={handleCreate}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>First name</span>
                  <input
                    value={createFormState.firstName}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({
                        ...prev,
                        firstName: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary ring-accent-default/40 placeholder:text-ink-faint rounded-lg border px-3 py-2 text-sm outline-none focus:ring"
                    maxLength={100}
                    required
                  />
                </label>
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Last name</span>
                  <input
                    value={createFormState.lastName}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({
                        ...prev,
                        lastName: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary ring-accent-default/40 placeholder:text-ink-faint rounded-lg border px-3 py-2 text-sm outline-none focus:ring"
                    maxLength={100}
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Username</span>
                  <input
                    value={createFormState.username}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({
                        ...prev,
                        username: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary ring-accent-default/40 placeholder:text-ink-faint rounded-lg border px-3 py-2 text-sm outline-none focus:ring"
                    placeholder="yourname"
                    autoComplete="username"
                    minLength={3}
                    maxLength={50}
                    required
                  />
                </label>
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Email</span>
                  <input
                    type="email"
                    value={createFormState.email}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary ring-accent-default/40 placeholder:text-ink-faint rounded-lg border px-3 py-2 text-sm outline-none focus:ring"
                    placeholder="you@example.com"
                    autoComplete="email"
                    maxLength={255}
                    required
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Password</span>
                  <input
                    type="password"
                    value={createFormState.password}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary ring-accent-default/40 placeholder:text-ink-faint rounded-lg border px-3 py-2 text-sm outline-none focus:ring"
                    placeholder="Enter a strong password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
                <label className="text-ink-primary flex flex-col gap-2 text-sm">
                  <span>Phone number</span>
                  <input
                    value={createFormState.phoneNumber}
                    onChange={(event) =>
                      setCreateFormState((prev) => ({
                        ...prev,
                        phoneNumber: formatPhoneInput(event.target.value),
                      }))
                    }
                    className="border-outline-muted bg-surface-muted text-ink-primary ring-accent-default/40 placeholder:text-ink-faint rounded-lg border px-3 py-2 text-sm outline-none focus:ring"
                    placeholder="+1 555 555 0101"
                    maxLength={32}
                    required
                  />
                </label>
              </div>
              <label className="text-ink-primary flex flex-col gap-2 text-sm md:max-w-[220px]">
                <span>Affiliation</span>
                <select
                  value={createFormState.affiliation}
                  onChange={(event) =>
                    setCreateFormState((prev) => ({
                      ...prev,
                      affiliation: event.target.value as "staff" | "faculty" | "student",
                    }))
                  }
                  className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                >
                  {profileAffiliationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-ink-primary flex flex-col gap-2 text-sm md:max-w-[220px]">
                <span>Date of birth</span>
                <input
                  type="date"
                  value={createFormState.dateOfBirth}
                  onChange={(event) =>
                    setCreateFormState((prev) => ({
                      ...prev,
                      dateOfBirth: event.target.value,
                    }))
                  }
                  className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none"
                />
              </label>
              <RoleAssignmentsEditor
                assignments={createRoleAssignmentsDraft}
                onChange={setCreateRoleAssignmentsDraft}
                scopeOptions={scopeOptions}
                businessScopeOption={businessScopeOption}
                employeeOnly={canCreateEmployeeOnly}
                allowAdminRoles={canAssignAdminRoles}
                validationMessage={createRoleAssignmentsError}
              />
              <div className="mt-2 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setCreateFormState(createDefaultCreateForm());
                    setCreateRoleAssignmentsDraft([]);
                  }}
                  className="border-outline-muted text-ink-subtle hover:bg-surface-muted focus-visible:outline-accent-strong rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    createMutation.isPending ||
                    !canCreateUsers ||
                    Boolean(createRoleAssignmentsError)
                  }
                  className="bg-accent-strong text-ink-inverted hover:bg-accent-default focus-visible:outline-accent-strong rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
