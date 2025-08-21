import { Request, Response } from "express";
import prisma from "../lib/prisma";

/* Helpers */
const toFloat = (v: any, def = 0) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : def;
};
const isStr = (v: any) => typeof v === "string" && v.trim().length > 0;
const norm = (s?: string) => (s ?? "").trim().replace(/\s+/g, " ");
const isValidType = (
  t: any
): t is "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER" =>
  ["LABOR", "MATERIAL", "EQUIPMENT", "OTHER"].includes(String(t));

const rand6 = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const autoCode = (
  type: "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER",
  name?: string
) => {
  const prefix =
    type === "MATERIAL"
      ? "MAT"
      : type === "EQUIPMENT"
        ? "EQP"
        : type === "OTHER"
          ? "OTH"
          : "LAB";
  return `${prefix}-${rand6()}`;
};
/** CREATE
 * POST /hsp/master
 * body: { code, name, unit, price, type, hourlyRate?, dailyRate? }
 */
export const createMasterItem = async (req: Request, res: Response) => {
  try {
    const { code, name, unit, price, type, hourlyRate, dailyRate, notes } =
      req.body;

    if (!isStr(name) || !isStr(unit) || !isValidType(type)) {
      res.status(400).json({
        status: "error",
        error: "name, unit, and valid type are required",
      });
      return;
    }

    // Untuk LABOR: wajib kode. Selain itu: kode boleh kosong → auto generate.
    let finalCode = (code ?? "").trim();
    if (type === "LABOR") {
      if (!isStr(finalCode)) {
        res
          .status(400)
          .json({ status: "error", error: "code is required for LABOR" });
        return;
      }
    } else {
      if (!isStr(finalCode)) finalCode = autoCode(type, name);
    }

    // Tentukan price:
    // LABOR → default ke dailyRate (OH). Fallback ke hourlyRate. Terakhir ke "price" bila keduanya kosong.
    let priceNum = toFloat(price, NaN);
    const hr = hourlyRate !== undefined ? toFloat(hourlyRate, NaN) : NaN;
    const dr = dailyRate !== undefined ? toFloat(dailyRate, NaN) : NaN;
    if (type === "LABOR") {
      if (Number.isFinite(dr)) priceNum = dr;
      else if (Number.isFinite(hr)) priceNum = hr;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      res.status(400).json({
        status: "error",
        error:
          "price must be a non-negative number (or provide dailyRate/hourlyRate for LABOR)",
      });
      return;
    }

    const data: any = {
      code: norm(finalCode),
      name: norm(name),
      unit: norm(unit),
      price: priceNum,
      type,
      notes: isStr(notes) ? norm(notes) : null,
    };

    if (hourlyRate !== undefined)
      data.hourlyRate = toFloat(hourlyRate, null as any);
    if (dailyRate !== undefined)
      data.dailyRate = toFloat(dailyRate, null as any);

    const created = await prisma.masterItem.create({ data });
    res.status(201).json({ status: "success", data: created });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({
        status: "error",
        error: "Duplicate code. 'code' must be unique.",
      });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to create master item",
      detail: e?.message,
    });
  }
};

/** DETAIL
 * GET /hsp/master/:id
 * returns master item + _count.components
 */
export const getMasterItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await prisma.masterItem.findUnique({
      where: { id },
      include: { _count: { select: { components: true } } },
    });
    if (!item) {
      res.status(404).json({ status: "error", error: "Master item not found" });
      return;
    }
    res.status(200).json({ status: "success", data: item });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch master item",
      detail: e?.message,
    });
  }
};

/** UPDATE
 * PATCH /hsp/master/:id?recompute=true|false
 * body: { code?, name?, unit?, price?, type?, hourlyRate?, dailyRate? }
 * Jika query recompute=true, semua recipe (AHSP) yang memakai item ini akan dihitung ulang dan disimpan.
 */
