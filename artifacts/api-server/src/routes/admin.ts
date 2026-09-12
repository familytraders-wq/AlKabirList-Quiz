import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response, type Request, type NextFunction } from "express";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  CreateAdminQuestionBody,
  CreateAdminQuestionResponse,
  CreateGenerationRunBody,
  CreateGenerationRunResponse,
  GetQuizAnalyticsResponse,
  ListAdminQuestionsQueryParams,
  ListAdminQuestionsResponse,
  ReviewQuestionBody,
  ReviewQuestionParams,
  ReviewQuestionResponse,
  UpdateAdminQuestionBody,
  UpdateAdminQuestionParams,
  UpdateAdminQuestionResponse,
  GrantAdminUserRoleBody,
  GrantAdminUserRoleParams,
  GrantAdminUserRoleResponse,
  RevokeAdminUserRoleBody,
  RevokeAdminUserRoleParams,
  RevokeAdminUserRoleResponse,
  ListAdminQuizzesResponse,
  CreateAdminQuizBody,
  CreateAdminQuizResponse,
  UpdateAdminQuizParams,
  UpdateAdminQuizBody,
  UpdateAdminQuizResponse,
  PreviewAdminQuizParams,
  PreviewAdminQuizResponse,
  ListPermissionTemplatesResponse,
  CreatePermissionTemplateBody,
  CreatePermissionTemplateResponse,
  UpdatePermissionTemplateParams,
  UpdatePermissionTemplateBody,
  UpdatePermissionTemplateResponse,
  DeletePermissionTemplateParams,
  AssignPermissionTemplateParams,
  AssignPermissionTemplateBody,
  SetPermissionOverrideParams,
  SetPermissionOverrideBody,
  ClearPermissionTemplateParams,
  ClearPermissionOverrideParams,
  ImportAdminQuestionsCsvBody,
  ImportAdminQuestionsCsvResponse,
} from "@workspace/api-zod";
import {
  questionAudiences,
  questionChoices,
  questionVersions,
  questions,
  reviewEvents,
  generationRuns,
  quizAttempts,
  users,
  userRoles,
  quizzes,
  quizQuestions,
  permissionTemplates,
  userPermissionTemplates,
  userPermissionOverrides,
  taxonomies,
} from "@workspace/db/schema";
import { getOwner, requireAdmin, requireReviewer, requirePermission, requireSuperAdmin } from "../middlewares/auth";
import { csrfProtection } from "../lib/security";
import { writeAuditEvent } from "../lib/audit";
import { getPermissionState, isPermission, PERMISSIONS } from "../lib/permissions";
import { CSV_IMPORT_MAX_BYTES, parseQuestionCsv } from "../lib/question-csv";
import type { ImportRowError, QuestionInput } from "../lib/question-csv";

const router: IRouter = Router();

function badRequest(res: Response, message: string) {
  res.status(400).json({ code: "BAD_REQUEST", message });
}

function importErrorResponse(res: Response, error: string, rowErrors: ImportRowError[]) {
  return res.status(400).json({ error, rowErrors });
}

class CsvImportConflictError extends Error {
  constructor(readonly rowErrors: ImportRowError[]) {
    super("CSV update conflicts");
  }
}

async function adminQuestion(questionId: string) {
  const rows = await db
    .select({ question: questions, version: questionVersions, choice: questionChoices })
    .from(questions)
    .innerJoin(questionVersions, eq(questions.currentVersionId, questionVersions.id))
    .leftJoin(questionChoices, eq(questionVersions.id, questionChoices.versionId))
    .where(eq(questions.id, questionId))
    .orderBy(asc(questionChoices.position));
  const first = rows[0];
  if (!first) return undefined;
  return {
    id: first.question.id,
    status: first.question.status,
    versionId: first.version.id,
    version: first.version.version,
    prompt: first.version.prompt,
    explanation: first.version.explanation,
    points: first.version.points,
    choices: rows.flatMap(({ choice }) =>
      choice
        ? [{ label: choice.label, position: choice.position, isCorrect: choice.isCorrect }]
        : [],
    ),
    sourceMetadata: first.version.sourceMetadata,
  };
}

function validateChoices(choices: Array<{ isCorrect: boolean }>) {
  return choices.filter((choice) => choice.isCorrect).length === 1;
}

type QuestionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertQuestionVersionInTransaction(
  tx: QuestionTransaction,
  input: QuestionInput,
  ownerId: string,
  status: "draft" | "pending_review",
  generationMetadata?: { provider: string; model: string; promptVersion: string; runId?: string },
) {
  if (!validateChoices(input.choices)) {
    throw new Error("Question must have exactly one correct choice");
  }
  const [question] = await tx
    .insert(questions)
    .values({ categoryId: input.categoryId, difficultyId: input.difficultyId, status, createdBy: ownerId })
    .returning();
  if (!question) throw new Error("Question insert did not return a row");
  const [version] = await tx
    .insert(questionVersions)
    .values({
      questionId: question.id,
      version: 1,
      prompt: input.prompt,
      explanation: input.explanation,
      type: input.type,
      points: input.points,
      sourceMetadata: input.sourceMetadata,
      createdBy: ownerId,
      generationMetadata,
    })
    .returning();
  if (!version) throw new Error("Question version insert did not return a row");
  await tx
    .update(questions)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(questions.id, question.id));
  await tx.insert(questionChoices).values(
    input.choices.map((choice) => ({ ...choice, versionId: version.id })),
  );
  if (input.audienceIds?.length) {
    await tx.insert(questionAudiences).values(
      input.audienceIds.map((audienceId) => ({
        questionId: question.id,
        audienceId,
      })),
    );
  }
  await writeAuditEvent(tx, {
    actorId: ownerId,
    action: "question_created",
    entityType: "question",
    entityId: question.id,
    metadata: { status },
  });
  return question.id;
}

