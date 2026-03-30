import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { TRPCError } from "@trpc/server";

import {
  assertBusinessAdminCoverage,
  validateRequestedRoleAssignments,
} from "~/server/services/admin-role-assignments";

void describe("admin role assignment validation", () => {
  void it("sorts valid assignments consistently", () => {
    const result = validateRequestedRoleAssignments(
      [
        { roleType: "employee", scopeType: "division", scopeId: 7 },
        { roleType: "admin", scopeType: "business", scopeId: 1 },
        { roleType: "manager", scopeType: "department", scopeId: 3 },
      ],
      {
        businessId: 1,
        isManagerOnly: false,
        visibleScopes: null,
        departmentRows: [
          { id: 3, parentDepartmentId: null, businessId: 1 },
          { id: 7, parentDepartmentId: 3, businessId: 1 },
        ],
      },
    );

    assert.deepEqual(result, [
      { roleType: "admin", scopeType: "business", scopeId: 1 },
      { roleType: "manager", scopeType: "department", scopeId: 3 },
      { roleType: "employee", scopeType: "division", scopeId: 7 },
    ]);
  });

  void it("rejects duplicate assignment rows", () => {
    assert.throws(
      () =>
        validateRequestedRoleAssignments(
          [
            { roleType: "employee", scopeType: "division", scopeId: 7 },
            { roleType: "employee", scopeType: "division", scopeId: 7 },
          ],
          {
            businessId: 1,
            isManagerOnly: false,
            visibleScopes: null,
            departmentRows: [{ id: 7, parentDepartmentId: 3, businessId: 1 }],
          },
        ),
      (error) =>
        error instanceof TRPCError &&
        error.code === "BAD_REQUEST" &&
        error.message === "Duplicate role assignments are not allowed.",
    );
  });

  void it("rejects admin roles outside the business scope", () => {
    assert.throws(
      () =>
        validateRequestedRoleAssignments(
          [{ roleType: "admin", scopeType: "department", scopeId: 3 }],
          {
            businessId: 1,
            isManagerOnly: false,
            visibleScopes: null,
            departmentRows: [
              { id: 3, parentDepartmentId: null, businessId: 1 },
            ],
          },
        ),
      (error) =>
        error instanceof TRPCError &&
        error.code === "BAD_REQUEST" &&
        error.message ===
          "Administrators and co-admins must be assigned to the business scope.",
    );
  });

  void it("rejects manager-only actors assigning users outside their visible scope", () => {
    assert.throws(
      () =>
        validateRequestedRoleAssignments(
          [{ roleType: "employee", scopeType: "division", scopeId: 7 }],
          {
            businessId: 1,
            isManagerOnly: true,
            visibleScopes: { departmentIds: [3], divisionIds: [] },
            departmentRows: [{ id: 7, parentDepartmentId: 3, businessId: 1 }],
          },
        ),
      (error) =>
        error instanceof TRPCError &&
        error.code === "FORBIDDEN" &&
        error.message === "You cannot assign users outside your divisions.",
    );
  });

  void it("allows manager-only actors to assign employee roles inside their scope", () => {
    const result = validateRequestedRoleAssignments(
      [{ roleType: "employee", scopeType: "department", scopeId: 3 }],
      {
        businessId: 1,
        isManagerOnly: true,
        visibleScopes: { departmentIds: [3], divisionIds: [7] },
        departmentRows: [{ id: 3, parentDepartmentId: null, businessId: 1 }],
      },
    );

    assert.deepEqual(result, [
      { roleType: "employee", scopeType: "department", scopeId: 3 },
    ]);
  });

  void it("rejects removing the last business admin from the business scope", () => {
    assert.throws(
      () =>
        assertBusinessAdminCoverage({
          targetUserId: 10,
          nextAssignments: [
            { roleType: "manager", scopeType: "department", scopeId: 3 },
          ],
          existingBusinessAdminUserIds: [10],
        }),
      (error) =>
        error instanceof TRPCError &&
        error.code === "BAD_REQUEST" &&
        error.message ===
          "At least one business admin must remain assigned to the business scope.",
    );
  });

  void it("allows demotion when another business admin remains", () => {
    assert.doesNotThrow(() =>
      assertBusinessAdminCoverage({
        targetUserId: 10,
        nextAssignments: [
          { roleType: "manager", scopeType: "department", scopeId: 3 },
        ],
        existingBusinessAdminUserIds: [10, 20],
      }),
    );
  });
});
