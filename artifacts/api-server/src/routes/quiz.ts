import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  AnswerQuizQuestionBody,
  AnswerQuizQuestionResponse,
  CompleteQuizAttemptResponse,
  GetQuizAttemptParams,
  GetQuizAttemptResponse,
  GetQuizConfigResponse,
  GetQuizResultParams,
  GetQuizResultResponse,
  GetQuizHistoryResponse,
  GetQuizProgressResponse,
  StartQuizAttemptBody,
  StartQuizAttemptResponse,
} from "@workspace/api-zod";
import {
  attemptAnswers,
  dailyCompletions,
  dailyRewards,
  questionChoices,
  questionVersions,
  questions,
  quizAttempts,
  quizQuestions,
  quizzes,
  rewardLedger,
  taxonomies,
} from "@workspace/db/schema";
import { getOwner, requireUser } from "../middlewares/auth";
import { addUtcDays, canonicalDateFrom } from "../lib/daily-policy";

const router: IRouter = Router();

class QuizInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function badRequest(res: Response, message: string) {
  res.status(400).json({ code: "BAD_REQUEST", message });
}

function ownerWhere(attemptId: string, res: Response) {
  const owner = getOwner(res);
  return and(
    eq(quizAttempts.id, attemptId),
    owner.userId
      ? and(eq(quizAttempts.userId, owner.userId), isNull(quizAttempts.anonymousSessionId))
      : and(
          eq(quizAttempts.anonymousSessionId, owner.anonymousSessionId!),
          isNull(quizAttempts.userId),
        ),
  );
}

async function publicQuestions(quizId: string) {
  const rows = await db
    .select({
      questionId: questions.id,
      versionId: questionVersions.id,
      prompt: questionVersions.prompt,
      type: questionVersions.type,
      points: quizQuestions.points,
      choiceId: questionChoices.id,
      choiceLabel: questionChoices.label,
      choicePosition: questionChoices.position,
    })
    .from(quizQuestions)
    .innerJoin(questionVersions, eq(quizQuestions.versionId, questionVersions.id))
    .innerJoin(questions, eq(questionVersions.questionId, questions.id))
    .innerJoin(questionChoices, eq(questionVersions.id, questionChoices.versionId))
    .where(
      and(
        eq(quizQuestions.quizId, quizId),
        eq(questions.status, "approved"),
        eq(questions.currentVersionId, questionVersions.id),
      ),
    )
    .orderBy(asc(quizQuestions.position), asc(questionChoices.position));

  const byQuestion = new Map<string, (typeof rows)[number] & { choices: { id: string; label: string; position: number }[] }>();
  for (const row of rows) {
    const current = byQuestion.get(row.questionId);
    if (current) {
      current.choices.push({
        id: row.choiceId,
        label: row.choiceLabel,
        position: row.choicePosition,
      });
    } else {
      byQuestion.set(row.questionId, {
        ...row,
        choices: [{ id: row.choiceId, label: row.choiceLabel, position: row.choicePosition }],
      });
    }
  }
  return [...byQuestion.values()].map((row) => ({
    id: row.questionId,
    versionId: row.versionId,
    prompt: row.prompt,
    type: row.type,
    points: row.points,
    choices: row.choices,
  }));
}

async function attemptState(attemptId: string, res: Response) {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(ownerWhere(attemptId, res))
    .limit(1);
  if (!attempt) return undefined;
  const result = {
    attemptId: attempt.id,
    quizId: attempt.quizId,
    status: attempt.status as "in_progress" | "completed",
    questions: await publicQuestions(attempt.quizId),
    answeredQuestionIds: (
      await db
        .select({ versionId: attemptAnswers.versionId })
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, attempt.id))
    ).map(({ versionId }) => versionId),
  };
  return StartQuizAttemptResponse.parse(result);
}