async function insertQuestionVersion(
  input: QuestionInput,
  ownerId: string,
  status: "draft" | "pending_review",
  generationMetadata?: { provider: string; model: string; promptVersion: string; runId?: string },
) {
  return db.transaction((tx) => insertQuestionVersionInTransaction(tx, input, ownerId, status, generationMetadata));
}

router.use("/admin", requireReviewer);
router.use("/admin/quiz/generation-runs", requirePermission("content.manage"));
router.use("/admin/quiz/analytics", requirePermission("beta.view"));

const roleNames = ["reviewer", "admin"] as const;
type ManagedRole = (typeof roleNames)[number];

function parseManagedRole(value: unknown): ManagedRole | undefined {
  return typeof value === "string" && (roleNames as readonly string[]).includes(value)
    ? (value as ManagedRole)
    : undefined;
}

async function listInternalUsers() {
  const rows = await db
    .select({ internalId: users.id, managementId: users.managementId, createdAt: users.createdAt, role: userRoles.role })
    .from(users)
    .leftJoin(userRoles, sql`${users.id} = ${userRoles.userId}::text`)
    .orderBy(asc(users.createdAt), asc(users.id));
  const grouped = new Map<string, { internalId: string; managementId: string; createdAt: Date; roles: ManagedRole[] }>();
  for (const row of rows) {
    const existing = grouped.get(row.internalId) ?? {
      internalId: row.internalId,
      managementId: row.managementId,
      createdAt: row.createdAt,
      roles: [],
    };
    if (row.role) existing.roles.push(row.role);
    grouped.set(row.internalId, existing);
  }
  return Promise.all([...grouped.values()].map(async (entry) => {
    const [account] = await db
      .select({ isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.id, entry.internalId));
    return {
      id: entry.managementId,
      isSuperAdmin: account?.isSuperAdmin ?? false,
      createdAt: entry.createdAt,
      roles: entry.roles,
      ...(await getPermissionState(entry.internalId, entry.roles, account?.isSuperAdmin ?? false)),
    };
  }));
}

router.get("/admin/users", requirePermission("access.view"), async (_req, res, next) => {
  try {
    res.json({ items: await listInternalUsers() });
  } catch (error) {
    next(error);
  }
});

async function changeUserRole(
  managementId: string,
  actorId: string,
  role: ManagedRole,
  action: "grant" | "revoke",
) {
  return db.transaction(async (tx) => {
    // Serialize every role mutation so two concurrent revokes cannot both
    // observe a safe admin count and remove the final administrator.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('alkabir-admin-role-mutations'))`);
    const [actorRole] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, actorId), eq(users.isSuperAdmin, true)))
      .limit(1);
    if (!actorRole) return { error: "ACTOR_NOT_ADMIN" as const };
    const [target] = await tx
      .select({ id: users.id, managementId: users.managementId, isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.managementId, managementId));
    if (!target) return { error: "NOT_FOUND" as const };
    if (target.isSuperAdmin) return { error: "PROTECTED_SUPER_ADMIN" as const };
    if (action === "revoke" && role === "admin" && target.id === actorId) {
      return { error: "SELF_ADMIN_REVOKE" as const };
    }
    if (action === "grant") {
       await tx.insert(userRoles).values({ userId: target.id, role, grantedByUserId: actorId }).onConflictDoNothing({
        target: [userRoles.userId, userRoles.role],
      });
    } else {
      if (role === "admin") {
        const [{ total }] = await tx
          .select({ total: count() })
          .from(userRoles)
          .where(eq(userRoles.role, "admin"));
        if (Number(total) <= 1) return { error: "LAST_ADMIN" as const };
      }
       await tx.delete(userRoles).where(and(eq(userRoles.userId, target.id), eq(userRoles.role, role)));
    }
    await writeAuditEvent(tx, {
      actorId,
      action: action === "grant" ? "role_granted" : "role_revoked",
      entityType: "user_role",
       entityId: target.managementId,
      metadata: { role },
    });
    return { user: target };
  });
}

