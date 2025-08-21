// src/controllers/ahspRecipe.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";

const toFloat = (v: any, def = 0) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : def;
};
const isGroup = (t: any): t is "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER" =>
  ["LABOR", "MATERIAL", "EQUIPMENT", "OTHER"].includes(String(t));

/** GET detail by kode (sudah kamu punya di hsp.controller: getHsdDetailByKode) */

/** PATCH overhead by kode (create recipe kalau belum ada) */
export const updateAhspOverheadByKode = async (req: Request, res: Response) => {
  try {
    const kode = decodeURIComponent((req.params.kode || "").trim());
    const n = toFloat(req.body.overheadPercent, NaN);
    if (!Number.isFinite(n) || n < 0) {
      res
        .status(400)
        .json({ status: "error", error: "overheadPercent must be >= 0" });
      return;
    }
    const item = await prisma.hSPItem.findUnique({ where: { kode } });
    if (!item) {
      res.status(404).json({ status: "error", error: "HSP item not found" });
      return;
    }

    let recipe = await prisma.aHSPRecipe.findUnique({
      where: { hspItemId: item.id },
    });
    if (!recipe) {
      recipe = await prisma.aHSPRecipe.create({
        data: { hspItemId: item.id, overheadPercent: n },
      });
    } else {
      recipe = await prisma.aHSPRecipe.update({
        where: { id: recipe.id },
        data: { overheadPercent: n },
      });
    }
    res
      .status(200)
      .json({
        status: "success",
        data: { id: recipe.id, overheadPercent: recipe.overheadPercent },
      });
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to update overhead",
        detail: e?.message,
      });
  }
};

/** POST add component by kode (create recipe if missing) */
export const addAhspComponentByKode = async (req: Request, res: Response) => {
  try {
    const kode = decodeURIComponent((req.params.kode || "").trim());
    const { group, masterItemId, coefficient, priceOverride, notes } =
      req.body || {};
    if (!isGroup(group)) {
      res
        .status(400)
        .json({
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
    const item = await prisma.hSPItem.findUnique({ where: { kode } });
    if (!item) {
      res.status(404).json({ status: "error", error: "HSP item not found" });
      return;
    }

    let recipe = await prisma.aHSPRecipe.findUnique({
      where: { hspItemId: item.id },
    });
    if (!recipe)
      recipe = await prisma.aHSPRecipe.create({
        data: { hspItemId: item.id, overheadPercent: 10 },
      });

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
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to add component",
        detail: e?.message,
      });
  }
};

/** PATCH update component (coef/override/notes/order) */
export const updateAhspComponent = async (req: Request, res: Response) => {
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
          res
            .status(400)
            .json({
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

    // recompute derived
    const coef = payload.coefficient ?? comp.coefficient ?? 1;
    const basePrice =
      (payload.priceOverride === undefined
        ? comp.priceOverride
        : payload.priceOverride) ?? comp.masterItem.price;
    payload.effectiveUnitPrice = basePrice;
    payload.subtotal = coef * basePrice;

    const updated = await prisma.aHSPComponent.update({
      where: { id },
      data: payload,
      include: { masterItem: true },
    });
    res.status(200).json({ status: "success", data: updated });
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to update component",
        detail: e?.message,
      });
  }
};

/** DELETE component */
export const deleteAhspComponent = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.aHSPComponent.delete({ where: { id } });
    res.status(200).json({ status: "success", data: { id, deleted: true } });
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to delete component",
        detail: e?.message,
      });
  }
};

/** POST recompute item -> simpan subtotalABC/overhead/final + update HSPItem.harga */
export const recomputeHspItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // HSPItem.id
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

    res
      .status(200)
      .json({
        status: "success",
        data: { subtotalABC: D, overheadAmount: E, finalUnitPrice: F },
      });
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to recompute",
        detail: e?.message,
      });
  }
};
