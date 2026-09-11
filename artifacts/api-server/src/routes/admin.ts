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
} from "@workspace/db/schema";
import { getOwner, requireAdmin, requireReviewer } from "../middlewares/auth";
import { csrfProtection } from "../lib/security";

const router: IRouter = Router();

function badRequest(res: Response, message: string) {
  res.status(400).json({ code: "BAD_REQUEST", message });
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

async function insertQuestionVersion(
  input: {
    categoryId?: string;
    difficultyId?: string;
    audienceIds?: string[];
    prompt: string;
    explanation: string;
    type?: "multiple_choice" | "true_false";
    points?: number;
    choices: Array<{ label: string; position: number; isCorrect: boolean }>;
    sourceMetadata: Array<{ title: string; url?: string }>;
  },
  ownerId: string,
  status: "draft" | "pending_review",
  generationMetadata?: { provider: string; model: string; promptVersion: string },
) {
  return db.transaction(async (tx) => {
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
    return question.id;
  });
}

router.use("/admin", requireReviewer);

const roleNames = ["reviewer", "admin"] as const;
type ManagedRole = (typeof roleNames)[number];

function parseManagedRole(value: unknown): ManagedRole | undefined {
  return typeof value === "string" && (roleNames as readonly string[]).includes(value)
    ? (value as ManagedRole)
    : undefined;
}

async function listInternalUsers() {
  const rows = await db
    .select({ id: users.id, createdAt: users.createdAt, role: userRoles.role })
    .from(users)
    .leftJoin(userRoles, sql`${users.id} = ${userRoles.userId}::text`)
    .orderBy(asc(users.createdAt), asc(users.id));
  const grouped = new Map<string, { id: string; createdAt: Date; roles: ManagedRole[] }>();
  for (const row of rows) {
    const existing = grouped.get(row.id) ?? { id: row.id, createdAt: row.createdAt, roles: [] };
    if (row.role) existing.roles.push(row.role);
    grouped.set(row.id, existing);
  }
  return [...grouped.values()];
}

router.get("/admin/users", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ items: await listInternalUsers() });
  } catch (error) {
    next(error);
  }
});

async function changeUserRole(
  userId: string,
  actorId: string,
  role: ManagedRole,
  action: "grant" | "revoke",
) {
  return db.transaction(async (tx) => {
    // Serialize every role mutation so two concurrent revokes cannot both
    // observe a safe admin count and remove the final administrator.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('alkabir-admin-role-mutations'))`);
    const [actorRole] = await tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(sql`${userRoles.userId}::text = ${actorId}`, eq(userRoles.role, "admin")))
      .limit(1);
    if (!actorRole) return { error: "ACTOR_NOT_ADMIN" as const };
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!target) return { error: "NOT_FOUND" as const };
    if (action === "revoke" && role === "admin" && userId === actorId) {
      return { error: "SELF_ADMIN_REVOKE" as const };
    }
    if (action === "grant") {
      await tx.insert(userRoles).values({ userId, role, grantedByUserId: actorId }).onConflictDoNothing({
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
      await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
    }
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
      if (result.error === "ACTOR_NOT_ADMIN") return res.status(403).json({ code: "FORBIDDEN", message: "Administrator role is required" });
      if (result.error === "NOT_FOUND") return res.status(404).json({ code: "NOT_FOUND", message: "User not found" });
      if (result.error === "SELF_ADMIN_REVOKE") return res.status(409).json({ code: "SELF_ADMIN_REVOKE", message: "You cannot revoke your own admin role" });
      return res.status(409).json({ code: "LAST_ADMIN", message: "At least one administrator must remain" });
    }
    const items = await listInternalUsers();
    const item = items.find((entry) => entry.id === userId);
    const output = { id: item?.id, roles: item?.roles ?? [], createdAt: item?.createdAt };
    res.json((action === "grant" ? GrantAdminUserRoleResponse : RevokeAdminUserRoleResponse).parse(output));
  } catch (error) {
    next(error);
  }
}

router.post("/admin/users/:userId/roles", requireAdmin, csrfProtection, (req, res, next) => roleMutation(req, res, next, "grant"));
router.delete("/admin/users/:userId/roles", requireAdmin, csrfProtection, (req, res, next) => roleMutation(req, res, next, "revoke"));

