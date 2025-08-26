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

router.get("/stats", getEstimationStats);

router.get("/", getEstimations);

router.post("/", upload.single("image"), createEstimation);

router.get("/:id", getEstimationById);

router.put("/:id", upload.single("image"), updateEstimation);

router.patch("/:id", upload.single("image"), updateEstimation);

router.delete("/:id", deleteEstimation);

router.get("/:id/download/pdf", downloadEstimationPdf);

router.get("/:id/download/excel", downloadEstimationExcel);
router.post("/:id/download/excel", upload.single("logo"), downloadEstimationExcel);
export default router;