export const updateMasterItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const recompute =
      String(req.query.recompute || "false").toLowerCase() === "true";
    const original = await prisma.masterItem.findUnique({ where: { id } });
    if (!original) {
      res.status(404).json({ status: "error", error: "Master item not found" });
      return;
    }

    const payload: any = {};

    if (req.body.code !== undefined) {
      if (!isStr(req.body.code)) {
        res
          .status(400)
          .json({ status: "error", error: "code must be a non-empty string" });
        return;
      }
      payload.code = norm(req.body.code);
    }
    if (req.body.name !== undefined) {
      if (!isStr(req.body.name)) {
        res
          .status(400)
          .json({ status: "error", error: "name must be a non-empty string" });
        return;
      }
      payload.name = norm(req.body.name);
    }
    if (req.body.unit !== undefined) {
      if (!isStr(req.body.unit)) {
        res
          .status(400)
          .json({ status: "error", error: "unit must be a non-empty string" });
        return;
      }
      payload.unit = norm(req.body.unit);
    }
    if (req.body.price !== undefined) {
      const n = toFloat(req.body.price, NaN);
      if (!Number.isFinite(n) || n < 0) {
        res
          .status(400)
          .json({
            status: "error",
            error: "price must be a non-negative number",
          });
        return;
      }
      payload.price = n;
    }
    if (req.body.type !== undefined) {
      if (!isValidType(req.body.type)) {
        res
          .status(400)
          .json({
            status: "error",
            error: "type must be LABOR|MATERIAL|EQUIPMENT|OTHER",
          });
        return;
      }
      payload.type = req.body.type;
    }
    if (req.body.hourlyRate !== undefined)
      payload.hourlyRate = toFloat(req.body.hourlyRate, null as any);
    if (req.body.dailyRate !== undefined)
      payload.dailyRate = toFloat(req.body.dailyRate, null as any);
    if (req.body.notes !== undefined)
      payload.notes = isStr(req.body.notes) ? norm(req.body.notes) : null;

    // Bila LABOR dan dailyRate dikirim, sinkronkan price ke dailyRate (OH)
    if (
      original.type === "LABOR" &&
      req.body.dailyRate !== undefined &&
      req.body.price === undefined
    ) {
      const dr = toFloat(req.body.dailyRate, NaN);
      if (Number.isFinite(dr) && dr >= 0) payload.price = dr;
    }
    // Atau bila daily kosong tapi hourly dikirim (dan price tidak dikirim), fallback price=hourly
    if (
      original.type === "LABOR" &&
      req.body.dailyRate === undefined &&
      req.body.hourlyRate !== undefined &&
      req.body.price === undefined
    ) {
      const hr = toFloat(req.body.hourlyRate, NaN);
      if (Number.isFinite(hr) && hr >= 0) payload.price = hr;
    }

    const updated = await prisma.masterItem.update({
      where: { id },
      data: payload,
    });
    if (recompute) await recomputeRecipesUsingMasterItem(id);

    res
      .status(200)
      .json({
        status: "success",
        data: updated,
        meta: { recomputed: recompute },
      });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({
          status: "error",
          error: "Duplicate code. 'code' must be unique.",
        });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to update master item",
        detail: e?.message,
      });
  }
};

/** DELETE
 * DELETE /hsp/master/:id
 * Akan diblok jika masih dipakai oleh AHSPComponent.
 * Tambahkan ?force=true jika kamu ingin menghapus beserta komponen-komponennya (opsional – disini kita BLOK, tidak force-delete).
 */
export const deleteMasterItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const item = await prisma.masterItem.findUnique({
      where: { id },
      include: { _count: { select: { components: true } } },
    });
    if (!item) {
      res.status(404).json({ status: "error", error: "Master item not found" });
      return;
    }

    if (item._count.components > 0) {
      res.status(409).json({
        status: "error",
        error: "Cannot delete: item is referenced by AHSP components",
        meta: { references: item._count.components },
      });
      return;
    }

    await prisma.masterItem.delete({ where: { id } });
    res.status(200).json({ status: "success", data: { id, deleted: true } });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to delete master item",
      detail: e?.message,
    });
  }
};

/* ============================
   Recompute helper (optional)
   ============================ */
async function recomputeRecipesUsingMasterItem(masterItemId: string) {
  // Cari semua recipe yang terpengaruh
  const compRefs = await prisma.aHSPComponent.findMany({
    where: { masterItemId },
    select: { ahspId: true },
  });
  const ahspIds = Array.from(new Set(compRefs.map((c) => c.ahspId)));
  if (ahspIds.length === 0) return;

  const recipes = await prisma.aHSPRecipe.findMany({
    where: { id: { in: ahspIds } },
    include: {
      components: {
        include: { masterItem: true },
        orderBy: [{ group: "asc" }, { order: "asc" }],
      },
      hspItem: true,
    },
  });

  for (const recipe of recipes) {
    let A = 0,
      B = 0,
      C = 0;

    const compUpdates: any[] = [];

    for (const comp of recipe.components) {
      // hitung ulang semua komponen supaya konsisten (baik yang override maupun tidak)
      const effectiveUnitPrice = comp.priceOverride ?? comp.masterItem.price;
      const subtotal = (comp.coefficient ?? 1) * effectiveUnitPrice;

      compUpdates.push(
        prisma.aHSPComponent.update({
          where: { id: comp.id },
          data: { effectiveUnitPrice, subtotal },
        })
      );

      switch (comp.group) {
        case "LABOR":
          A += subtotal;
          break;
        case "MATERIAL":
          B += subtotal;
          break;
        case "EQUIPMENT":
          C += subtotal;
          break;
        default:
          break;
      }
    }

    const D = A + B + C;
    const E = D * (recipe.overheadPercent / 100);
    const F = D + E;

    // transaction: update components + recipe + hspItem.harga
    await prisma.$transaction([
      ...compUpdates,
      prisma.aHSPRecipe.update({
        where: { id: recipe.id },
        data: {
          subtotalABC: D,
          overheadAmount: E,
          finalUnitPrice: F,
        },
      }),
      prisma.hSPItem.update({
        where: { id: recipe.hspItem.id },
        data: { harga: F },
      }),
    ]);
  }
}