router.get("/admin/quiz/questions", async (req, res, next) => {
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

router.post("/admin/quiz/questions", csrfProtection, async (req, res, next) => {
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

router.patch("/admin/quiz/questions/:questionId", csrfProtection, async (req, res, next) => {
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
      return version;
    });
    const item = await adminQuestion(question.id);
    res.json(UpdateAdminQuestionResponse.parse({ ...item, versionId: result.id, version: result.version }));
  } catch (error) {
    next(error);
  }
});

router.post("/admin/quiz/questions/:questionId/reviews", csrfProtection, async (req, res, next) => {
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
    return { quizId: quiz.id };
  });
}

router.get("/admin/quiz/quizzes", async (_req, res, next) => {
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

router.post("/admin/quiz/quizzes", csrfProtection, async (req, res, next) => {
  try {
    const parsed = CreateAdminQuizBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, "Invalid quiz schedule");
    const result = await quizScheduleMutation(parsed.data);
    if ("error" in result) return res.status(result.error === "INVALID_DATE" || result.error === "INVALID_CONTENT" ? 400 : result.error === "NOT_FOUND" ? 404 : 409).json({ code: result.error, message: result.message });
    const item = await adminQuiz(result.quizId);
    res.status(201).json(CreateAdminQuizResponse.parse(item));
  } catch (error) { next(error); }
});

router.patch("/admin/quiz/quizzes/:quizId", csrfProtection, async (req, res, next) => {
  try {
    const params = UpdateAdminQuizParams.safeParse(req.params);
    const parsed = UpdateAdminQuizBody.safeParse(req.body);
    if (!params.success || !parsed.success) return badRequest(res, "Invalid quiz update");
    const result = await quizScheduleMutation(parsed.data, params.data.quizId);
    if ("error" in result) return res.status(result.error === "INVALID_DATE" || result.error === "INVALID_CONTENT" ? 400 : result.error === "NOT_FOUND" ? 404 : 409).json({ code: result.error, message: result.message });
    const item = await adminQuiz(params.data.quizId);
    res.json(UpdateAdminQuizResponse.parse(item));
  } catch (error) { next(error); }
});

router.get("/admin/quiz/quizzes/:quizId/preview", async (req, res, next) => {
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
        await insertQuestionVersionInTransaction(tx, input, ownerId, run.id, parsed.data);
      }
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

async function insertQuestionVersionInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    categoryId?: string;
    difficultyId?: string;
    audienceIds?: string[];
    prompt: string;
    explanation: string;
    type?: "multiple_choice" | "true_false";
    points?: number;
    choices: Array<{ label: string; position: number; isCorrect: boolean }>;
    sourceMetadata: Array<{ title: string; url?: string }>;
  },
  ownerId: string,
  runId: string,
  run: { provider: string; model: string; promptVersion: string },
) {
  if (!validateChoices(input.choices)) throw new Error("Generated question has invalid answer cardinality");
  const [question] = await tx.insert(questions).values({
    categoryId: input.categoryId,
    difficultyId: input.difficultyId,
    status: "pending_review",
    createdBy: ownerId,
  }).returning();
  if (!question) throw new Error("Generated question insert did not return a row");
  const [version] = await tx.insert(questionVersions).values({
    questionId: question.id,
    version: 1,
    prompt: input.prompt,
    explanation: input.explanation,
    type: input.type,
    points: input.points,
    sourceMetadata: input.sourceMetadata,
    createdBy: ownerId,
    generationMetadata: { provider: run.provider, model: run.model, promptVersion: run.promptVersion, runId },
  }).returning();
  if (!version) throw new Error("Generated version insert did not return a row");
  await tx.update(questions).set({ currentVersionId: version.id }).where(eq(questions.id, question.id));
  await tx.insert(questionChoices).values(input.choices.map((choice) => ({ ...choice, versionId: version.id })));
  if (input.audienceIds?.length) {
    await tx.insert(questionAudiences).values(input.audienceIds.map((audienceId) => ({ questionId: question.id, audienceId })));
  }
}

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