async function roleMutation(req: Request, res: Response, next: NextFunction, action: "grant" | "revoke") {
  try {
    const actorId = getOwner(res).userId;
    if (!actorId) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const params = (action === "grant" ? GrantAdminUserRoleParams : RevokeAdminUserRoleParams).safeParse(req.params);
    const body = (action === "grant" ? GrantAdminUserRoleBody : RevokeAdminUserRoleBody).safeParse(req.body);
    if (!params.success || !body.success) return badRequest(res, "Invalid role change request");
    const userId = params.data.userId;
    const role = parseManagedRole(body.data.role);
    if (!role) return badRequest(res, "Role must be exactly reviewer or admin");
    const result = await changeUserRole(userId, actorId, role, action);
    if ("error" in result) {
      if (result.error === "ACTOR_NOT_ADMIN") return res.status(403).json({ code: "FORBIDDEN", message: "Super Administrator role is required" });
      if (result.error === "NOT_FOUND") return res.status(404).json({ code: "NOT_FOUND", message: "User not found" });
      if (result.error === "PROTECTED_SUPER_ADMIN") return res.status(409).json({ code: "PROTECTED_SUPER_ADMIN", message: "The protected Super Admin cannot be changed" });
      if (result.error === "SELF_ADMIN_REVOKE") return res.status(409).json({ code: "SELF_ADMIN_REVOKE", message: "You cannot revoke your own admin role" });
      return res.status(409).json({ code: "LAST_ADMIN", message: "At least one administrator must remain" });
    }
    const items = await listInternalUsers();
    const item = items.find((entry) => entry.id === userId);
    const output = item ?? {
      id: userId,
      roles: [],
      createdAt: new Date(),
      isSuperAdmin: false,
      permissions: [],
      template: null,
      overrides: [],
    };
    res.json((action === "grant" ? GrantAdminUserRoleResponse : RevokeAdminUserRoleResponse).parse(output));
  } catch (error) {
    next(error);
  }
}

router.post("/admin/users/:userId/roles", requireSuperAdmin, csrfProtection, (req, res, next) => roleMutation(req, res, next, "grant"));
router.delete("/admin/users/:userId/roles", requireSuperAdmin, csrfProtection, (req, res, next) => roleMutation(req, res, next, "revoke"));

function validPermissions(values: string[]) {
  return values.length === new Set(values).size && values.every((value) => isPermission(value));
}

router.get("/admin/permission-templates", requireSuperAdmin, async (_req, res, next) => {
  try {
    const items = await db.select().from(permissionTemplates).orderBy(asc(permissionTemplates.name));
    res.json(ListPermissionTemplatesResponse.parse({ items }));
  } catch (error) { next(error); }
});

router.post("/admin/permission-templates", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const parsed = CreatePermissionTemplateBody.safeParse(req.body);
    const actorId = getOwner(res).userId;
    if (!parsed.success || !actorId || !validPermissions(parsed.data.permissions)) {
      badRequest(res, "Invalid permission template");
      return;
    }
    const [template] = await db.transaction(async (tx) => {
      const created = await tx.insert(permissionTemplates).values({
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        permissions: parsed.data.permissions,
        createdByUserId: actorId,
      }).returning();
      if (created[0]) await writeAuditEvent(tx, {
        actorId, action: "permission_template_created", entityType: "permission_template",
        entityId: created[0].id, metadata: { permissionCount: parsed.data.permissions.length },
      });
      return created;
    });
    res.status(201).json(CreatePermissionTemplateResponse.parse(template));
  } catch (error) { next(error); }
});

router.patch("/admin/permission-templates/:templateId", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const params = UpdatePermissionTemplateParams.safeParse(req.params);
    const parsed = UpdatePermissionTemplateBody.safeParse(req.body);
    const actorId = getOwner(res).userId;
    if (!params.success || !parsed.success || !actorId || !validPermissions(parsed.data.permissions)) {
      badRequest(res, "Invalid permission template");
      return;
    }
    const [template] = await db.transaction(async (tx) => {
      const updated = await tx.update(permissionTemplates).set({
        name: parsed.data.name, description: parsed.data.description ?? "",
        permissions: parsed.data.permissions, updatedAt: new Date(),
      }).where(eq(permissionTemplates.id, params.data.templateId)).returning();
      if (updated[0]) await writeAuditEvent(tx, {
        actorId, action: "permission_template_updated", entityType: "permission_template",
        entityId: updated[0].id, metadata: { permissionCount: parsed.data.permissions.length },
      });
      return updated;
    });
    if (!template) { res.status(404).json({ code: "NOT_FOUND", message: "Template not found" }); return; }
    res.json(UpdatePermissionTemplateResponse.parse(template));
  } catch (error) { next(error); }
});

router.delete("/admin/permission-templates/:templateId", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const params = DeletePermissionTemplateParams.safeParse(req.params);
    const actorId = getOwner(res).userId;
    if (!params.success || !actorId) { badRequest(res, "Invalid template id"); return; }
    const [assigned] = await db.select({ userId: userPermissionTemplates.userId })
      .from(userPermissionTemplates)
      .where(eq(userPermissionTemplates.templateId, params.data.templateId))
      .limit(1);
    if (assigned) {
      res.status(409).json({ code: "TEMPLATE_ASSIGNED", message: "The permission template is assigned to a user and cannot be deleted" });
      return;
    }
    let template;
    try {
      [template] = await db.transaction(async (tx) => {
        const deleted = await tx.delete(permissionTemplates)
          .where(eq(permissionTemplates.id, params.data.templateId)).returning({ id: permissionTemplates.id });
        if (deleted[0]) await writeAuditEvent(tx, {
          actorId, action: "permission_template_deleted", entityType: "permission_template",
          entityId: deleted[0].id, metadata: {},
        });
        return deleted;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23503") {
        res.status(409).json({ code: "TEMPLATE_ASSIGNED", message: "The permission template is assigned to a user and cannot be deleted" });
        return;
      }
      throw error;
    }
    if (!template) { res.status(404).json({ code: "NOT_FOUND", message: "Template not found" }); return; }
    res.status(204).send();
  } catch (error) { next(error); }
});

async function protectedTarget(managementId: string) {
  const [target] = await db
    .select({ id: users.id, managementId: users.managementId, isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.managementId, managementId));
  return target;
}

