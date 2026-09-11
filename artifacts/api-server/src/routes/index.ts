import { Router, type IRouter } from "express";
import healthRouter from "./health";
import quizRouter from "./quiz";
import adminRouter from "./admin";
import authRouter from "./auth";
import profileRouter from "./profile";

const router: IRouter = Router();
router.use(healthRouter);
router.use(quizRouter);
router.use(adminRouter);
router.use(authRouter);
router.use(profileRouter);
export default router;