router.get("/quiz/config", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: taxonomies.id,
        kind: taxonomies.kind,
        slug: taxonomies.slug,
        label: taxonomies.label,
      })
      .from(taxonomies)
      .where(eq(taxonomies.isActive, true))
      .orderBy(asc(taxonomies.sortOrder));
    const result = GetQuizConfigResponse.parse({
      featureName: "AlKabir Islamic Challenge",
      dailyTimezone: process.env.QUIZ_TIMEZONE ?? "UTC",
      categories: rows.filter((row) => row.kind === "category"),
      audiences: rows.filter((row) => row.kind === "audience"),
      difficulties: rows.filter((row) => row.kind === "difficulty"),
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/quiz/attempts", async (req, res, next) => {
  try {
    const parsed = StartQuizAttemptBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, "Invalid quiz start request");
    const { quizId, idempotencyKey: bodyKey } = parsed.data;
    const idempotencyKey =
      req.header("Idempotency-Key") ?? bodyKey ?? randomUUID();
    const owner = getOwner(res);
    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.isActive, true)))
      .limit(1);
    if (!quiz) return res.status(404).json({ code: "NOT_FOUND", message: "Quiz not found" });

    const result = await db.transaction(async (tx) => {
      const ownerFilter = owner.userId
        ? and(eq(quizAttempts.userId, owner.userId), isNull(quizAttempts.anonymousSessionId))
        : and(
            eq(quizAttempts.anonymousSessionId, owner.anonymousSessionId!),
            isNull(quizAttempts.userId),
          );
      const existing = await tx
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.quizId, quizId), ownerFilter, eq(quizAttempts.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existing[0]) return existing[0];
      const [created] = await tx
        .insert(quizAttempts)
        .values({
          quizId,
          userId: owner.userId,
          anonymousSessionId: owner.anonymousSessionId,
          idempotencyKey,
        })
        .returning();
      return created;
    });
    const state = await attemptState(result.id, res);
    if (!state || state.questions.length === 0) {
      return res.status(409).json({ code: "NO_APPROVED_CONTENT", message: "This quiz has no approved questions" });
    }
    res.status(201).json(state);
  } catch (error) {
    return next(error);
  }
});

router.get("/quiz/attempts/:attemptId", async (req, res, next) => {
  try {
    const parsed = GetQuizAttemptParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, "Invalid attempt id");
    const state = await attemptState(parsed.data.attemptId, res);
    if (!state) return res.status(404).json({ code: "NOT_FOUND", message: "Attempt not found" });
    res.json(GetQuizAttemptResponse.parse(state));
  } catch (error) {
    next(error);
  }
});

router.post("/quiz/attempts/:attemptId/answers", async (req, res, next) => {
  try {
    const parsedBody = AnswerQuizQuestionBody.safeParse(req.body);
    if (!parsedBody.success) return badRequest(res, "Invalid answer request");
    const attemptId = String(req.params.attemptId);
    const input = parsedBody.data;
    const scored = await db.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(quizAttempts)
        .where(ownerWhere(attemptId, res))
        .for("update")
        .limit(1);
      if (!attempt) return undefined;
      if (attempt.status !== "in_progress") {
        throw new QuizInputError("ATTEMPT_COMPLETED", "Attempt is already complete");
      }
      const existing = await tx
        .select()
        .from(attemptAnswers)
        .where(
          and(
            eq(attemptAnswers.attemptId, attemptId),
            or(
              eq(attemptAnswers.idempotencyKey, input.idempotencyKey),
              eq(attemptAnswers.versionId, input.versionId),
            ),
          ),
        )
        .limit(1);
      if (existing[0]) {
        const [version] = await tx
          .select()
          .from(questionVersions)
          .where(eq(questionVersions.id, existing[0].versionId));
        return {
          versionId: existing[0].versionId,
          choiceId: existing[0].choiceId,
          isCorrect: existing[0].isCorrect,
          awardedPoints: existing[0].awardedPoints,
          explanation: version?.explanation ?? "",
          sources: version?.sourceMetadata ?? [],
        };
      }
      const [membership] = await tx
        .select({ points: quizQuestions.points, version: questionVersions })
        .from(quizQuestions)
        .innerJoin(questionVersions, eq(quizQuestions.versionId, questionVersions.id))
        .where(
          and(
            eq(quizQuestions.quizId, attempt.quizId),
            eq(quizQuestions.versionId, input.versionId),
          ),
        )
        .limit(1);
      if (!membership) throw new QuizInputError("INVALID_QUESTION", "Question is not in this quiz");
      const [choice] = await tx
        .select()
        .from(questionChoices)
        .where(
          and(
            eq(questionChoices.id, input.choiceId),
            eq(questionChoices.versionId, input.versionId),
          ),
        )
        .limit(1);
      if (!choice) throw new QuizInputError("INVALID_CHOICE", "Choice is not valid for this question");
      const isCorrect = choice.isCorrect;
      const awardedPoints = isCorrect ? membership.points : 0;
      const [inserted] = await tx
        .insert(attemptAnswers)
        .values({
          attemptId,
          versionId: input.versionId,
          choiceId: input.choiceId,
          isCorrect,
          awardedPoints,
          responseTimeMs: input.responseTimeMs,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [winner] = await tx
          .select()
          .from(attemptAnswers)
          .where(
            and(
              eq(attemptAnswers.attemptId, attemptId),
              or(
                eq(attemptAnswers.idempotencyKey, input.idempotencyKey),
                eq(attemptAnswers.versionId, input.versionId),
              ),
            ),
          )
          .limit(1);
        if (!winner) {
          throw new Error("Concurrent answer could not be recovered");
        }
        const [winnerVersion] = await tx
          .select()
          .from(questionVersions)
          .where(eq(questionVersions.id, winner.versionId))
          .limit(1);
        return {
          versionId: winner.versionId,
          choiceId: winner.choiceId,
          isCorrect: winner.isCorrect,
          awardedPoints: winner.awardedPoints,
          explanation: winnerVersion?.explanation ?? "",
          sources: winnerVersion?.sourceMetadata ?? [],
        };
      }
      return {
        versionId: input.versionId,
        choiceId: input.choiceId,
        isCorrect,
        awardedPoints,
        explanation: membership.version.explanation,
        sources: membership.version.sourceMetadata,
      };
    });
    if (!scored) {
      return res.status(404).json({ code: "NOT_FOUND", message: "Attempt not found" });
    }
    res.json(
      AnswerQuizQuestionResponse.parse(scored),
    );
  } catch (error) {
    if (error instanceof QuizInputError) {
      if (error.code === "ATTEMPT_COMPLETED") {
        return res.status(409).json({ code: error.code, message: error.message });
      }
      return res.status(400).json({ code: error.code, message: error.message });
    }
    next(error);
  }
});

