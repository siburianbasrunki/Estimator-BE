import express from "express";
import { authenticate } from "../middleware/auth";
import { upload } from "../middleware/upload";
import {
  downloadVolumePdf,
  downloadJobItemPdf,
  downloadKategoriPdf,
  downloadAHSPPdf,
  downloadMasterItemPdf,
} from "../controllers/pdfSingles.controller";

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.use(authenticate);

router.get("/:id/download/pdf/volume", downloadVolumePdf);
router.post(
  "/:id/download/pdf/volume",
  upload.single("logo"),
  downloadVolumePdf
);

router.get("/:id/download/pdf/job-item", downloadJobItemPdf);
router.post(
  "/:id/download/pdf/job-item",
  upload.single("logo"),
  downloadJobItemPdf
);

router.get("/:id/download/pdf/kategori", downloadKategoriPdf);
router.post(
  "/:id/download/pdf/kategori",
  upload.single("logo"),
  downloadKategoriPdf
);

router.get("/:id/download/pdf/ahsp", downloadAHSPPdf);
router.post("/:id/download/pdf/ahsp", upload.single("logo"), downloadAHSPPdf);

router.get("/:id/download/pdf/master-item", downloadMasterItemPdf);
router.post(
  "/:id/download/pdf/master-item",
  upload.single("logo"),
  downloadMasterItemPdf
);

export default router;
