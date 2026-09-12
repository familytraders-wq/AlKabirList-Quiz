import { Router } from "express";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  memberFeedback,
  questionVersions,
  questions,
  dailyCompletions,
  quizAttempts,
  quizzes,
  users,
  operatorAuditEvents,
} from "@workspace/db/schema";
import {
  CreateMyFeedbackBody,
  CreateMyFeedbackResponse,
  ListMyFeedbackResponse,
  ListBetaFeedbackQueryParams,
  ListBetaFeedbackResponse,
  ModerateBetaFeedbackParams,
  ModerateBetaFeedbackBody,
  ModerateBetaFeedbackResponse,
  GetBetaSummaryResponse,
  ListBetaAuditQueryParams,
  ListBetaAuditResponse,
} from "@workspace/api-zod";
import { getRequestUser, requiredUser } from "../lib/auth";
import { csrfProtection } from "../lib/security";
import { requireAdmin, requireReviewer } from "../middlewares/auth";
import { writeAuditEvent } from "../lib/audit";

const router = Router();
const since7d = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const present = (row: typeof memberFeedback.$inferSelect) => ({
  id: row.id,
  kind: row.kind,
  message: row.message,
  status: row.status,
  questionId: row.questionId,
  questionVersionId: row.questionVersionId,
  resolutionNote: row.resolutionNote,
  resolvedAt: row.resolvedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

router.get("/me/feedback", requiredUser, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (!user) { res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" }); return; }
    const items = await db.select().from(memberFeedback)
      .where(eq(memberFeedback.submitterId, user.id))
      .orderBy(desc(memberFeedback.createdAt));
    res.json(ListMyFeedbackResponse.parse({ items: items.map(present), total: items.length }));
  } catch (error) { next(error); }
});

router.post("/me/feedback", csrfProtection, requiredUser, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (!user) { res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" }); return; }
    const profile = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!profile?.profileCompletedAt) { res.status(403).json({ code: "PROFILE_REQUIRED", message: "Complete your profile first" }); return; }
    const parsed = CreateMyFeedbackBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ code: "BAD_REQUEST", message: "Invalid feedback" }); return; }
    let questionId: string | null = null;
    let questionVersionId: string | null = null;
    if (parsed.data.kind === "question_accuracy") {
      if (!parsed.data.questionVersionId) {
        res.status(400).json({ code: "QUESTION_VERSION_REQUIRED", message: "The current question version is required" }); return;
      }
      // The version is the canonical client reference. Resolve its question
      // server-side and only accept it while it is still current.
      const [question] = await db.select({ id: questions.id })
        .from(questions).innerJoin(questionVersions, eq(questionVersions.questionId, questions.id))
        .where(and(eq(questionVersions.id, parsed.data.questionVersionId), eq(questions.currentVersionId, parsed.data.questionVersionId)));
      if (!question) { res.status(400).json({ code: "INVALID_QUESTION", message: "Question version is not current" }); return; }
      if (parsed.data.questionId && parsed.data.questionId !== question.id) {
        res.status(400).json({ code: "QUESTION_MISMATCH", message: "Question does not match the supplied version" }); return;
      }
      questionId = question.id;
      questionVersionId = parsed.data.questionVersionId;
    }
    const [row] = await db.insert(memberFeedback).values({
      submitterId: user.id,
      kind: parsed.data.kind,
      message: parsed.data.message,
      // Never retain browser-supplied question references for non-question
      // feedback, and never trust questionId as the source of truth.
      questionId,
      questionVersionId,
    }).returning();
    if (!row) throw new Error("Feedback insert did not return a row");
    res.status(201).json(CreateMyFeedbackResponse.parse(present(row)));
  } catch (error) { next(error); }
});

router.get("/admin/beta/feedback", requireReviewer, async (req, res, next) => {
  try {
    const parsed = ListBetaFeedbackQueryParams.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ code: "BAD_REQUEST", message: "Invalid feedback filters" }); return; }
    const filter = and(
      parsed.data.status ? eq(memberFeedback.status, parsed.data.status) : undefined,
      parsed.data.kind ? eq(memberFeedback.kind, parsed.data.kind) : undefined,
    );
    const items = await db.select().from(memberFeedback).where(filter).orderBy(desc(memberFeedback.createdAt)).limit(parsed.data.limit).offset(parsed.data.offset);
    const [total] = await db.select({ total: count() }).from(memberFeedback).where(filter);
    res.json(ListBetaFeedbackResponse.parse({ items: items.map(present), total: Number(total?.total ?? 0) }));
  } catch (error) { next(error); }
});

