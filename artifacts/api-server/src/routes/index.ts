import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";
import streamsRouter from "./streams";
import proxyRouter from "./proxy";
import titleRouter from "./title";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(streamsRouter);
router.use(proxyRouter);
router.use(titleRouter);

export default router;