async function resultFor(attemptId: string, res: Response) {
  const [attempt] = await db.select().from(quizAttempts).where(ownerWhere(attemptId, res)).limit(1);
  if (!attempt) return undefined;
  const rows = await db
    .select({ answer: attemptAnswers, version: questionVersions })
    .from(attemptAnswers)
    .innerJoin(questionVersions, eq(attemptAnswers.versionId, questionVersions.id))
    .where(eq(attemptAnswers.attemptId, attemptId))
    .orderBy(asc(attemptAnswers.answeredAt));
  const [reward] = attempt.userId
    ? await db
        .select({ points: rewardLedger.points })
        .from(rewardLedger)
        .where(and(eq(rewardLedger.attemptId, attemptId), eq(rewardLedger.userId, attempt.userId)))
        .limit(1)
    : [];
  return CompleteQuizAttemptResponse.parse({
    attemptId,
    status: attempt.status,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore ?? 0,
    answers: rows.map(({ answer, version }) => ({
      versionId: answer.versionId,
      choiceId: answer.choiceId,
      isCorrect: answer.isCorrect,
      awardedPoints: answer.awardedPoints,
      explanation: version.explanation,
      sources: version.sourceMetadata,
    })),
    rewardPoints: reward?.points,
  });
}

router.post("/quiz/attempts/:attemptId/complete", async (req, res, next) => {
  try {
    const attemptId = String(req.params.attemptId);
    const owner = getOwner(res);
    const completed = await db.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(quizAttempts)
        .where(ownerWhere(attemptId, res))
        .for("update")
        .limit(1);
      if (!attempt) return undefined;
      if (attempt.status === "completed") return attempt;
      const [totals] = await tx
        .select({
          score: sql<number>`coalesce(sum(${attemptAnswers.awardedPoints}), 0)`,
          answered: sql<number>`count(${attemptAnswers.id})`,
        })
        .from(attemptAnswers)
        .where(eq(attemptAnswers.attemptId, attemptId));
      const [max] = await tx
        .select({ maxScore: sql<number>`coalesce(sum(${quizQuestions.points}), 0)` })
        .from(quizQuestions)
        .where(eq(quizQuestions.quizId, attempt.quizId));
      const [questionTotal] = await tx
        .select({ questionCount: count(quizQuestions.versionId) })
        .from(quizQuestions)
        .where(eq(quizQuestions.quizId, attempt.quizId));
      if (
        Number(totals?.answered ?? 0) <
        Number(questionTotal?.questionCount ?? 0)
      ) {
        throw new QuizInputError(
          "INCOMPLETE_ATTEMPT",
          "Answer every question before completing the quiz",
        );
      }
      const [updated] = await tx
        .update(quizAttempts)
        .set({
          status: "completed",
          score: Number(totals?.score ?? 0),
          maxScore: Number(max?.maxScore ?? 0),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.status, "in_progress")))
        .returning();
      if (updated && owner.userId) {
        const points = Number(totals?.score ?? 0);
        const [quiz] = await tx
          .select({ scheduledDate: quizzes.scheduledDate })
          .from(quizzes)
          .where(eq(quizzes.id, attempt.quizId))
          .limit(1);

        if (quiz?.scheduledDate) {
          const challengeDate = canonicalDateFrom(quiz.scheduledDate);
          const previousDate = addUtcDays(challengeDate, -1);
          const [previousCompletion] = await tx
            .select({ streak: dailyCompletions.streak })
            .from(dailyCompletions)
            .where(
              and(
                eq(dailyCompletions.memberId, owner.userId),
                eq(dailyCompletions.challengeDate, previousDate),
              ),
            )
            .limit(1);
          const [dailyCompletion] = await tx
            .insert(dailyCompletions)
            .values({
              attemptId,
              memberId: owner.userId,
              challengeDate,
              completedAt: updated.completedAt ?? new Date(),
              streak: (previousCompletion?.streak ?? 0) + 1,
            })
            .onConflictDoNothing({
              target: [
                dailyCompletions.memberId,
                dailyCompletions.challengeDate,
              ],
            })
            .returning();

          if (dailyCompletion) {
            await tx
              .insert(dailyRewards)
              .values({
                memberId: owner.userId,
                challengeDate,
                points,
              })
              .onConflictDoNothing({
                target: [dailyRewards.memberId, dailyRewards.challengeDate],
              });
            await tx
              .insert(rewardLedger)
              .values({
                userId: owner.userId,
                attemptId,
                eventKey: `daily-completion:${owner.userId}:${challengeDate}`,
                points,
              })
              .onConflictDoNothing({ target: rewardLedger.eventKey });
          }
        } else {
          await tx
            .insert(rewardLedger)
            .values({
              userId: owner.userId,
              attemptId,
              eventKey: `quiz-completion:${attemptId}`,
              points,
            })
            .onConflictDoNothing({ target: rewardLedger.eventKey });
        }
      }
      return updated ?? attempt;
    });
    if (!completed) return res.status(404).json({ code: "NOT_FOUND", message: "Attempt not found" });
    const result = await resultFor(attemptId, res);
    return res.json(result);
  } catch (error) {
    if (error instanceof QuizInputError && error.code === "INCOMPLETE_ATTEMPT") {
      return res.status(409).json({ code: error.code, message: error.message });
    }
    return next(error);
  }
});

