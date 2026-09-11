import { Router, type IRouter } from "express";
import healthRouter from "./health";
import quizRouter from "./quiz";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(quizRouter);
router.use(adminRouter);

export default router;