async function accessRecord(managementId: string) {
  const rows = await listInternalUsers();
  return rows.find((item) => item.id === managementId);
}

router.put("/admin/users/:userId/permission-template", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const params = AssignPermissionTemplateParams.safeParse(req.params);
    const body = AssignPermissionTemplateBody.safeParse(req.body);
    const actorId = getOwner(res).userId;
    if (!params.success || !body.success || !actorId) { badRequest(res, "Invalid template assignment"); return; }
    const target = await protectedTarget(params.data.userId);
    if (!target) { res.status(404).json({ code: "NOT_FOUND", message: "User not found" }); return; }
    if (target.isSuperAdmin) { res.status(409).json({ code: "PROTECTED_SUPER_ADMIN", message: "The protected Super Admin cannot be changed" }); return; }
    const [template] = await db.select({ id: permissionTemplates.id }).from(permissionTemplates).where(eq(permissionTemplates.id, body.data.templateId));
    if (!template) { res.status(404).json({ code: "NOT_FOUND", message: "Template not found" }); return; }
    await db.transaction(async (tx) => {
      await tx.insert(userPermissionTemplates).values({
        userId: target.id, templateId: template.id, assignedByUserId: actorId,
      }).onConflictDoUpdate({
        target: userPermissionTemplates.userId,
        set: { templateId: template.id, assignedByUserId: actorId, assignedAt: new Date() },
      });
      await writeAuditEvent(tx, {
        actorId, action: "permission_template_assigned", entityType: "user", entityId: target.managementId,
        metadata: { templateId: template.id },
      });
    });
    const item = await accessRecord(target.managementId);
    res.json(item);
  } catch (error) { next(error); }
});

router.delete("/admin/users/:userId/permission-template", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const params = ClearPermissionTemplateParams.safeParse(req.params);
    const actorId = getOwner(res).userId;
    if (!params.success || !actorId) { badRequest(res, "Invalid template assignment"); return; }
    const target = await protectedTarget(params.data.userId);
    if (!target) { res.status(404).json({ code: "NOT_FOUND", message: "User not found" }); return; }
    if (target.isSuperAdmin) { res.status(409).json({ code: "PROTECTED_SUPER_ADMIN", message: "The protected Super Admin cannot be changed" }); return; }
    await db.transaction(async (tx) => {
      await tx.delete(userPermissionTemplates).where(eq(userPermissionTemplates.userId, target.id));
      await writeAuditEvent(tx, { actorId, action: "permission_template_cleared", entityType: "user", entityId: target.managementId, metadata: {} });
    });
    res.json(await accessRecord(target.managementId));
  } catch (error) { next(error); }
});

router.put("/admin/users/:userId/permission-overrides", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const params = SetPermissionOverrideParams.safeParse(req.params);
    const body = SetPermissionOverrideBody.safeParse(req.body);
    const actorId = getOwner(res).userId;
    if (!params.success || !body.success || !actorId || !isPermission(body.data.permission)) {
      badRequest(res, "Invalid permission override");
      return;
    }
    const target = await protectedTarget(params.data.userId);
    if (!target) { res.status(404).json({ code: "NOT_FOUND", message: "User not found" }); return; }
    if (target.isSuperAdmin) { res.status(409).json({ code: "PROTECTED_SUPER_ADMIN", message: "The protected Super Admin cannot be changed" }); return; }
    await db.transaction(async (tx) => {
      await tx.insert(userPermissionOverrides).values({
        userId: target.id, permission: body.data.permission, effect: body.data.effect, grantedByUserId: actorId,
      }).onConflictDoUpdate({
        target: [userPermissionOverrides.userId, userPermissionOverrides.permission],
        set: { effect: body.data.effect, grantedByUserId: actorId, createdAt: new Date() },
      });
      await writeAuditEvent(tx, {
        actorId, action: "permission_override_set", entityType: "user", entityId: target.managementId,
        metadata: { permission: body.data.permission, effect: body.data.effect },
      });
    });
    res.json(await accessRecord(target.managementId));
  } catch (error) { next(error); }
});

router.delete("/admin/users/:userId/permission-overrides/:permission", requireSuperAdmin, csrfProtection, async (req, res, next) => {
  try {
    const params = ClearPermissionOverrideParams.safeParse(req.params);
    const actorId = getOwner(res).userId;
    if (!params.success || !actorId || !isPermission(params.data.permission)) { badRequest(res, "Invalid permission override"); return; }
    const target = await protectedTarget(params.data.userId);
    if (!target) { res.status(404).json({ code: "NOT_FOUND", message: "User not found" }); return; }
    if (target.isSuperAdmin) { res.status(409).json({ code: "PROTECTED_SUPER_ADMIN", message: "The protected Super Admin cannot be changed" }); return; }
    await db.transaction(async (tx) => {
      await tx.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.userId, target.id), eq(userPermissionOverrides.permission, params.data.permission)));
      await writeAuditEvent(tx, { actorId, action: "permission_override_cleared", entityType: "user", entityId: target.managementId, metadata: { permission: params.data.permission } });
    });
    res.json(await accessRecord(target.managementId));
  } catch (error) { next(error); }
});

