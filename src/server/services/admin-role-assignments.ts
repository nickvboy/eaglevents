import { TRPCError } from "@trpc/server";

export type RequestedRoleAssignment = {
  roleType: "admin" | "co_admin" | "manager" | "employee";
  scopeType: "business" | "department" | "division";
  scopeId: number;
};

export type DepartmentScopeRecord = {
  id: number;
  parentDepartmentId: number | null;
  businessId: number;
};

export type ScopedVisibility = {
  departmentIds: number[];
  divisionIds: number[];
} | null;

const roleSortOrder: Record<RequestedRoleAssignment["roleType"], number> = {
  admin: 0,
  co_admin: 1,
  manager: 2,
  employee: 3,
};

const scopeSortOrder: Record<RequestedRoleAssignment["scopeType"], number> = {
  business: 0,
  department: 1,
  division: 2,
};

export function hasBusinessAdminAssignment(
  assignments: RequestedRoleAssignment[],
) {
  return assignments.some(
    (assignment) =>
      assignment.roleType === "admin" && assignment.scopeType === "business",
  );
}

export function assertBusinessAdminCoverage(options: {
  targetUserId: number;
  nextAssignments: RequestedRoleAssignment[];
  existingBusinessAdminUserIds: number[];
}) {
  if (hasBusinessAdminAssignment(options.nextAssignments)) return;

  const remainingAdminIds = new Set(options.existingBusinessAdminUserIds);
  remainingAdminIds.delete(options.targetUserId);
  if (remainingAdminIds.size === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "At least one business admin must remain assigned to the business scope.",
    });
  }
}

export function validateRequestedRoleAssignments(
  assignments: RequestedRoleAssignment[],
  options: {
    businessId: number;
    isManagerOnly: boolean;
    visibleScopes: ScopedVisibility;
    departmentRows: DepartmentScopeRecord[];
  },
) {
  if (assignments.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one role assignment is required.",
    });
  }

  const seen = new Set<string>();
  const departmentMap = new Map(
    options.departmentRows.map((row) => [row.id, row]),
  );
  const allowedDepartments = new Set(
    options.visibleScopes?.departmentIds ?? [],
  );
  const allowedDivisions = new Set(options.visibleScopes?.divisionIds ?? []);
  const normalized: RequestedRoleAssignment[] = [];

  for (const assignment of assignments) {
    const key = `${assignment.roleType}:${assignment.scopeType}:${assignment.scopeId}`;
    if (seen.has(key)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Duplicate role assignments are not allowed.",
      });
    }
    seen.add(key);

    if (options.isManagerOnly && assignment.roleType !== "employee") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Managers can only assign employee roles.",
      });
    }

    if (assignment.roleType === "admin" || assignment.roleType === "co_admin") {
      if (assignment.scopeType !== "business") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Administrators and co-admins must be assigned to the business scope.",
        });
      }
      if (assignment.scopeId !== options.businessId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Business scope must match the current business.",
        });
      }
      normalized.push(assignment);
      continue;
    }

    if (assignment.scopeType === "business") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Managers and employees must be assigned to a department or division.",
      });
    }

    const departmentRow = departmentMap.get(assignment.scopeId);
    if (!departmentRow || departmentRow.businessId !== options.businessId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Department scope not found.",
      });
    }

    const isDivision = departmentRow.parentDepartmentId !== null;
    if (assignment.scopeType === "department" && isDivision) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Scope is a division, not a department.",
      });
    }
    if (assignment.scopeType === "division" && !isDivision) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Scope is a department, not a division.",
      });
    }

    if (options.isManagerOnly) {
      if (
        assignment.scopeType === "department" &&
        !allowedDepartments.has(assignment.scopeId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot assign users outside your departments.",
        });
      }
      if (
        assignment.scopeType === "division" &&
        !allowedDivisions.has(assignment.scopeId)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot assign users outside your divisions.",
        });
      }
    }

    normalized.push(assignment);
  }

  return normalized.sort((a, b) => {
    const scopeDiff =
      (scopeSortOrder[a.scopeType] ?? 0) - (scopeSortOrder[b.scopeType] ?? 0);
    if (scopeDiff !== 0) return scopeDiff;
    const idDiff = a.scopeId - b.scopeId;
    if (idDiff !== 0) return idDiff;
    return (roleSortOrder[a.roleType] ?? 0) - (roleSortOrder[b.roleType] ?? 0);
  });
}