router.get("/quiz/results/:attemptId", async (req, res, next) => {
  try {
    const parsed = GetQuizResultParams.safeParse(req.params);
    if (!parsed.success) return badRequest(res, "Invalid attempt id");
    const result = await resultFor(parsed.data.attemptId, res);
    if (!result) return res.status(404).json({ code: "NOT_FOUND", message: "Result not found" });
    res.json(GetQuizResultResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

router.get("/me/quiz/history", requireUser, async (_req, res, next) => {
  try {
    const owner = getOwner(res);
    const attempts = await db
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, owner.userId!), eq(quizAttempts.status, "completed")))
      .orderBy(desc(quizAttempts.completedAt));
    const items = [];
    for (const attempt of attempts) {
      const result = await resultFor(attempt.id, res);
      if (result) items.push(result);
    }
    res.json(GetQuizHistoryResponse.parse({ items }));
  } catch (error) {
    next(error);
  }
});

router.get("/me/quiz/progress", requireUser, async (_req, res, next) => {
  try {
    const owner = getOwner(res);
    const [[totals], [latestDailyCompletion]] = await Promise.all([
      db
        .select({ points: sql<number>`coalesce(sum(${rewardLedger.points}), 0)` })
        .from(rewardLedger)
        .where(eq(rewardLedger.userId, owner.userId!)),
      db
        .select({
          challengeDate: dailyCompletions.challengeDate,
          streak: dailyCompletions.streak,
        })
        .from(dailyCompletions)
        .where(eq(dailyCompletions.memberId, owner.userId!))
        .orderBy(desc(dailyCompletions.challengeDate))
        .limit(1),
    ]);
    res.json(
      GetQuizProgressResponse.parse({
        points: Number(totals?.points ?? 0),
        currentStreak: latestDailyCompletion?.streak ?? 0,
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;