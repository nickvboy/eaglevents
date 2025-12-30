import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import type { Session } from "next-auth";

import {
  businesses,
  departments,
  organizationRoles,
  profiles,
  visibilityGrants,
} from "~/server/db/schema";
import type { db } from "~/server/db";

export type DbClient = typeof db;
export type RoleType = typeof organizationRoles.$inferSelect["roleType"];
export type ScopeType = typeof organizationRoles.$inferSelect["scopeType"];

export type RoleAssignment = {
  roleType: RoleType;
  scopeType: ScopeType;
  scopeId: number;
};

export type VisibilityGrant = {
  scopeType: ScopeType;
  scopeId: number;
};

export type VisibleScopes = {
  business: boolean;
  departmentIds: number[];
  divisionIds: number[];
};

export type ScopeOption = {
  scopeType: ScopeType;
  scopeId: number;
  label: string;
};

export type AdminCapability =
  | "dashboard:view"
  | "company:manage"
  | "users:manage"
  | "reports:view"
  | "import_export:manage"
  | "database:manage"
  | "roles:assign_admin"
  | "visibility_grants:manage";

export type PermissionContext = {
  userId: number;
  profileId: number | null;
  roles: RoleAssignment[];
  grants: VisibilityGrant[];
  businessId: number | null;
  capabilities: AdminCapability[];
  primaryRole: RoleType | null;
};

const rolePriority: Record<RoleType, number> = {
  admin: 4,
  co_admin: 3,
  manager: 2,
  employee: 1,
};

const ADMIN_CAPABILITIES: AdminCapability[] = [
  "dashboard:view",
  "company:manage",
  "users:manage",
  "reports:view",
  "import_export:manage",
  "database:manage",
  "roles:assign_admin",
  "visibility_grants:manage",
];

const CO_ADMIN_CAPABILITIES: AdminCapability[] = ADMIN_CAPABILITIES;

const MANAGER_CAPABILITIES: AdminCapability[] = [
  "dashboard:view",
  "users:manage",
  "reports:view",
];

const EMPLOYEE_CAPABILITIES: AdminCapability[] = [
  "dashboard:view",
];

export async function getBusinessId(dbClient: DbClient) {
  const [business] = await dbClient.select({ id: businesses.id }).from(businesses).orderBy(businesses.id).limit(1);
  return business?.id ?? null;
}

export function getSessionUserId(session: Session | null | undefined) {
  const userIdRaw = session?.user?.id;
  if (!userIdRaw) return null;
  const userId = Number(userIdRaw);
  return Number.isFinite(userId) ? userId : null;
}

export function requireSessionUserId(session: Session | null | undefined) {
  const userId = getSessionUserId(session);
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in to access this area." });
  }
  return userId;
}

