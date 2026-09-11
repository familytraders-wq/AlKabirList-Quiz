import { db } from "@workspace/db";
import {
  anonymousSessions,
  guestProgressLinks,
  quizAttempts,
} from "@workspace/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashAnonymousToken } from "./security";

export type GuestLinkResult = {
  linkedAttemptCount: number;
  anonymousSessionId: string;
};

export async function linkGuestProgress(
  anonymousToken: string,
  userId: string,
): Promise<GuestLinkResult> {
  const tokenHash = hashAnonymousToken(anonymousToken);

  return db.transaction(async (tx) => {
    const now = new Date();
    // Claim the session with a guarded update. PostgreSQL serializes concurrent
    // link attempts on this row, so only one request can transfer the attempts.
    const [session] = await tx
      .update(anonymousSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(anonymousSessions.tokenHash, tokenHash),
          isNull(anonymousSessions.revokedAt),
          gt(anonymousSessions.expiresAt, now),
        ),
      )
      .returning();

    if (!session) {
      const existing = await tx.query.anonymousSessions.findFirst({
        where: eq(anonymousSessions.tokenHash, tokenHash),
      });
      const expired = Boolean(
        existing && existing.expiresAt.getTime() <= Date.now(),
      );
      throw new GuestLinkError(
        expired ? "Guest session expired" : "Guest progress was not found",
        expired ? "expired" : "not_found",
      );
    }

    const linkedAttempts = await tx
      .update(quizAttempts)
      .set({
        userId,
        anonymousSessionId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quizAttempts.anonymousSessionId, session.id),
          isNull(quizAttempts.userId),
        ),
      )
      .returning({ id: quizAttempts.id });

    await tx.insert(guestProgressLinks).values({
      userId,
      anonymousSessionId: session.id,
      linkedAttemptCount: linkedAttempts.length,
    });

    return {
      linkedAttemptCount: linkedAttempts.length,
      anonymousSessionId: session.id,
    };
  });
}

export class GuestLinkError extends Error {
  constructor(
    message: string,
    readonly code: "expired" | "not_found",
  ) {
    super(message);
    this.name = "GuestLinkError";
  }
}