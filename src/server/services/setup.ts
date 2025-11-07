import { eq, inArray, sql } from "drizzle-orm";

import type { db } from "~/server/db";
import {
  businesses,
  buildings,
  rooms,
  departments,
  organizationRoles,
  users,
  profiles,
} from "~/server/db/schema";

type DbClient = typeof db;
type BusinessRow = typeof businesses.$inferSelect;
type BuildingRow = typeof buildings.$inferSelect;
type RoomRow = typeof rooms.$inferSelect;
type DepartmentRow = typeof departments.$inferSelect;
type RoleRow = typeof organizationRoles.$inferSelect;

export type BuildingSummary = BuildingRow & {
  rooms: RoomRow[];
};

export type DepartmentNode = DepartmentRow & {
  children: DepartmentNode[];
  isDivision: boolean;
};

export type RoleSummary = {
  id: number;
  roleType: RoleRow["roleType"];
  scopeType: RoleRow["scopeType"];
  scopeId: number;
  userId: number;
  profileId: number;
  createdAt: RoleRow["createdAt"];
  updatedAt: RoleRow["updatedAt"];
  user: {
    id: number;
    username: string;
    displayName: string;
    email: string;
  } | null;
  profile: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  } | null;
  scopeLabel: string;
};

export type MissingAdminScope = {
  scopeType: RoleRow["scopeType"];
  scopeId: number;
  label: string;
};

export type SetupStatus = {
  needsSetup: boolean;
  databaseClean: boolean;
  business: BusinessRow | null;
  buildings: BuildingSummary[];
  departments: {
    roots: DepartmentNode[];
    flat: DepartmentNode[];
  };
  roles: RoleSummary[];
  missingAdmins: MissingAdminScope[];
  stepCompletion: {
    business: boolean;
    buildings: boolean;
    departments: boolean;
    users: boolean;
  };
  readyForCompletion: boolean;
};

