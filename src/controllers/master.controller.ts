import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { scopeOf } from "../lib/_scoping";

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
const autoCode = (type: "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER") => {
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

/** LIST GENERIC BY TYPE (merge user + global) */
export const listMasterGeneric = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const raw = (req.query.type as string) || "";
    const type = ["LABOR", "MATERIAL", "EQUIPMENT", "OTHER"].includes(raw)
      ? (raw as any)
      : undefined;
    if (!type) {
      res
        .status(400)
        .json({
          status: "error",
          error:
            "Query parameter 'type' is required (LABOR|MATERIAL|EQUIPMENT|OTHER)",
        });
      return;
    }

    const q = (req.query.q as string) || "";
    const skip = Math.max(0, parseInt(String(req.query.skip ?? 0), 10) || 0);
    const take = Math.min(
      Math.max(1, parseInt(String(req.query.take ?? 20), 10) || 20),
      200
    );
    const orderByField = (req.query.orderBy as string) || "code";
    const orderDir = (req.query.orderDir as string) === "desc" ? "desc" : "asc";

    const where: any = { type };
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { unit: { contains: q, mode: "insensitive" } },
      ];
    }

    const [rowsUser, rowsGlobal] = await Promise.all([
      prisma.masterItem.findMany({ where: { ...where, scope: userScope } }),
      prisma.masterItem.findMany({ where: { ...where, scope: "GLOBAL" } }),
    ]);

    const map = new Map<string, any>();
    for (const g of rowsGlobal) map.set(g.code, g);
    for (const u of rowsUser) map.set(u.code, u);
    let data = Array.from(map.values());

    data.sort((a, b) => {
      const dir = orderDir === "desc" ? -1 : 1;
      if (orderByField === "price") return (a.price - b.price) * dir;
      if (orderByField === "name") return a.name.localeCompare(b.name) * dir;
      return a.code.localeCompare(b.code) * dir;
    });

    const total = data.length;
    data = data.slice(skip, skip + take);

    res
      .status(200)
      .json({
        status: "success",
        data,
        pagination: { skip, take, total },
        meta: { type },
      });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: `Failed to fetch master items`,
        detail: e?.message,
      });
    return;
  }
};

export const createMasterItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const scope = scopeOf(userId);

    const { code, name, unit, price, type, hourlyRate, dailyRate, notes } =
      req.body;

    if (!isStr(name) || !isStr(unit) || !isValidType(type)) {
      res
        .status(400)
        .json({
          status: "error",
          error: "name, unit, and valid type are required",
        });
      return;
    }

    let finalCode = (code ?? "").trim();
    if (type === "LABOR") {
      if (!isStr(finalCode)) {
        res
          .status(400)
          .json({ status: "error", error: "code is required for LABOR" });
        return;
      }
    } else {
      if (!isStr(finalCode)) finalCode = autoCode(type);
    }

    let priceNum = toFloat(price, NaN);
    const hr = hourlyRate !== undefined ? toFloat(hourlyRate, NaN) : NaN;
    const dr = dailyRate !== undefined ? toFloat(dailyRate, NaN) : NaN;
    if (type === "LABOR") {
      if (Number.isFinite(dr)) priceNum = dr;
      else if (Number.isFinite(hr)) priceNum = hr;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      res
        .status(400)
        .json({
          status: "error",
          error:
            "price must be a non-negative number (or provide dailyRate/hourlyRate for LABOR)",
        });
      return;
    }

    const data: any = {
      scope,
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
    return;
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({
          status: "error",
          error: "Duplicate code. 'code' must be unique in your scope.",
        });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to create master item",
        detail: e?.message,
      });
    return;
  }
};

export const getMasterItem = async (
  req: Request,
  res: Response
): Promise<void> => {
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
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch master item",
        detail: e?.message,
      });
    return;
  }
};

export const updateMasterItem = async (
  req: Request,
  res: Response
): Promise<void> => {
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

    if (
      original.type === "LABOR" &&
      req.body.dailyRate !== undefined &&
      req.body.price === undefined
    ) {
      const dr = toFloat(req.body.dailyRate, NaN);
      if (Number.isFinite(dr) && dr >= 0) payload.price = dr;
    }
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
    return;
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({
          status: "error",
          error: "Duplicate code. 'code' must be unique in its scope.",
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
    return;
  }
};

export const deleteMasterItem = async (
  req: Request,
  res: Response
): Promise<void> => {
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
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to delete master item",
        detail: e?.message,
      });
    return;
  }
};

/* ============================
   Recompute helper
   ============================ */
async function recomputeRecipesUsingMasterItem(masterItemId: string) {
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
      const effectiveUnitPrice = comp.priceOverride ?? comp.masterItem.price;
      const subtotal = (comp.coefficient ?? 1) * effectiveUnitPrice;

      compUpdates.push(
        prisma.aHSPComponent.update({
          where: { id: comp.id },
          data: { effectiveUnitPrice, subtotal },
        })
      );

      if (comp.group === "LABOR") A += subtotal;
      if (comp.group === "MATERIAL") B += subtotal;
      if (comp.group === "EQUIPMENT") C += subtotal;
    }

    const D = A + B + C;
    const E = D * (recipe.overheadPercent / 100);
    const F = D + E;

    await prisma.$transaction([
      ...compUpdates,
      prisma.aHSPRecipe.update({
        where: { id: recipe.id },
        data: { subtotalABC: D, overheadAmount: E, finalUnitPrice: F },
      }),
      prisma.hSPItem.update({
        where: { id: recipe.hspItem.id },
        data: { harga: F },
      }),
    ]);
  }
}

