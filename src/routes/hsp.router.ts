// src/routes/hsp.routes.ts

import express from "express";
import { authenticate } from "../middleware/auth";
import { uploadExcelCsv } from "../middleware/upload";
import { importHSP } from "../controllers/hspImport.controller";
import {
  listCategories,
  getCategoryWithItems,
  listItems,
  listAllGrouped,
  getHsdDetail,
  getHsdDetailByKode,
  createHspCategory,
  updateHspCategory,
  deleteHspCategory,
  createHspItem,
  updateHspItem,
  deleteHspItem,
  updateHspItemByKode,
  deleteHspItemByKode,
} from "../controllers/hsp.controller";

import {
  createMasterItem,
  getMasterItem,
  updateMasterItem,
  deleteMasterItem,
  listMasterGeneric,
} from "../controllers/master.controller";

import {
  addAhspComponentByKode,
  deleteAhspComponent,
  recomputeHspItem,
  updateAhspComponent,
  updateAhspOverheadByKode,
} from "../controllers/ahspRecipe.controller";

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

/** Import */
router.post("/import", authenticate, uploadExcelCsv.single("file"), importHSP);

/** Kategori & Items HSP */
router.get("/categories", authenticate, listCategories);
router.get("/categories/:id", authenticate, getCategoryWithItems);
router.get("/items", authenticate, listItems);
router.get("/with-items", authenticate, listAllGrouped);

/** Detail HSD (HSP + AHSP breakdown) */
router.get("/items/:id/detail", authenticate, getHsdDetail);
router.get("/ahsp/:kode", authenticate, getHsdDetailByKode);

/** HSP Items */
router.post("/items", authenticate, createHspItem);
router.patch("/items/:id", authenticate, updateHspItem);
router.delete("/items/:id", authenticate, deleteHspItem);
router.patch("/items/by-kode/:kode", authenticate, updateHspItemByKode);
router.delete("/items/by-kode/:kode", authenticate, deleteHspItemByKode);

/** Master list */
router.get("/master", authenticate, listMasterGeneric);

// ⬇️ empat endpoint spesifik: injek type lalu delegasi ke listMasterGeneric
router.get("/master/labor", authenticate, async (req, res) => {
  (req.query as any).type = "LABOR";
  await listMasterGeneric(req, res);
});
router.get("/master/materials", authenticate, async (req, res) => {
  (req.query as any).type = "MATERIAL";
  await listMasterGeneric(req, res);
});
router.get("/master/equipments", authenticate, async (req, res) => {
  (req.query as any).type = "EQUIPMENT";
  await listMasterGeneric(req, res);
});
router.get("/master/others", authenticate, async (req, res) => {
  (req.query as any).type = "OTHER";
  await listMasterGeneric(req, res);
});

router.post("/master", authenticate, createMasterItem);
router.get("/master/:id", authenticate, getMasterItem);
router.patch("/master/:id", authenticate, updateMasterItem);
router.delete("/master/:id", authenticate, deleteMasterItem);

/** AHSP */
router.patch(
  "/items/by-kode/:kode/recipe",
  authenticate,
  updateAhspOverheadByKode
);
router.post(
  "/items/by-kode/:kode/recipe/components",
  authenticate,
  addAhspComponentByKode
);
router.patch("/recipe/components/:id", authenticate, updateAhspComponent);
router.delete("/recipe/components/:id", authenticate, deleteAhspComponent);

router.post("/items/:id/recompute", authenticate, recomputeHspItem);

/** Kategori HSP (CRUD) */
router.post("/categories", authenticate, createHspCategory);
router.patch("/categories/:id", authenticate, updateHspCategory);
router.delete("/categories/:id", authenticate, deleteHspCategory);

export default router;
