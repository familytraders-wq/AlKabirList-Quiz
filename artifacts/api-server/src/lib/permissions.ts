import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  permissionTemplates,
  userPermissionOverrides,
  userPermissionTemplates,
} from "@workspace/db/schema";

export const PERMISSIONS = [
  "content.view",
  "content.manage",
  "schedule.view",
  "schedule.manage",
  "beta.view",
  "beta.manage",
  "access.view",
  "access.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const allPermissions = new Set<string>(PERMISSIONS);
const roleDefaults: Record<string, Permission[]> = {
  // Reviewers retain the existing question-review and beta-operations
  // workflows. These defaults only apply to legacy accounts without a
  // named template.
  reviewer: ["content.view", "content.manage", "beta.view", "beta.manage"],
  admin: [
    "content.view", "content.manage",
    "schedule.view", "schedule.manage",
    "beta.view", "beta.manage",
  ],
};

export function defaultPermissionsForRoles(roles: string[]) {
  return PERMISSIONS.filter((permission) => roles.some((role) => roleDefaults[role]?.includes(permission)));
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && allPermissions.has(value);
}

export async function resolvePermissions(userId: string, roles: string[], superAdmin = false) {
  if (superAdmin) return [...PERMISSIONS];
  const [assignment] = await db
    .select({ templateId: userPermissionTemplates.templateId, name: permissionTemplates.name })
    .from(userPermissionTemplates)
    .innerJoin(permissionTemplates, eq(userPermissionTemplates.templateId, permissionTemplates.id))
    .where(eq(userPermissionTemplates.userId, userId));
  // A named template is authoritative. Role defaults are deliberately not
  // unioned with it so a restrictive template can restrict an admin.
  const effective = new Set<string>(assignment ? [] : defaultPermissionsForRoles(roles));
  if (assignment) {
    const [template] = await db
      .select({ permissions: permissionTemplates.permissions })
      .from(permissionTemplates)
      .where(eq(permissionTemplates.id, assignment.templateId));
    for (const permission of template?.permissions ?? []) {
      if (isPermission(permission)) effective.add(permission);
    }
  }
  const overrides = await db
    .select({ permission: userPermissionOverrides.permission, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
  for (const override of overrides) {
    if (!isPermission(override.permission)) continue;
    if (override.effect === "allow") effective.add(override.permission);
    else effective.delete(override.permission);
  }
  return PERMISSIONS.filter((permission) => effective.has(permission));
}

export async function getPermissionState(userId: string, roles: string[], superAdmin: boolean) {
  const [assignment] = await db
    .select({
      templateId: userPermissionTemplates.templateId,
      name: permissionTemplates.name,
    })
    .from(userPermissionTemplates)
    .innerJoin(permissionTemplates, eq(userPermissionTemplates.templateId, permissionTemplates.id))
    .where(eq(userPermissionTemplates.userId, userId));
  const overrides = await db
    .select({
      permission: userPermissionOverrides.permission,
      effect: userPermissionOverrides.effect,
    })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
  return {
    template: assignment ? { id: assignment.templateId, name: assignment.name } : null,
    overrides,
    permissions: await resolvePermissions(userId, roles, superAdmin),
  };
}