router.get("/admin/quiz/questions", requirePermission("content.view"), async (req, res, next) => {
  try {
    const parsed = ListAdminQuestionsQueryParams.safeParse(req.query);
    if (!parsed.success) return badRequest(res, "Invalid question list filters");
    const { status, limit, offset } = parsed.data;
    const filter = status ? eq(questions.status, status) : undefined;
    const rows = await db
      .select({ id: questions.id })
      .from(questions)
      .where(filter)
      .orderBy(desc(questions.updatedAt))
      .limit(limit)
      .offset(offset);
    const items = [];
    for (const row of rows) {
      const item = await adminQuestion(row.id);
      if (item) items.push(item);
    }
    const [total] = await db.select({ total: count() }).from(questions).where(filter);
    res.json(ListAdminQuestionsResponse.parse({ items, total: Number(total?.total ?? 0) }));
  } catch (error) {
    next(error);
  }
});

router.post("/admin/quiz/questions", requirePermission("content.manage"), csrfProtection, async (req, res, next) => {
  try {
    const parsed = CreateAdminQuestionBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, "Invalid question");
    if (!validateChoices(parsed.data.choices)) {
      return badRequest(res, "A question must have exactly one correct choice");
    }
    const ownerId = getOwner(res).userId;
    if (!ownerId) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const questionId = await insertQuestionVersion(parsed.data, ownerId, "draft");
    const result = await adminQuestion(questionId);
    res.status(201).json(CreateAdminQuestionResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

router.post("/admin/quiz/questions/import-csv", requirePermission("content.manage"), csrfProtection, async (req, res, next) => {
  try {
    const ownerId = getOwner(res).userId;
    if (!ownerId) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const body = ImportAdminQuestionsCsvBody.safeParse(req.body);
    if (!body.success || !body.data.filename.trim()) {
      return importErrorResponse(res, "Invalid CSV import request", [{ row: 0, column: "csv", message: "CSV text and filename are required" }]);
    }
    if (!/\.csv$/i.test(body.data.filename)) {
      return importErrorResponse(res, "Invalid CSV import request", [{ row: 0, column: "filename", message: "Filename must end in .csv" }]);
    }
    if (Buffer.byteLength(body.data.csv, "utf8") > CSV_IMPORT_MAX_BYTES) {
      return importErrorResponse(res, "CSV file is too large", [{
        row: 0,
        column: "csv",
        message: "CSV files must be 2 MiB or smaller",
      }]);
    }
    const parsed = parseQuestionCsv(body.data.csv);
    if (parsed.rowErrors.length) return importErrorResponse(res, "CSV validation failed", parsed.rowErrors);

    const uniqueTaxonomyIds = [...new Set(parsed.taxonomyRefs.map((ref) => ref.id))];
    if (uniqueTaxonomyIds.length) {
      const existing = await db
        .select({ id: taxonomies.id, kind: taxonomies.kind })
        .from(taxonomies)
        .where(inArray(taxonomies.id, uniqueTaxonomyIds));
      const existingById = new Map(existing.map((taxonomy) => [taxonomy.id, taxonomy.kind]));
      for (const ref of parsed.taxonomyRefs) {
        const actualKind = existingById.get(ref.id);
        if (!actualKind) {
          parsed.rowErrors.push({ row: ref.row, column: ref.column, message: "Taxonomy ID does not exist" });
        } else if (actualKind !== ref.kind) {
          parsed.rowErrors.push({
            row: ref.row,
            column: ref.column,
            message: `Taxonomy ID must reference a ${ref.kind} taxonomy`,
          });
        }
      }
      if (parsed.rowErrors.length) return importErrorResponse(res, "CSV validation failed", parsed.rowErrors);
    }

    const result = await db.transaction(async (tx) => {
      const updates = parsed.inputs.filter((input) => input.questionId);
      const existingById = new Map<string, { currentVersion: number }>();
      if (updates.length) {
        const referencedIds = updates.map((input) => input.questionId!);
        // Lock the question rows in a statement without the version join. If a
        // concurrent import commits while this lock waits, PostgreSQL can
        // otherwise resume the joined FOR UPDATE query with a stale join
        // snapshot and incorrectly report the question as missing.
        const lockedQuestions = await tx
          .select({ id: questions.id })
          .from(questions)
          .where(inArray(questions.id, referencedIds))
          .for("update");
        const existing = await tx
          .select({ id: questions.id, currentVersion: questionVersions.version })
          .from(questions)
          .innerJoin(questionVersions, eq(questions.currentVersionId, questionVersions.id))
          .where(inArray(questions.id, lockedQuestions.map((question) => question.id)));
        for (const item of existing) existingById.set(item.id, { currentVersion: item.currentVersion });

        const conflicts: ImportRowError[] = [];
        for (const input of updates) {
          const current = existingById.get(input.questionId!);
          if (!current) {
            conflicts.push({ row: input.row ?? 0, column: "question_id", message: "Question ID does not exist" });
          } else if (current.currentVersion !== input.expectedVersion) {
            conflicts.push({
              row: input.row ?? 0,
              column: "expected_version",
              message: `Version conflict: expected ${input.expectedVersion}, current version is ${current.currentVersion}`,
            });
          }
        }
        if (conflicts.length) throw new CsvImportConflictError(conflicts);
      }

      const ids: string[] = [];
      for (const input of parsed.inputs) {
        if (!input.questionId) {
          ids.push(await insertQuestionVersionInTransaction(tx, input, ownerId, "draft"));
          continue;
        }
        const nextVersion = input.expectedVersion! + 1;
        const [version] = await tx.insert(questionVersions).values({
          questionId: input.questionId,
          version: nextVersion,
          prompt: input.prompt,
          explanation: input.explanation,
          type: input.type,
          points: input.points,
          sourceMetadata: input.sourceMetadata,
          createdBy: ownerId,
        }).returning();
        if (!version) throw new Error("Question version insert did not return a row");
        await tx.insert(questionChoices).values(
          input.choices.map((choice) => ({ ...choice, versionId: version.id })),
        );
        await tx.delete(questionAudiences).where(eq(questionAudiences.questionId, input.questionId));
        if (input.audienceIds?.length) {
          await tx.insert(questionAudiences).values(
            input.audienceIds.map((audienceId) => ({ questionId: input.questionId!, audienceId })),
          );
        }
        await tx.update(questions).set({
          categoryId: input.categoryId,
          difficultyId: input.difficultyId,
          status: "draft",
          currentVersionId: version.id,
          updatedAt: new Date(),
        }).where(eq(questions.id, input.questionId));
        await writeAuditEvent(tx, {
          actorId: ownerId,
          action: "question_updated",
          entityType: "question",
          entityId: input.questionId,
          metadata: { status: "draft" },
        });
        ids.push(input.questionId);
      }
      return {
        questionIds: ids,
        createdCount: parsed.inputs.filter((input) => !input.questionId).length,
        updatedCount: updates.length,
      };
    });
    return res.status(201).json(ImportAdminQuestionsCsvResponse.parse({
      importedCount: result.questionIds.length,
      ...result,
    }));
  } catch (error) {
    if (error instanceof CsvImportConflictError) {
      return importErrorResponse(res, "CSV update conflicts", error.rowErrors);
    }
    return next(error);
  }
});

router.patch("/admin/quiz/questions/:questionId", requirePermission("content.manage"), csrfProtection, async (req, res, next) => {
  try {
    const params = UpdateAdminQuestionParams.safeParse(req.params);
    const parsed = UpdateAdminQuestionBody.safeParse(req.body);
    if (!params.success || !parsed.success) return badRequest(res, "Invalid question update");
    if (!validateChoices(parsed.data.choices)) {
      return badRequest(res, "A question must have exactly one correct choice");
    }
    const ownerId = getOwner(res).userId;
    if (!ownerId) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const [question] = await db.select().from(questions).where(eq(questions.id, params.data.questionId));
    if (!question) return res.status(404).json({ code: "NOT_FOUND", message: "Question not found" });
    const [{ maxVersion }] = await db
      .select({ maxVersion: sql<number>`coalesce(max(${questionVersions.version}), 0)` })
      .from(questionVersions)
      .where(eq(questionVersions.questionId, question.id));
    const result = await db.transaction(async (tx) => {
      const [version] = await tx
        .insert(questionVersions)
        .values({
          questionId: question.id,
          version: Number(maxVersion) + 1,
          prompt: parsed.data.prompt,
          explanation: parsed.data.explanation,
          type: parsed.data.type,
          points: parsed.data.points,
          sourceMetadata: parsed.data.sourceMetadata,
          createdBy: ownerId,
        })
        .returning();
      if (!version) throw new Error("Question version insert did not return a row");
      await tx.insert(questionChoices).values(
        parsed.data.choices.map((choice) => ({ ...choice, versionId: version.id })),
      );
      await tx
        .update(questions)
        .set({ categoryId: parsed.data.categoryId, difficultyId: parsed.data.difficultyId, status: "draft", currentVersionId: version.id, updatedAt: new Date() })
        .where(eq(questions.id, question.id));
      await writeAuditEvent(tx, {
        actorId: ownerId,
        action: "question_updated",
        entityType: "question",
        entityId: question.id,
        metadata: { status: "draft" },
      });
      return version;
    });
    const item = await adminQuestion(question.id);
    res.json(UpdateAdminQuestionResponse.parse({ ...item, versionId: result.id, version: result.version }));
  } catch (error) {
    next(error);
  }
});

router.post("/admin/quiz/questions/:questionId/reviews", requirePermission("content.manage"), csrfProtection, async (req, res, next) => {
  try {
    const params = ReviewQuestionParams.safeParse(req.params);
    const parsed = ReviewQuestionBody.safeParse(req.body);
    if (!params.success || !parsed.success) return badRequest(res, "Invalid review request");
    const reviewerId = getOwner(res).userId;
    if (!reviewerId) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const nextStatus = parsed.data.decision === "submit"
      ? "pending_review"
      : parsed.data.decision === "approve"
      ? "approved"
      : parsed.data.decision === "reject"
        ? "rejected"
        : "archived";
    const result = await db.transaction(async (tx) => {
      const [question] = await tx.select().from(questions).where(eq(questions.id, params.data.questionId));
      if (!question || question.status !== parsed.data.expectedStatus) return { conflict: true as const };
      const validTransition =
        parsed.data.decision === "submit"
          ? ["draft", "rejected"].includes(question.status)
          : parsed.data.decision === "approve"
            ? question.status === "pending_review"
            : parsed.data.decision === "reject"
              ? question.status === "pending_review"
              : ["draft", "rejected", "pending_review", "approved"].includes(question.status);
      if (!validTransition) return { invalidTransition: true as const };
      if (parsed.data.decision === "approve") {
        const [current] = await tx
          .select({ correct: count() })
          .from(questionChoices)
          .where(and(eq(questionChoices.versionId, question.currentVersionId!), eq(questionChoices.isCorrect, true)));
        if (Number(current?.correct ?? 0) !== 1) return { invalid: true as const };
      }
      const [updated] = await tx
        .update(questions)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(and(eq(questions.id, question.id), eq(questions.status, parsed.data.expectedStatus)))
        .returning();
      if (!updated) return { conflict: true as const };
      await tx.insert(reviewEvents).values({
        questionId: question.id,
        versionId: question.currentVersionId,
        reviewerId,
        fromStatus: parsed.data.expectedStatus,
        toStatus: nextStatus,
        decision: parsed.data.decision,
        note: parsed.data.note,
      });
      await writeAuditEvent(tx, {
        actorId: reviewerId,
        action: "question_reviewed",
        entityType: "question",
        entityId: question.id,
        metadata: { fromStatus: parsed.data.expectedStatus, toStatus: nextStatus },
      });
      return { question: updated };
    });
    if ("invalidTransition" in result) {
      return res.status(409).json({ code: "INVALID_REVIEW_TRANSITION", message: "Question cannot make that review transition from its current status" });
    }
    if ("invalid" in result) return badRequest(res, "Approved questions need exactly one correct choice");
    if ("conflict" in result) return res.status(409).json({ code: "STALE_REVIEW", message: "Question status changed; reload before reviewing" });
    const item = await adminQuestion(params.data.questionId);
    res.json(ReviewQuestionResponse.parse(item));
  } catch (error) {
    next(error);
  }
});

type QuizMembership = { versionId: string; points: number };

async function adminQuiz(id: string) {
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, id)).limit(1);
  if (!quiz) return undefined;
  const memberships = await db
    .select({ versionId: quizQuestions.versionId, points: quizQuestions.points })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, id))
    .orderBy(asc(quizQuestions.position));
  return {
    id: quiz.id,
    slug: quiz.slug,
    title: quiz.title,
    scheduledDate: quiz.scheduledDate,
    timezone: quiz.timezone,
    isActive: quiz.isActive,
    questionCount: memberships.length,
    questions: memberships,
  };
}

