import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { scopeOf } from "../lib/_scoping";

const toFloat = (v: any, def = 0) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : def;
};
const isGroup = (t: any): t is "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER" =>
  ["LABOR", "MATERIAL", "EQUIPMENT", "OTHER"].includes(String(t));

/** PATCH overhead by kode (copy-on-write) */
export const updateAhspOverheadByKode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      res.status(401).json({ status: "error", error: "Unauthorized" });
      return;
    }
    const userScope = scopeOf(userId);

    const kode = decodeURIComponent((req.params.kode || "").trim());
    const n = toFloat(req.body.overheadPercent, NaN);
    if (!Number.isFinite(n) || n < 0) {
      res
        .status(400)
        .json({ status: "error", error: "overheadPercent must be >= 0" });
      return;
    }

    let userItem = await prisma.hSPItem
      .findUnique({
        where: { scope_kode_unique: { scope: userScope, kode } },
        include: { ahsp: { include: { components: true } } },
      })
      .catch(() => null);

    if (!userItem) {
      const base = await prisma.hSPItem.findUnique({
        where: { scope_kode_unique: { scope: "GLOBAL", kode } },
        include: { ahsp: { include: { components: true } } },
      });
      if (!base) {
        res.status(404).json({ status: "error", error: "HSP item not found" });
        return;
      }

      userItem = await prisma.hSPItem.create({
        data: {
          scope: userScope,
          kode: base.kode,
          deskripsi: base.deskripsi,
          satuan: base.satuan,
          harga: base.harga,
          hspCategoryId: base.hspCategoryId,
        },
      });

      if (base.ahsp) {
        const newRecipe = await prisma.aHSPRecipe.create({
          data: {
            scope: userScope,
            hspItemId: userItem.id,
            overheadPercent: base.ahsp.overheadPercent,
            subtotalABC: base.ahsp.subtotalABC,
            overheadAmount: base.ahsp.overheadAmount,
            finalUnitPrice: base.ahsp.finalUnitPrice,
            notes: base.ahsp.notes,
          },
        });
        for (const c of base.ahsp.components) {
          await prisma.aHSPComponent.create({
            data: {
              scope: userScope,
              ahspId: newRecipe.id,
              group: c.group,
              masterItemId: c.masterItemId,
              nameSnapshot: c.nameSnapshot,
              unitSnapshot: c.unitSnapshot,
              unitPriceSnapshot: c.unitPriceSnapshot,
              coefficient: c.coefficient,
              priceOverride: c.priceOverride,
              effectiveUnitPrice: c.effectiveUnitPrice,
              subtotal: c.subtotal,
              order: c.order,
              notes: c.notes,
            },
          });
        }
      }
    }

    let recipe = await prisma.aHSPRecipe.findUnique({
      where: { hspItemId: userItem.id },
    });
    recipe = recipe
      ? await prisma.aHSPRecipe.update({
          where: { id: recipe.id },
          data: { overheadPercent: n },
        })
      : await prisma.aHSPRecipe.create({
          data: {
            scope: userScope,
            hspItemId: userItem.id,
            overheadPercent: n,
          },
        });

    res.status(200).json({
      status: "success",
      data: { id: recipe.id, overheadPercent: recipe.overheadPercent },
    });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to update overhead",
      detail: e?.message,
    });
    return;
  }
};

