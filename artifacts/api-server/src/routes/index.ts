import { Router } from "express";
import healthRouter from "./health.js";
import searchRouter from "./search.js";
import streamsRouter from "./streams.js";
import proxyRouter from "./proxy.js";
import titleRouter from "./title.js";

const router = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(streamsRouter);
router.use(proxyRouter);
router.use(titleRouter);

export default router;