async function validateMemberships(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  memberships: QuizMembership[],
) {
  if (new Set(memberships.map((item) => item.versionId)).size !== memberships.length) {
    return "Duplicate question versions are not allowed";
  }
  const versions = await tx
    .select({ id: questionVersions.id, questionId: questionVersions.questionId })
    .from(questionVersions)
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .where(and(
      inArray(questionVersions.id, memberships.map((item) => item.versionId)),
      eq(questions.status, "approved"),
      eq(questions.currentVersionId, questionVersions.id),
    ))
    .for("update");
  if (versions.length !== memberships.length) return "Every question version must be approved and current";
  return undefined;
}

async function quizScheduleMutation(
  input: { title: string; scheduledDate: string; timezone: "UTC"; isActive: boolean; questions: QuizMembership[] },
  id?: string,
  actorId?: string,
) {
  const date = new Date(`${input.scheduledDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.scheduledDate) {
    return { error: "INVALID_DATE" as const, message: "scheduledDate must be a valid UTC date-only value" };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('alkabir-quiz-schedule-slots'))`);
    const membershipError = await validateMemberships(tx, input.questions);
    if (membershipError) return { error: "INVALID_CONTENT" as const, message: membershipError };
    const conflict = await tx
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(and(
        eq(quizzes.scheduledDate, input.scheduledDate),
        isNull(quizzes.audienceId),
        id ? sql`${quizzes.id} <> ${id}` : undefined,
      ))
      .limit(1);
    if (conflict[0]) return { error: "DATE_CONFLICT" as const, message: "A quiz is already scheduled for this UTC date" };
    const quiz = id
      ? (await tx.update(quizzes).set({
          title: input.title, scheduledDate: input.scheduledDate, timezone: "UTC", isActive: input.isActive,
        }).where(eq(quizzes.id, id)).returning())[0]
      : (await tx.insert(quizzes).values({
          slug: `scheduled-${randomUUID()}`, title: input.title, scheduledDate: input.scheduledDate, timezone: "UTC", isActive: input.isActive,
        }).returning())[0];
    if (!quiz) return { error: "NOT_FOUND" as const, message: "Quiz not found" };
    await tx.delete(quizQuestions).where(eq(quizQuestions.quizId, quiz.id));
    await tx.insert(quizQuestions).values(input.questions.map((item, position) => ({
      quizId: quiz.id, versionId: item.versionId, position, points: item.points,
    })));
    if (actorId) await writeAuditEvent(tx, {
      actorId,
      action: id ? "quiz_updated" : "quiz_created",
      entityType: "quiz",
      entityId: quiz.id,
      metadata: { scheduledDate: input.scheduledDate, questionCount: input.questions.length },
    });
    return { quizId: quiz.id };
  });
}

