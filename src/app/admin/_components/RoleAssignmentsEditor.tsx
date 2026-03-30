"use client";

import { useEffect } from "react";

import { XIcon } from "~/app/_components/icons";

export type RoleOption = "admin" | "co_admin" | "manager" | "employee";
export type ScopeOption = "business" | "department" | "division";

export type RoleAssignmentDraft = {
  id: string;
  roleType: RoleOption;
  scopeKey: string;
};

export type RoleScopeOption = {
  value: string;
  label: string;
  scopeType: ScopeOption;
  scopeId: number;
};

type RoleAssignmentsEditorProps = {
  assignments: RoleAssignmentDraft[];
  onChange: (next: RoleAssignmentDraft[]) => void;
  scopeOptions: RoleScopeOption[];
  businessScopeOption: RoleScopeOption | null;
  readOnly?: boolean;
  employeeOnly?: boolean;
  allowAdminRoles?: boolean;
  allowScopeTransitions?: boolean;
  validationMessage?: string | null;
};

let assignmentDraftCounter = 0;
const allRoleOptions = [
  { value: "admin", label: "Administrator" },
  { value: "co_admin", label: "Co-admin" },
  { value: "manager", label: "Manager" },
  { value: "employee", label: "Employee" },
] as const;

export function createRoleAssignmentDraft(
  scopeOptions: RoleScopeOption[],
  businessScopeOption: RoleScopeOption | null,
  options: {
    employeeOnly?: boolean;
    allowAdminRoles?: boolean;
  } = {},
): RoleAssignmentDraft {
  assignmentDraftCounter += 1;
  const roleType = resolveDefaultRoleType(
    scopeOptions,
    businessScopeOption,
    options,
  );
  const allowedScopes = getAllowedScopes(
    roleType,
    scopeOptions,
    businessScopeOption,
  );
  return {
    id: `assignment-${assignmentDraftCounter}`,
    roleType,
    scopeKey: allowedScopes[0]?.value ?? "",
  };
}

function resolveDefaultRoleType(
  scopeOptions: RoleScopeOption[],
  businessScopeOption: RoleScopeOption | null,
  options: {
    employeeOnly?: boolean;
    allowAdminRoles?: boolean;
  },
): RoleOption {
  if (options.employeeOnly) return "employee";
  const hasScopedOptions = scopeOptions.some(
    (option) => option.scopeType !== "business",
  );
  if (hasScopedOptions) return "manager";
  if (options.allowAdminRoles && businessScopeOption) return "admin";
  return "employee";
}

function isBusinessRole(roleType: RoleOption) {
  return roleType === "admin" || roleType === "co_admin";
}

function getAllowedScopes(
  roleType: RoleOption,
  scopeOptions: RoleScopeOption[],
  businessScopeOption: RoleScopeOption | null,
  options: { allowScopeTransitions?: boolean } = {},
) {
  if (options.allowScopeTransitions) {
    return scopeOptions;
  }
  if (isBusinessRole(roleType)) {
    return businessScopeOption ? [businessScopeOption] : [];
  }
  return scopeOptions.filter((option) => option.scopeType !== "business");
}

function getAllowedRoleOptions(options: {
  employeeOnly?: boolean;
  allowAdminRoles?: boolean;
}) {
  if (options.employeeOnly) {
    return [{ value: "employee", label: "Employee" }] as const;
  }

  const base = [
    { value: "manager", label: "Manager" },
    { value: "employee", label: "Employee" },
  ] as const;

  if (!options.allowAdminRoles) return base;
  return [
    { value: "admin", label: "Administrator" },
    { value: "co_admin", label: "Co-admin" },
    ...base,
  ] as const;
}

function arraysMatch(
  left: RoleAssignmentDraft[],
  right: RoleAssignmentDraft[],
) {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return (
        other &&
        entry.id === other.id &&
        entry.roleType === other.roleType &&
        entry.scopeKey === other.scopeKey
      );
    })
  );
}

function normalizeAssignments(
  assignments: RoleAssignmentDraft[],
  scopeOptions: RoleScopeOption[],
  businessScopeOption: RoleScopeOption | null,
  options: {
    employeeOnly?: boolean;
    allowAdminRoles?: boolean;
    allowScopeTransitions?: boolean;
  },
) {
  return assignments.map((assignment) => {
    let roleType = assignment.roleType;
    const selectedScope = scopeOptions.find(
      (option) => option.value === assignment.scopeKey,
    );
    if (
      options.allowScopeTransitions &&
      isBusinessRole(roleType) &&
      selectedScope &&
      selectedScope.scopeType !== "business"
    ) {
      roleType = "manager";
    } else if (
      options.allowScopeTransitions &&
      !isBusinessRole(roleType) &&
      selectedScope?.scopeType === "business" &&
      options.allowAdminRoles
    ) {
      roleType = "admin";
    }
    if (options.employeeOnly) {
      roleType = "employee";
    } else if (!options.allowAdminRoles && isBusinessRole(roleType)) {
      roleType = "manager";
    }

    const allowedScopes = getAllowedScopes(
      roleType,
      scopeOptions,
      businessScopeOption,
      { allowScopeTransitions: options.allowScopeTransitions },
    );
    let scopeKey = assignment.scopeKey;
    if (!allowedScopes.some((option) => option.value === scopeKey)) {
      scopeKey = allowedScopes[0]?.value ?? "";
    }

    return {
      ...assignment,
      roleType,
      scopeKey,
    };
  });
}

