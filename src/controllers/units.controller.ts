import type { Request, Response } from "express";
import prisma from "../lib/prisma";

/**
 * GET /hsp/units?q=...
 * List all units. Optional search by q (matches code or label, case-insensitive).
 */
export async function listUnits(req: Request, res: Response) {
  try {
    const q = String(req.query.q || "").trim();

    const where = q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { label: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};
    const data = await prisma.units.findMany({
      where,
      orderBy: [{ label: "asc" }],
      select: {
        id: true,
        code: true,
        label: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ status: "success", data });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to list units",
      detail: e?.message,
    });
  }
}

/**
 * POST /hsp/units
 * body: { code, label }
 */
export async function createUnit(req: Request, res: Response) {
  try {
    const { code, label } = req.body || {};
    if (!code || !label) {
      res
        .status(400)
        .json({ status: "error", error: "code and label are required" });
      return;
    }

    const created = await prisma.units.create({
      data: { code: String(code).trim(), label: String(label).trim() },
      select: {
        id: true,
        code: true,
        label: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({ status: "success", data: created });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({ status: "error", error: "code already exists" });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to create unit",
      detail: e?.message,
    });
  }
}

/**
 * PATCH /hsp/units/:id
 * body: { code?, label? }
 */
export async function updateUnit(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const payload: { code?: string; label?: string } = {};

    if (typeof req.body?.code === "string") payload.code = req.body.code.trim();
    if (typeof req.body?.label === "string")
      payload.label = req.body.label.trim();

    const updated = await prisma.units.update({
      where: { id },
      data: payload,
      select: {
        id: true,
        code: true,
        label: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ status: "success", data: updated });
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Unit not found" });
      return;
    }
    if (e?.code === "P2002") {
      res.status(409).json({ status: "error", error: "code already exists" });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to update unit",
      detail: e?.message,
    });
  }
}

/**
 * DELETE /hsp/units/:id
 * Hard delete (kalau mau soft delete, tinggal ubah model & handler).
 */
export async function deleteUnit(req: Request, res: Response) {
  try {
    const { id } = req.params;
    await prisma.units.delete({ where: { id } });
    res.json({ status: "success", message: "Unit deleted" });
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Unit not found" });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to delete unit",
      detail: e?.message,
    });
  }
}