/** POST add component by kode (copy-on-write jika perlu) */
export const addAhspComponentByKode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      res.status(401).json({ status: "error", error: "Unauthorized" });
      return;
    }
    const userScope = scopeOf(userId);

    const kode = decodeURIComponent((req.params.kode || "").trim());
    const { group, masterItemId, coefficient, priceOverride, notes } =
      req.body || {};
    if (!isGroup(group)) {
      res.status(400).json({
        status: "error",
        error: "group must be LABOR|MATERIAL|EQUIPMENT|OTHER",
      });
      return;
    }
    if (!masterItemId) {
      res
        .status(400)
        .json({ status: "error", error: "masterItemId is required" });
      return;
    }

    let userItem = await prisma.hSPItem
      .findUnique({
        where: { scope_kode_unique: { scope: userScope, kode } },
        include: { ahsp: { include: { components: true } } },
      })
      .catch(() => null);

    if (!userItem) {
      const base = await prisma.hSPItem.findUnique({
        where: { scope_kode_unique: { scope: "GLOBAL", kode } },
        include: { ahsp: { include: { components: true } } },
      });
      if (!base) {
        res.status(404).json({ status: "error", error: "HSP item not found" });
        return;
      }

      userItem = await prisma.hSPItem.create({
        data: {
          scope: userScope,
          kode: base.kode,
          deskripsi: base.deskripsi,
          satuan: base.satuan,
          harga: base.harga,
          hspCategoryId: base.hspCategoryId,
        },
      });

      if (base.ahsp) {
        const newRecipe = await prisma.aHSPRecipe.create({
          data: {
            scope: userScope,
            hspItemId: userItem.id,
            overheadPercent: base.ahsp.overheadPercent,
            subtotalABC: base.ahsp.subtotalABC,
            overheadAmount: base.ahsp.overheadAmount,
            finalUnitPrice: base.ahsp.finalUnitPrice,
            notes: base.ahsp.notes,
          },
        });
        for (const c of base.ahsp.components) {
          await prisma.aHSPComponent.create({
            data: {
              scope: userScope,
              ahspId: newRecipe.id,
              group: c.group,
              masterItemId: c.masterItemId,
              nameSnapshot: c.nameSnapshot,
              unitSnapshot: c.unitSnapshot,
              unitPriceSnapshot: c.unitPriceSnapshot,
              coefficient: c.coefficient,
              priceOverride: c.priceOverride,
              effectiveUnitPrice: c.effectiveUnitPrice,
              subtotal: c.subtotal,
              order: c.order,
              notes: c.notes,
            },
          });
        }
      }
    }

    let recipe = await prisma.aHSPRecipe.findUnique({
      where: { hspItemId: userItem.id },
    });
    if (!recipe) {
      recipe = await prisma.aHSPRecipe.create({
        data: { scope: userScope, hspItemId: userItem.id, overheadPercent: 10 },
      });
    }

    const master = await prisma.masterItem.findUnique({
      where: { id: masterItemId },
    });
    if (!master) {
      res.status(404).json({ status: "error", error: "Master item not found" });
      return;
    }

    const last = await prisma.aHSPComponent.findFirst({
      where: { ahspId: recipe.id, group },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const coef = coefficient !== undefined ? toFloat(coefficient, 1) : 1;
    const po =
      priceOverride === null
        ? null
        : priceOverride !== undefined
          ? toFloat(priceOverride, NaN)
          : undefined;
    if (po !== undefined && po !== null && (!Number.isFinite(po) || po < 0)) {
      res
        .status(400)
        .json({ status: "error", error: "priceOverride must be >= 0 or null" });
      return;
    }
    const effectiveUnitPrice = po ?? master.price;
    const subtotal = coef * effectiveUnitPrice;

    const created = await prisma.aHSPComponent.create({
      data: {
        scope: userScope,
        ahspId: recipe.id,
        group,
        masterItemId: master.id,
        nameSnapshot: master.name,
        unitSnapshot: master.unit,
        unitPriceSnapshot: master.price,
        coefficient: coef,
        priceOverride: po ?? null,
        effectiveUnitPrice,
        subtotal,
        order: (last?.order ?? 0) + 1,
        notes: notes ?? null,
      },
      include: { masterItem: true },
    });

    res.status(201).json({ status: "success", data: created });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to add component",
      detail: e?.message,
    });
    return;
  }
};

export const updateAhspComponent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const comp = await prisma.aHSPComponent.findUnique({
      where: { id },
      include: { masterItem: true },
    });

    if (!comp) {
      res.status(404).json({ status: "error", error: "Component not found" });
      return;
    }

    const payload: any = {};
    if (req.body.coefficient !== undefined) {
      const c = toFloat(req.body.coefficient, NaN);
      if (!Number.isFinite(c) || c < 0) {
        res
          .status(400)
          .json({ status: "error", error: "coefficient must be >= 0" });
        return;
      }
      payload.coefficient = c;
    }
    if (req.body.priceOverride !== undefined) {
      if (req.body.priceOverride === null) payload.priceOverride = null;
      else {
        const p = toFloat(req.body.priceOverride, NaN);
        if (!Number.isFinite(p) || p < 0) {
          res.status(400).json({
            status: "error",
            error: "priceOverride must be >= 0 or null",
          });
          return;
        }
        payload.priceOverride = p;
      }
    }
    if (req.body.notes !== undefined)
      payload.notes = String(req.body.notes || "");
    if (req.body.order !== undefined)
      payload.order = parseInt(String(req.body.order ?? 0), 10) || 0;

    const coef = payload.coefficient ?? comp.coefficient ?? 1;
    const base =
      (payload.priceOverride === undefined
        ? comp.priceOverride
        : payload.priceOverride) ?? comp.masterItem.price;
    payload.effectiveUnitPrice = base;
    payload.subtotal = coef * base;

    const updated = await prisma.aHSPComponent.update({
      where: { id },
      data: payload,
      include: { masterItem: true },
    });

    res.status(200).json({ status: "success", data: updated });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to update component",
      detail: e?.message,
    });
    return;
  }
};

export const deleteAhspComponent = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.aHSPComponent.delete({ where: { id } });
    res.status(200).json({ status: "success", data: { id, deleted: true } });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to delete component",
      detail: e?.message,
    });
    return;
  }
};

export const recomputeHspItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const recipe = await prisma.aHSPRecipe.findUnique({
      where: { hspItemId: id },
      include: { components: { include: { masterItem: true } }, hspItem: true },
    });
    if (!recipe) {
      res
        .status(404)
        .json({ status: "error", error: "Recipe not found for item" });
      return;
    }

    let A = 0,
      B = 0,
      C = 0;
    const updates: any[] = [];
    for (const comp of recipe.components) {
      const base = comp.priceOverride ?? comp.masterItem.price;
      const subtotal = (comp.coefficient ?? 1) * base;
      updates.push(
        prisma.aHSPComponent.update({
          where: { id: comp.id },
          data: { effectiveUnitPrice: base, subtotal },
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
      ...updates,
      prisma.aHSPRecipe.update({
        where: { id: recipe.id },
        data: { subtotalABC: D, overheadAmount: E, finalUnitPrice: F },
      }),
      prisma.hSPItem.update({
        where: { id: recipe.hspItem.id },
        data: { harga: F },
      }),
    ]);

    res.status(200).json({
      status: "success",
      data: { subtotalABC: D, overheadAmount: E, finalUnitPrice: F },
    });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to recompute",
      detail: e?.message,
    });
    return;
  }
};
