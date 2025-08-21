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
  listMasterGeneric,
  listMasterLabor,
  listMasterMaterials,
  listMasterEquipments,
  listMasterOthers,
  getHsdDetailByKode,
} from "../controllers/hsp.controller";

import {
  createMasterItem,
  getMasterItem,
  updateMasterItem,
  deleteMasterItem,
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
/** Master list (sudah ada varian generic & spesifik) */
router.get("/master", authenticate, listMasterGeneric);
router.get("/master/labor", authenticate, listMasterLabor);
router.get("/master/materials", authenticate, listMasterMaterials);
router.get("/master/equipments", authenticate, listMasterEquipments);
router.get("/master/others", authenticate, listMasterOthers);

router.post("/master", authenticate, createMasterItem);
router.get("/master/:id", authenticate, getMasterItem);
router.patch("/master/:id", authenticate, updateMasterItem);
router.delete("/master/:id", authenticate, deleteMasterItem);

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
export default router;