export async function getSessionProfileId(dbClient: DbClient, session: Session | null | undefined) {
  const userId = getSessionUserId(session);
  if (!userId) return null;
  const [row] = await dbClient
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

export async function fetchUserRoles(dbClient: DbClient, userId: number): Promise<RoleAssignment[]> {
  return dbClient
    .select({
      roleType: organizationRoles.roleType,
      scopeType: organizationRoles.scopeType,
      scopeId: organizationRoles.scopeId,
    })
    .from(organizationRoles)
    .where(eq(organizationRoles.userId, userId));
}

export async function fetchVisibilityGrants(dbClient: DbClient, userId: number): Promise<VisibilityGrant[]> {
  return dbClient
    .select({
      scopeType: visibilityGrants.scopeType,
      scopeId: visibilityGrants.scopeId,
    })
    .from(visibilityGrants)
    .where(eq(visibilityGrants.userId, userId));
}

export function getPrimaryRole(roles: RoleAssignment[]): RoleType | null {
  if (roles.length === 0) return null;
  return roles
    .slice()
    .sort((a, b) => (rolePriority[b.roleType] ?? 0) - (rolePriority[a.roleType] ?? 0))[0]?.roleType ?? null;
}

export function buildAdminCapabilities(roles: RoleAssignment[]): AdminCapability[] {
  const hasBusinessAdmin = roles.some((role) => role.roleType === "admin" && role.scopeType === "business");
  if (hasBusinessAdmin) return ADMIN_CAPABILITIES.slice();

  const hasBusinessCoAdmin = roles.some((role) => role.roleType === "co_admin" && role.scopeType === "business");
  if (hasBusinessCoAdmin) return CO_ADMIN_CAPABILITIES.slice();

  const hasManager = roles.some((role) => role.roleType === "manager");
  if (hasManager) return MANAGER_CAPABILITIES.slice();

  const hasEmployee = roles.some((role) => role.roleType === "employee");
  if (hasEmployee) return EMPLOYEE_CAPABILITIES.slice();

  return [];
}

export async function getPermissionContext(
  dbClient: DbClient,
  session: Session | null | undefined,
): Promise<PermissionContext> {
  const userId = requireSessionUserId(session);
  const [roles, grants, profileId, businessId] = await Promise.all([
    fetchUserRoles(dbClient, userId),
    fetchVisibilityGrants(dbClient, userId),
    getSessionProfileId(dbClient, session),
    getBusinessId(dbClient),
  ]);
  const capabilities = buildAdminCapabilities(roles);
  const primaryRole = getPrimaryRole(roles);
  return {
    userId,
    profileId,
    roles,
    grants,
    businessId,
    capabilities,
    primaryRole,
  };
}

export async function getOptionalPermissionContext(
  dbClient: DbClient,
  session: Session | null | undefined,
): Promise<PermissionContext | null> {
  const userId = getSessionUserId(session);
  if (!userId) return null;
  const [roles, grants, profileId, businessId] = await Promise.all([
    fetchUserRoles(dbClient, userId),
    fetchVisibilityGrants(dbClient, userId),
    getSessionProfileId(dbClient, session),
    getBusinessId(dbClient),
  ]);
  return {
    userId,
    profileId,
    roles,
    grants,
    businessId,
    capabilities: buildAdminCapabilities(roles),
    primaryRole: getPrimaryRole(roles),
  };
}

export async function requireAdminCapability(
  dbClient: DbClient,
  session: Session | null | undefined,
  capability: AdminCapability,
) {
  const context = await getPermissionContext(dbClient, session);
  if (!context.capabilities.includes(capability)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this admin area." });
  }
  return context;
}

type DepartmentRow = { id: number; parentDepartmentId: number | null; name: string };

type DepartmentTree = {
  byId: Map<number, DepartmentRow>;
  children: Map<number, number[]>;
};

async function fetchDepartmentTree(dbClient: DbClient, businessId: number): Promise<DepartmentTree> {
  const rows = await dbClient
    .select({ id: departments.id, parentDepartmentId: departments.parentDepartmentId, name: departments.name })
    .from(departments)
    .where(eq(departments.businessId, businessId));
  const byId = new Map<number, DepartmentRow>();
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const entry = { id: row.id, parentDepartmentId: row.parentDepartmentId ?? null, name: row.name };
    byId.set(entry.id, entry);
    if (entry.parentDepartmentId !== null) {
      const list = children.get(entry.parentDepartmentId) ?? [];
      list.push(entry.id);
      children.set(entry.parentDepartmentId, list);
    }
  }
  return { byId, children };
}

