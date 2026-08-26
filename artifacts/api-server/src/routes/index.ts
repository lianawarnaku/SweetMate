import { Router, type IRouter } from "express";
import healthRouter from "./health";
import planningRouter from "./planning";
import calendarRouter from "./calendar";
import googleCalendarConnectionRouter from "./googleCalendarConnection";
import emailRouter from "./email";

const router: IRouter = Router();

router.use(healthRouter);
router.use(planningRouter);
router.use(calendarRouter);
router.use(googleCalendarConnectionRouter);
router.use(emailRouter);

export default router;