function buildDepartmentTree(rows: DepartmentRow[]): DepartmentNode[] {
  const nodes = new Map<number, DepartmentNode>();
  rows.forEach((row) => {
    nodes.set(row.id, { ...row, children: [], isDivision: row.parentDepartmentId !== null });
  });

  const roots: DepartmentNode[] = [];
  nodes.forEach((node) => {
    if (node.parentDepartmentId) {
      const parent = nodes.get(node.parentDepartmentId);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export async function getSetupStatus(dbClient: DbClient): Promise<SetupStatus> {
  const [businessRow] = await dbClient.select().from(businesses).orderBy(businesses.id).limit(1);

  if (!businessRow) {
    const [buildingCount] = await dbClient.select({ count: sql<number>`count(*)` }).from(buildings);
    const [departmentCount] = await dbClient.select({ count: sql<number>`count(*)` }).from(departments);
    const [roleCount] = await dbClient.select({ count: sql<number>`count(*)` }).from(organizationRoles);
    // Convert to numbers since PostgreSQL count() returns bigint (may be string in JS)
    const buildingCountNum = Number(buildingCount?.count ?? 0);
    const departmentCountNum = Number(departmentCount?.count ?? 0);
    const roleCountNum = Number(roleCount?.count ?? 0);
    const databaseClean = buildingCountNum === 0 && departmentCountNum === 0 && roleCountNum === 0;
    return {
      needsSetup: true,
      databaseClean,
      business: null,
      buildings: [],
      departments: { roots: [], flat: [] },
      roles: [],
      missingAdmins: [],
      stepCompletion: {
        business: false,
        buildings: false,
        departments: false,
        users: false,
      },
      readyForCompletion: false,
    };
  }

  const buildingRows = await dbClient
    .select()
    .from(buildings)
    .where(eq(buildings.businessId, businessRow.id))
    .orderBy(buildings.name);
  const buildingIds = buildingRows.map((b) => b.id);
  const roomRows =
    buildingIds.length > 0
      ? await dbClient
          .select()
          .from(rooms)
          .where(inArray(rooms.buildingId, buildingIds))
          .orderBy(rooms.roomNumber)
      : [];

  const buildingSummaries: BuildingSummary[] = buildingRows.map((row) => ({
    ...row,
    rooms: roomRows.filter((room) => room.buildingId === row.id),
  }));

  const departmentRows = await dbClient
    .select()
    .from(departments)
    .where(eq(departments.businessId, businessRow.id))
    .orderBy(departments.name);
  const departmentTree = buildDepartmentTree(departmentRows);
  const departmentFlat = departmentRows.map((row) => ({
    ...row,
    children: [] as DepartmentNode[],
    isDivision: row.parentDepartmentId !== null,
  }));
  const departmentLookup = new Map<number, DepartmentNode>();
  departmentFlat.forEach((node) => departmentLookup.set(node.id, node));

  const roleRows = await dbClient
    .select({
      roleId: organizationRoles.id,
      roleType: organizationRoles.roleType,
      scopeType: organizationRoles.scopeType,
      scopeId: organizationRoles.scopeId,
      roleUserId: organizationRoles.userId,
      roleProfileId: organizationRoles.profileId,
      createdAt: organizationRoles.createdAt,
      updatedAt: organizationRoles.updatedAt,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      userEmail: users.email,
      profileId: profiles.id,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      profileEmail: profiles.email,
      phoneNumber: profiles.phoneNumber,
    })
    .from(organizationRoles)
    .leftJoin(users, eq(users.id, organizationRoles.userId))
    .leftJoin(profiles, eq(profiles.id, organizationRoles.profileId));

  const roles: RoleSummary[] = roleRows.map((row) => {
    const scopeLabel =
      row.scopeType === "business"
        ? businessRow.name
        : departmentLookup.get(row.scopeId)?.name ?? "Unassigned";
    return {
      id: row.roleId,
      roleType: row.roleType,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      userId: row.roleUserId,
      profileId: row.roleProfileId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: row.userId
        ? {
            id: row.userId,
            username: row.username ?? "",
            displayName: row.displayName ?? "",
            email: row.userEmail ?? "",
          }
        : null,
      profile: row.profileId
        ? {
            id: row.profileId,
            firstName: row.firstName ?? "",
            lastName: row.lastName ?? "",
            email: row.profileEmail ?? "",
            phoneNumber: row.phoneNumber ?? "",
          }
        : null,
      scopeLabel,
    };
  });

  const scopeKey = (scopeType: RoleRow["scopeType"], scopeId: number) => `${scopeType}:${scopeId}`;
  const roleMap = new Map<string, RoleSummary[]>();
  roles.forEach((role) => {
    const key = scopeKey(role.scopeType, role.scopeId);
    const bucket = roleMap.get(key);
    if (bucket) bucket.push(role);
    else roleMap.set(key, [role]);
  });

  const missingAdmins: MissingAdminScope[] = [];
  const ensureAdmin = (scopeType: RoleRow["scopeType"], scopeId: number, label: string) => {
    const key = scopeKey(scopeType, scopeId);
    const bucket = roleMap.get(key) ?? [];
    const hasAdmin = bucket.some((role) => role.roleType === "admin");
    if (!hasAdmin) {
      missingAdmins.push({ scopeType, scopeId, label });
    }
  };

  ensureAdmin("business", businessRow.id, businessRow.name);
  departmentFlat.forEach((dept) => {
    if (dept.parentDepartmentId === null) {
      ensureAdmin("department", dept.id, dept.name);
    } else {
      ensureAdmin("division", dept.id, dept.name);
    }
  });

  const stepCompletion = {
    business: true,
    buildings: buildingSummaries.length > 0,
    departments: departmentFlat.length > 0,
    users: roles.length > 0 && missingAdmins.length === 0,
  };

  return {
    needsSetup: !businessRow.setupCompletedAt,
    databaseClean: false,
    business: businessRow,
    buildings: buildingSummaries,
    departments: {
      roots: departmentTree,
      flat: departmentFlat,
    },
    roles,
    missingAdmins,
    stepCompletion,
    readyForCompletion:
      stepCompletion.business &&
      stepCompletion.buildings &&
      stepCompletion.departments &&
      missingAdmins.length === 0,
  };
}

export async function needsInitialSetup(dbClient: DbClient) {
  const status = await getSetupStatus(dbClient);
  return status.needsSetup;
}