router.patch("/admin/beta/feedback/:feedbackId", requireReviewer, csrfProtection, async (req, res, next) => {
  try {
    const params = ModerateBetaFeedbackParams.safeParse(req.params);
    const parsed = ModerateBetaFeedbackBody.safeParse(req.body);
    const user = getRequestUser(req);
    if (!user) { res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" }); return; }
    if (!params.success || !parsed.success) { res.status(400).json({ code: "BAD_REQUEST", message: "Invalid moderation request" }); return; }
    const [row] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(memberFeedback).set({
        status: parsed.data.status,
        resolutionNote: ["resolved", "dismissed"].includes(parsed.data.status)
          ? parsed.data.resolutionNote ?? null
          : null,
        resolvedById: ["resolved", "dismissed"].includes(parsed.data.status) ? user.id : null,
        resolvedAt: ["resolved", "dismissed"].includes(parsed.data.status) ? new Date() : null,
        updatedAt: new Date(),
      }).where(and(eq(memberFeedback.id, params.data.feedbackId), eq(memberFeedback.status, parsed.data.expectedStatus))).returning();
      if (updated) {
        await writeAuditEvent(tx, {
          actorId: user.id,
          action: "feedback_moderated",
          entityType: "member_feedback",
          entityId: updated.id,
          metadata: { fromStatus: parsed.data.expectedStatus, toStatus: parsed.data.status },
        });
      }
      return updated ? [updated] : [];
    });
    if (!row) { res.status(409).json({ code: "STALE_FEEDBACK", message: "Feedback status changed; reload before moderating" }); return; }
    res.json(ModerateBetaFeedbackResponse.parse(present(row)));
  } catch (error) { next(error); }
});

router.get("/admin/beta/summary", requireReviewer, async (_req, res, next) => {
  try {
    const since = since7d();
    const [members] = await db.select({ total: count() }).from(users);
    const [profiles] = await db.select({ total: count() }).from(users).where(sql`${users.profileCompletedAt} is not null`);
    const [active] = await db.select({ total: count() }).from(users).where(gte(users.updatedAt, since));
    const [completions] = await db.select({ total: count() }).from(quizAttempts).where(and(eq(quizAttempts.status, "completed"), gte(quizAttempts.completedAt, since)));
    const [unique] = await db.select({ total: sql<number>`count(distinct ${dailyCompletions.memberId})` }).from(dailyCompletions).where(gte(dailyCompletions.completedAt, since));
    const [open] = await db.select({ total: count() }).from(memberFeedback).where(inArray(memberFeedback.status, ["open", "in_review"]));
    const [pending] = await db.select({ total: count() }).from(questions).where(eq(questions.status, "pending_review"));
    const [approved] = await db.select({ total: count() }).from(questions).where(eq(questions.status, "approved"));
    const [ahead] = await db.select({ total: sql<number>`count(distinct ${quizzes.scheduledDate})` }).from(quizzes).where(and(eq(quizzes.isActive, true), sql`${quizzes.scheduledDate} >= (now() at time zone 'UTC')::date`));
    const result = await db.execute(sql`select to_char(day::date, 'YYYY-MM-DD') as date, count(distinct u.id)::int as signups, count(distinct dc.id)::int as completions, count(distinct dc.member_id)::int as "uniqueCompleters" from generate_series((now() at time zone 'UTC')::date - 6, (now() at time zone 'UTC')::date, interval '1 day') day left join users u on (u.created_at at time zone 'UTC')::date = day::date left join daily_completions dc on dc.challenge_date = day::date group by day order by day`);
    const rows = "rows" in result ? result.rows : result;
    const series = (rows as Array<Record<string, unknown>>).map((r) => ({ date: String(r.date), signups: Number(r.signups), completions: Number(r.completions), uniqueCompleters: Number(r.uniqueCompleters) }));
    res.json(GetBetaSummaryResponse.parse({ totalMembers: Number(members?.total ?? 0), completedProfiles: Number(profiles?.total ?? 0), activeMembers7d: Number(active?.total ?? 0), uniqueCompleters7d: Number(unique?.total ?? 0), quizCompletions7d: Number(completions?.total ?? 0), openFeedback: Number(open?.total ?? 0), pendingReviewQuestions: Number(pending?.total ?? 0), approvedQuestions: Number(approved?.total ?? 0), scheduledActiveDaysAhead: Number(ahead?.total ?? 0), series }));
  } catch (error) { next(error); }
});

router.get("/admin/beta/audit", requireAdmin, async (req, res, next) => {
  try {
    const parsed = ListBetaAuditQueryParams.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ code: "BAD_REQUEST", message: "Invalid audit filters" }); return; }
    const filter = and(parsed.data.action ? eq(operatorAuditEvents.action, parsed.data.action) : undefined, parsed.data.entityType ? eq(operatorAuditEvents.entityType, parsed.data.entityType) : undefined);
    const items = await db.select().from(operatorAuditEvents).where(filter).orderBy(desc(operatorAuditEvents.createdAt)).limit(parsed.data.limit).offset(parsed.data.offset);
    const [total] = await db.select({ total: count() }).from(operatorAuditEvents).where(filter);
    res.json(ListBetaAuditResponse.parse({ items, total: Number(total?.total ?? 0) }));
  } catch (error) { next(error); }
});

export default router;