// src/routes/dashboard.ts
import { Router } from "express";
import { getEstimationMonthly } from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth";
const router = Router();

router.get("/estimation-monthly", authenticate, getEstimationMonthly);

export default router;
