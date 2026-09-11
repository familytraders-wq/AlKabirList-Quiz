import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { UpdateMyProfileBody, PatchMyProfileBody } from "@workspace/api-zod";
import { csrfProtection } from "../lib/security";
import { getRequestUser, requiredUser } from "../lib/auth";

const router = Router();
const CONSENT_VERSION = "2025-01";

function profileComplete(row: typeof users.$inferSelect) {
  return Boolean(
    row.firstName && row.lastName && row.email && row.country && row.city &&
    row.announcementConsent && row.profileCompletedAt,
  );
}

function present(row: typeof users.$inferSelect) {
  return {
    firstName: row.firstName ?? "",
    lastName: row.lastName ?? "",
    email: row.email ?? "",
    country: row.country ?? "",
    city: row.city ?? "",
    state: row.state,
    announcementConsent: row.announcementConsent,
    consentAt: row.consentAt,
    consentVersion: row.consentVersion,
    profileCompletedAt: row.profileCompletedAt,
    profileComplete: profileComplete(row),
  };
}

router.get("/me/profile", requiredUser, async (req, res, next) => {
  try {
    const user = getRequestUser(req);
    if (!user) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!row) return res.status(404).json({ code: "NOT_FOUND", message: "Profile not found" });
    return res.json(present(row));
  } catch (error) {
    return next(error);
  }
});

async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const user = getRequestUser(req);
    if (!user) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sign-in required" });
    const parsed = (req.method === "PATCH" ? PatchMyProfileBody : UpdateMyProfileBody).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid profile" });
    const current = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!current) return res.status(404).json({ code: "NOT_FOUND", message: "Profile not found" });
    const input = parsed.data;
    const country = input.country === undefined ? current.country : input.country.trim().toUpperCase();
    const state = input.state === undefined ? current.state : (input.state?.trim() || null);
    if (country === "US" && !state) return res.status(400).json({ code: "BAD_REQUEST", message: "State is required for US addresses" });
    if (country !== "US" && input.state !== undefined && state) return res.status(400).json({ code: "BAD_REQUEST", message: "State is only allowed for US addresses" });
    if (input.announcementConsent === false && current.announcementConsent) {
      return res.status(400).json({ code: "BAD_REQUEST", message: "Announcement consent cannot be revoked here" });
    }
    const consent = input.announcementConsent === true || current.announcementConsent;
    const now = new Date();
    const values = {
      ...(input.firstName === undefined ? {} : { firstName: input.firstName.trim() }),
      ...(input.lastName === undefined ? {} : { lastName: input.lastName.trim() }),
      ...(input.email === undefined ? {} : { email: input.email.trim().toLowerCase() }),
      ...(input.country === undefined ? {} : { country }),
      ...(input.city === undefined ? {} : { city: input.city.trim() }),
      ...(country !== "US" || input.state !== undefined || input.country !== undefined
        ? { state: country === "US" ? state : null }
        : {}),
      ...(input.announcementConsent === true && !current.announcementConsent
        ? { announcementConsent: true, consentAt: now, consentVersion: CONSENT_VERSION }
        : {}),
      updatedAt: now,
    };
    const candidate = {
      ...current,
      ...values,
      announcementConsent: consent,
      profileCompletedAt: current.profileCompletedAt ?? now,
    };
    if (!profileComplete(candidate)) return res.status(400).json({ code: "BAD_REQUEST", message: "Complete all profile fields and explicitly consent to announcements" });
    if (!current.profileCompletedAt) Object.assign(values, { profileCompletedAt: now });
    const [updated] = await db.update(users).set(values).where(and(eq(users.id, user.id), eq(users.id, current.id))).returning();
    return res.json(present(updated ?? candidate));
  } catch (error) {
    return next(error);
  }
}

router.put("/me/profile", csrfProtection, requiredUser, updateProfile);
router.patch("/me/profile", csrfProtection, requiredUser, updateProfile);

export default router;