router.get("/admin/quiz/quizzes", requirePermission("schedule.view"), async (_req, res, next) => {
  try {
    const rows = await db.select({ id: quizzes.id }).from(quizzes).orderBy(desc(quizzes.scheduledDate), desc(quizzes.createdAt));
    const items = [];
    for (const row of rows) {
      const item = await adminQuiz(row.id);
      if (item) items.push(item);
    }
    res.json(ListAdminQuizzesResponse.parse({ items }));
  } catch (error) { next(error); }
});

router.post("/admin/quiz/quizzes", requirePermission("schedule.manage"), csrfProtection, async (req, res, next) => {
  try {
    const parsed = CreateAdminQuizBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, "Invalid quiz schedule");
    const ownerId = getOwner(res).userId;
    if (!ownerId) { res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" }); return; }
    const result = await quizScheduleMutation(parsed.data, undefined, ownerId);
    if ("error" in result) return res.status(result.error === "INVALID_DATE" || result.error === "INVALID_CONTENT" ? 400 : result.error === "NOT_FOUND" ? 404 : 409).json({ code: result.error, message: result.message });
    const item = await adminQuiz(result.quizId);
    res.status(201).json(CreateAdminQuizResponse.parse(item));
  } catch (error) { next(error); }
});

router.patch("/admin/quiz/quizzes/:quizId", requirePermission("schedule.manage"), csrfProtection, async (req, res, next) => {
  try {
    const params = UpdateAdminQuizParams.safeParse(req.params);
    const parsed = UpdateAdminQuizBody.safeParse(req.body);
    if (!params.success || !parsed.success) return badRequest(res, "Invalid quiz update");
    const ownerId = getOwner(res).userId;
    if (!ownerId) { res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" }); return; }
    const result = await quizScheduleMutation(parsed.data, params.data.quizId, ownerId);
    if ("error" in result) return res.status(result.error === "INVALID_DATE" || result.error === "INVALID_CONTENT" ? 400 : result.error === "NOT_FOUND" ? 404 : 409).json({ code: result.error, message: result.message });
    const item = await adminQuiz(params.data.quizId);
    res.json(UpdateAdminQuizResponse.parse(item));
  } catch (error) { next(error); }
});

router.get("/admin/quiz/quizzes/:quizId/preview", requirePermission("schedule.view"), async (req, res, next) => {
  try {
    const params = PreviewAdminQuizParams.safeParse(req.params);
    if (!params.success) return badRequest(res, "Invalid quiz id");
    const item = await adminQuiz(params.data.quizId);
    if (!item) return res.status(404).json({ code: "NOT_FOUND", message: "Quiz not found" });
    const rows = await db
      .select({
        id: questions.id, versionId: questionVersions.id, prompt: questionVersions.prompt,
        type: questionVersions.type, points: quizQuestions.points,
        choiceId: questionChoices.id, label: questionChoices.label, position: questionChoices.position,
      })
      .from(quizQuestions)
      .innerJoin(questionVersions, eq(quizQuestions.versionId, questionVersions.id))
      .innerJoin(questions, eq(questionVersions.questionId, questions.id))
      .innerJoin(questionChoices, eq(questionVersions.id, questionChoices.versionId))
      .where(and(
        eq(quizQuestions.quizId, params.data.quizId),
        eq(questions.status, "approved"),
        eq(questions.currentVersionId, questionVersions.id),
      ))
      .orderBy(asc(quizQuestions.position), asc(questionChoices.position));
    const grouped = new Map<string, any>();
    for (const row of rows) {
      const current = grouped.get(row.id);
      if (current) current.choices.push({ id: row.choiceId, label: row.label, position: row.position });
      else grouped.set(row.id, { id: row.id, versionId: row.versionId, prompt: row.prompt, type: row.type, points: row.points, choices: [{ id: row.choiceId, label: row.label, position: row.position }] });
    }
    res.json(PreviewAdminQuizResponse.parse({ id: item.id, title: item.title, scheduledDate: item.scheduledDate, timezone: item.timezone, isActive: item.isActive, questions: [...grouped.values()] }));
  } catch (error) { next(error); }
});

router.post("/admin/quiz/generation-runs", requireAdmin, csrfProtection, async (req, res, next) => {
  try {
    const parsed = CreateGenerationRunBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, "Invalid generation run");
    const ownerId = getOwner(res).userId;
    if (!ownerId) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(generationRuns)
        .values({
          requestedBy: ownerId,
          provider: parsed.data.provider,
          model: parsed.data.model,
          promptVersion: parsed.data.promptVersion,
          outputCount: parsed.data.questions.length,
          validationSummary: { status: "pending_review", bounded: true },
        })
        .returning();
      if (!run) throw new Error("Generation run insert did not return a row");
      for (const input of parsed.data.questions) {
        await insertQuestionVersionInTransaction(tx, input, ownerId, "pending_review", {
          provider: parsed.data.provider,
          model: parsed.data.model,
          promptVersion: parsed.data.promptVersion,
          runId: run.id,
        });
      }
      await writeAuditEvent(tx, {
        actorId: ownerId,
        action: "generation_run_created",
        entityType: "generation_run",
        entityId: run.id,
        metadata: { outputCount: run.outputCount },
      });
      return run;
    });
    res.status(201).json(CreateGenerationRunResponse.parse({
      id: result.id,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      outputCount: result.outputCount,
      status: "pending_review",
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/admin/quiz/analytics", requireAdmin, async (_req, res, next) => {
  try {
    const questionRows = await db.select({ status: questions.status, total: count() }).from(questions).groupBy(questions.status);
    const attemptRows = await db.select({ status: quizAttempts.status, total: count() }).from(quizAttempts).groupBy(quizAttempts.status);
    res.json(GetQuizAnalyticsResponse.parse({
      questionCounts: Object.fromEntries(questionRows.map((row) => [row.status, Number(row.total)])),
      attemptCounts: Object.fromEntries(attemptRows.map((row) => [row.status, Number(row.total)])),
    }));
  } catch (error) {
    next(error);
  }
});

export default router;