function collectDescendants(startId: number, tree: DepartmentTree) {
  const descendants: number[] = [];
  const stack = [...(tree.children.get(startId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    descendants.push(id);
    const next = tree.children.get(id);
    if (next && next.length > 0) {
      stack.push(...next);
    }
  }
  return descendants;
}

export async function getVisibleScopes(dbClient: DbClient, userId: number): Promise<VisibleScopes> {
  const [roles, grants, businessId] = await Promise.all([
    fetchUserRoles(dbClient, userId),
    fetchVisibilityGrants(dbClient, userId),
    getBusinessId(dbClient),
  ]);
  const assignments = [...roles, ...grants];
  const businessFromRoles = roles.some(
    (role) =>
      role.scopeType === "business" && (role.roleType === "admin" || role.roleType === "co_admin"),
  );
  const businessFromGrants = grants.some((grant) => grant.scopeType === "business");
  const business = businessFromRoles || businessFromGrants;
  const departmentIds = new Set<number>();
  const divisionIds = new Set<number>();

  if (businessId) {
    const tree = await fetchDepartmentTree(dbClient, businessId);
    for (const assignment of assignments) {
      if (assignment.scopeType === "department") {
        departmentIds.add(assignment.scopeId);
        const descendants = collectDescendants(assignment.scopeId, tree);
        for (const id of descendants) divisionIds.add(id);
      } else if (assignment.scopeType === "division") {
        divisionIds.add(assignment.scopeId);
      }
    }
  }

  return {
    business,
    departmentIds: Array.from(departmentIds),
    divisionIds: Array.from(divisionIds),
  };
}

export async function getCreatableScopeOptions(dbClient: DbClient, userId: number): Promise<ScopeOption[]> {
  const [roles, businessId] = await Promise.all([fetchUserRoles(dbClient, userId), getBusinessId(dbClient)]);
  if (!businessId) return [];

  const tree = await fetchDepartmentTree(dbClient, businessId);
  const [business] = await dbClient
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  const options = new Map<string, ScopeOption>();
  const addOption = (scopeType: ScopeType, scopeId: number, label: string) => {
    const key = `${scopeType}:${scopeId}`;
    if (!options.has(key)) {
      options.set(key, { scopeType, scopeId, label });
    }
  };

  const addDepartmentWithDivisions = (departmentId: number) => {
    const department = tree.byId.get(departmentId);
    if (department) {
      addOption("department", department.id, `${department.name} (Department)`);
      const descendants = collectDescendants(department.id, tree);
      for (const id of descendants) {
        const child = tree.byId.get(id);
        if (child) addOption("division", child.id, `${child.name} (Division)`);
      }
    }
  };

  for (const role of roles) {
    if (role.scopeType === "business") {
      if (business) addOption("business", business.id, `${business.name} (Business)`);
      for (const dept of tree.byId.values()) {
        if (dept.parentDepartmentId === null) {
          addOption("department", dept.id, `${dept.name} (Department)`);
          const descendants = collectDescendants(dept.id, tree);
          for (const id of descendants) {
            const child = tree.byId.get(id);
            if (child) addOption("division", child.id, `${child.name} (Division)`);
          }
        }
      }
    } else if (role.scopeType === "department") {
      addDepartmentWithDivisions(role.scopeId);
    } else if (role.scopeType === "division") {
      const division = tree.byId.get(role.scopeId);
      if (division) addOption("division", division.id, `${division.name} (Division)`);
    }
  }

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export async function canAssignRole(
  dbClient: DbClient,
  session: Session | null | undefined,
  targetRole: RoleType,
) {
  const context = await getPermissionContext(dbClient, session);
  const isAdmin = context.roles.some((role) => role.roleType === "admin" && role.scopeType === "business");
  const isCoAdmin = context.roles.some((role) => role.roleType === "co_admin" && role.scopeType === "business");
  const isManager = context.roles.some((role) => role.roleType === "manager");

  if (targetRole === "admin") return isAdmin || isCoAdmin;
  if (targetRole === "co_admin") return isAdmin || isCoAdmin;
  if (targetRole === "manager") return isAdmin || isCoAdmin;
  if (targetRole === "employee") return isAdmin || isCoAdmin || isManager;
  return false;
}

export async function getAllowedUserScopeIds(dbClient: DbClient, userId: number) {
  const visible = await getVisibleScopes(dbClient, userId);
  const departmentIds = new Set<number>(visible.departmentIds);
  const divisionIds = new Set<number>(visible.divisionIds);
  return {
    business: visible.business,
    departmentIds,
    divisionIds,
  };
}

export async function getUsersInScopes(dbClient: DbClient, scopeIds: { departmentIds: number[]; divisionIds: number[] }) {
  const scopeConditions: any[] = [];
  if (scopeIds.departmentIds.length > 0) {
    scopeConditions.push(and(eq(organizationRoles.scopeType, "department"), inArray(organizationRoles.scopeId, scopeIds.departmentIds)));
  }
  if (scopeIds.divisionIds.length > 0) {
    scopeConditions.push(and(eq(organizationRoles.scopeType, "division"), inArray(organizationRoles.scopeId, scopeIds.divisionIds)));
  }
  if (scopeConditions.length === 0) return [];

  let condition = scopeConditions[0]!;
  for (let i = 1; i < scopeConditions.length; i += 1) {
    condition = or(condition, scopeConditions[i]!);
  }

  const rows = await dbClient
    .select({ userId: organizationRoles.userId })
    .from(organizationRoles)
    .where(condition);
  return Array.from(new Set(rows.map((row) => row.userId)));
}
