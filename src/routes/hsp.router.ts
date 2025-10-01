
import express from "express";
import { authenticate } from "../middleware/auth";
import { uploadExcelCsv } from "../middleware/upload";
import { importHSP } from "../controllers/hspImport.controller";
import {
  listItems,
  listAllGrouped,
  getHsdDetail,
  getHsdDetailByKode,
  createHspItem,
  updateHspItem,
  deleteHspItem,
  updateHspItemByKode,
  deleteHspItemByKode,
  setHspOverrideActive,
  listAllScopesWithItems,
} from "../controllers/hsp.controller";

import {
  createMasterItem,
  getMasterItem,
  updateMasterItem,
  deleteMasterItem,
  listMasterGeneric,
  getMasterItemByCode,
  updateMasterItemByCode,
  deleteMasterItemByCode,
  setMasterOverrideActive,
} from "../controllers/master.controller";

import {
  addAhspComponentByKode,
  deleteAhspComponent,
  recomputeHspItem,
  updateAhspComponent,
  updateAhspOverheadByKode,
} from "../controllers/ahspRecipe.controller";
import {
  importMasterLabor,
  importMasterMaterials,
} from "../controllers/masterImport.controller";
import {
  createSource,
  deleteSource,
  listSources,
  updateSource,
} from "../controllers/source.controller";
import {
  createUnit,
  deleteUnit,
  listUnits,
  updateUnit,
} from "../controllers/units.controller";
import {
  createHspCategory,
  deleteHspCategory,
  getCategoryWithItems,
  listCategories,
  updateHspCategory,
} from "../controllers/categories.controller";

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

/** Import */
router.post("/import", authenticate, uploadExcelCsv.single("file"), importHSP);
router.post(
  "/master/import/materials",
  authenticate,
  uploadExcelCsv.single("file"),
  importMasterMaterials
);
router.post(
  "/master/import/labor",
  authenticate,
  uploadExcelCsv.single("file"),
  importMasterLabor
);
/** Kategori & Items HSP */
router.get("/categories", authenticate, listCategories);
router.get("/categories/:id", authenticate, getCategoryWithItems);
router.get("/items", authenticate, listItems);
router.get("/with-items", authenticate, listAllGrouped);
router.get("/admin/all-with-items", authenticate, listAllScopesWithItems);

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

router.get("/master/:id", authenticate, getMasterItem);
router.post("/master", authenticate, createMasterItem);
router.patch("/master/:id", authenticate, updateMasterItem);
router.patch("/master/by-code/:code", authenticate, updateMasterItemByCode);
router.delete("/master/by-code/:code", authenticate, deleteMasterItemByCode);
router.delete("/master/:id", authenticate, deleteMasterItem);
router.get("/master/by-code/:code", authenticate, getMasterItemByCode);
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
router.patch(
  "/items/by-kode/:kode/override/active",
  authenticate,
  setHspOverrideActive
);
router.patch(
  "/master/by-code/:code/override/active",
  authenticate,
  setMasterOverrideActive
);
/** Kategori HSP (CRUD) */
router.post("/categories", authenticate, createHspCategory);
router.patch("/categories/:id", authenticate, updateHspCategory);
router.delete("/categories/:id", authenticate, deleteHspCategory);
// source flag
router.get("/sources", authenticate, listSources);
router.post("/sources", authenticate, createSource);
router.patch("/sources/:id", authenticate, updateSource);
router.delete("/sources/:id", authenticate, deleteSource);

// units

router.get("/units", authenticate, listUnits);
router.post("/units", authenticate, createUnit);
router.patch("/units/:id", authenticate, updateUnit);
router.delete("/units/:id", authenticate, deleteUnit);
export default router;