export function RoleAssignmentsEditor({
  assignments,
  onChange,
  scopeOptions,
  businessScopeOption,
  readOnly = false,
  employeeOnly = false,
  allowAdminRoles = false,
  allowScopeTransitions = false,
  validationMessage,
}: RoleAssignmentsEditorProps) {
  useEffect(() => {
    if (readOnly) return;
    const normalized = normalizeAssignments(
      assignments,
      scopeOptions,
      businessScopeOption,
      {
        employeeOnly,
        allowAdminRoles,
        allowScopeTransitions,
      },
    );
    if (!arraysMatch(assignments, normalized)) {
      onChange(normalized);
    }
  }, [
    allowAdminRoles,
    assignments,
    businessScopeOption,
    employeeOnly,
    onChange,
    readOnly,
    scopeOptions,
    allowScopeTransitions,
  ]);

  const roleOptions = readOnly
    ? allRoleOptions
    : getAllowedRoleOptions({ employeeOnly, allowAdminRoles });

  return (
    <div className="border-outline-muted bg-surface-muted rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-ink-primary text-sm font-semibold">
            Role assignments
          </div>
          <p className="text-ink-muted mt-1 text-xs">
            Assign explicit roles to the business, departments, or divisions.
            {allowScopeTransitions
              ? " Selecting business scope promotes a row to admin, and selecting a lower scope on an admin row demotes it to manager."
              : ""}
          </p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={() =>
              onChange([
                ...assignments,
                createRoleAssignmentDraft(scopeOptions, businessScopeOption, {
                  employeeOnly,
                  allowAdminRoles,
                }),
              ])
            }
            className="border-outline-muted text-ink-subtle hover:bg-surface-raised focus-visible:outline-accent-strong rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Add assignment
          </button>
        ) : null}
      </div>

      {assignments.length === 0 ? (
        <div className="border-outline-muted text-ink-muted mt-4 rounded-xl border border-dashed px-3 py-4 text-xs">
          No role assignments yet.
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {assignments.map((assignment) => {
            const allowedScopes = getAllowedScopes(
              assignment.roleType,
              scopeOptions,
              businessScopeOption,
              { allowScopeTransitions: !readOnly && allowScopeTransitions },
            );
            const scopeDisabled = readOnly || allowedScopes.length <= 1;
            const removeDisabled = readOnly;

            return (
              <div
                key={assignment.id}
                className="border-outline-muted bg-surface-raised grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_auto]"
              >
                <label className="text-ink-muted flex flex-col gap-2 text-xs">
                  <span>Role</span>
                  <select
                    value={assignment.roleType}
                    onChange={(event) => {
                      const roleType = event.target.value as RoleOption;
                      const nextScopes = getAllowedScopes(
                        roleType,
                        scopeOptions,
                        businessScopeOption,
                        {
                          allowScopeTransitions:
                            !readOnly && allowScopeTransitions,
                        },
                      );
                      onChange(
                        assignments.map((entry) =>
                          entry.id === assignment.id
                            ? {
                                ...entry,
                                roleType,
                                scopeKey: isBusinessRole(roleType)
                                  ? (businessScopeOption?.value ?? "")
                                  : nextScopes.some(
                                        (option) =>
                                          option.value === entry.scopeKey,
                                      )
                                    ? entry.scopeKey
                                    : (nextScopes[0]?.value ?? ""),
                              }
                            : entry,
                        ),
                      );
                    }}
                    disabled={readOnly}
                    className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-ink-muted flex flex-col gap-2 text-xs">
                  <span>Scope</span>
                  <select
                    value={assignment.scopeKey}
                    onChange={(event) => {
                      const nextScopeKey = event.target.value;
                      const nextScope = scopeOptions.find(
                        (option) => option.value === nextScopeKey,
                      );
                      onChange(
                        assignments.map((entry) => {
                          if (entry.id !== assignment.id) return entry;
                          if (
                            allowScopeTransitions &&
                            nextScope &&
                            nextScope.scopeType !== "business" &&
                            isBusinessRole(entry.roleType)
                          ) {
                            return {
                              ...entry,
                              roleType: "manager",
                              scopeKey: nextScopeKey,
                            };
                          }
                          if (
                            allowScopeTransitions &&
                            nextScope?.scopeType === "business" &&
                            !isBusinessRole(entry.roleType) &&
                            allowAdminRoles
                          ) {
                            return {
                              ...entry,
                              roleType: "admin",
                              scopeKey: nextScopeKey,
                            };
                          }
                          return { ...entry, scopeKey: nextScopeKey };
                        }),
                      );
                    }}
                    disabled={scopeDisabled}
                    className="border-outline-muted bg-surface-muted text-ink-primary focus:border-outline-accent rounded-lg border px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {allowedScopes.length === 0 ? (
                      <option value="">No scopes available</option>
                    ) : null}
                    {allowedScopes.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-ink-faint text-[11px]">
                    {isBusinessRole(assignment.roleType)
                      ? allowScopeTransitions
                        ? "Choose a department or division here to demote this row into a manager assignment."
                        : "Admins and co-admins are assigned to the full business scope."
                      : allowScopeTransitions
                        ? "Choose the business scope here to promote this row into an admin assignment."
                        : "Managers and employees can be assigned to departments or divisions."}
                  </span>
                </label>

                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      onChange(
                        assignments.filter(
                          (entry) => entry.id !== assignment.id,
                        ),
                      )
                    }
                    disabled={removeDisabled}
                    className="border-outline-muted text-ink-faint hover:border-status-danger hover:text-status-danger focus-visible:outline-status-danger inline-flex h-10 w-10 items-center justify-center rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Remove role assignment"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {validationMessage ? (
        <div className="border-status-danger bg-status-danger-surface text-status-danger mt-3 rounded-xl border px-3 py-2 text-xs">
          {validationMessage}
        </div>
      ) : null}
    </div>
  );
}
