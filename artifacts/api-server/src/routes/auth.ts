import { Router } from "express";
import { and, eq, isNull, gt, count } from "drizzle-orm";
import { db } from "@workspace/db";
import { anonymousSessions, quizAttempts } from "@workspace/db/schema";
import {
  getRequestUser,
  optionalUser,
  requiredUser,
} from "../lib/auth";
import {
  csrfProtection,
  getAnonymousToken,
  hashAnonymousToken,
  rotateAnonymousCookie,
} from "../lib/security";
import { GuestLinkError, linkGuestProgress } from "../lib/linking";

const router = Router();

router.get("/auth/me", optionalUser, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    const anonymousToken = getAnonymousToken(req);
    let guestAttemptCount = 0;

    if (anonymousToken) {
      const tokenHash = hashAnonymousToken(anonymousToken);
      const session = await db.query.anonymousSessions.findFirst({
        where: and(
          eq(anonymousSessions.tokenHash, tokenHash),
          isNull(anonymousSessions.revokedAt),
          gt(anonymousSessions.expiresAt, new Date()),
        ),
      });

      if (session) {
        const [result] = await db
          .select({ count: count() })
          .from(quizAttempts)
          .where(eq(quizAttempts.anonymousSessionId, session.id));
        guestAttemptCount = Number(result?.count ?? 0);
      }
    }

    res.json({
      authenticated: Boolean(user),
      user: user
        ? {
            id: user.id,
            roles: user.roles,
          }
        : null,
      guestProgress: {
        count: guestAttemptCount,
        hasUnlinkedProgress: guestAttemptCount > 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/auth/link-guest-progress",
  csrfProtection,
  requiredUser,
  async (req, res, next) => {
    try {
      if (req.body?.confirm !== true) {
        res.status(400).json({
          error: "Explicit confirmation is required to link guest progress",
        });
        return;
      }

      const user = getRequestUser(req);
      const anonymousToken = getAnonymousToken(req);
      if (!user || !anonymousToken) {
        res.status(404).json({ error: "Guest progress was not found" });
        return;
      }

      const result = await linkGuestProgress(anonymousToken, user.id);
      await rotateAnonymousCookie(res);

      res.status(200).json({
        linked: true,
        linkedAttemptCount: result.linkedAttemptCount,
      });
    } catch (error) {
      if (error instanceof GuestLinkError) {
        res
          .status(error.code === "expired" ? 410 : 404)
          .json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

export default router;