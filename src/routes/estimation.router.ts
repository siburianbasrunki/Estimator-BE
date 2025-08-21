import express from "express";
import {
  createEstimation,
  getEstimations,
  getEstimationById,
  updateEstimation,
  deleteEstimation,
  getEstimationStats,
  downloadEstimationPdf,
  downloadEstimationExcel,
} from "../controllers/estimation.controller";
import { upload } from "../middleware/upload";
import { authenticate } from "../middleware/auth";

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.use(authenticate);

// GET /api/estimations/stats - Get user estimation statistics
router.get("/stats", getEstimationStats);

// GET /api/estimations - Get all estimations for authenticated user
router.get("/", getEstimations);

// POST /api/estimations - Create new estimation (with optional image upload)
router.post("/", upload.single("image"), createEstimation);

// GET /api/estimations/:id - Get single estimation by ID
router.get("/:id", getEstimationById);

// PUT /api/estimations/:id - Update estimation (with optional image upload)
router.put("/:id", upload.single("image"), updateEstimation);

// PATCH /api/estimations/:id - Partial update estimation (with optional image upload)
router.patch("/:id", upload.single("image"), updateEstimation);

// DELETE /api/estimations/:id - Delete estimation
router.delete("/:id", deleteEstimation);

router.get("/:id/download/pdf", downloadEstimationPdf);

router.get("/:id/download/excel", downloadEstimationExcel);
export default router;
