import type { Request, Response } from "express";
import prisma  from "../lib/prisma";

export async function listSources(req: Request, res: Response) {
  try {
    const all = req.query.all === "1";
    const data = await prisma.sourceTag.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [{ isActive: "desc" }, { label: "asc" }],
      select: { id: true, code: true, label: true, isActive: true },
    });
    res.json({ status: "success", data });
  } catch (e: any) {
    res.status(500).json({ status: "error", error: "Failed to list sources", detail: e?.message });
  }
}

export async function createSource(req: Request, res: Response) {
  try {
    const { code, label } = req.body || {};
    if (!code || !label) {
      res.status(400).json({ status: "error", error: "code and label are required" });
      return;
    }
    const created = await prisma.sourceTag.create({
      data: { code: String(code).trim(), label: String(label).trim() },
      select: { id: true, code: true, label: true, isActive: true },
    });
    res.status(201).json({ status: "success", data: created });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({ status: "error", error: "code already exists" });
      return;
    }
    res.status(500).json({ status: "error", error: "Failed to create source", detail: e?.message });
  }
}

export async function updateSource(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const payload: { code?: string; label?: string; isActive?: boolean } = {};
    if (typeof req.body?.code === "string") payload.code = req.body.code.trim();
    if (typeof req.body?.label === "string") payload.label = req.body.label.trim();
    if (typeof req.body?.isActive === "boolean") payload.isActive = req.body.isActive;

    const updated = await prisma.sourceTag.update({
      where: { id },
      data: payload,
      select: { id: true, code: true, label: true, isActive: true },
    });
    res.json({ status: "success", data: updated });
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Source not found" });
      return;
    }
    if (e?.code === "P2002") {
      res.status(409).json({ status: "error", error: "code already exists" });
      return;
    }
    res.status(500).json({ status: "error", error: "Failed to update source", detail: e?.message });
  }
}

export async function deleteSource(req: Request, res: Response) {
  try {
    const { id } = req.params;
    // hard delete; kalau mau soft, ganti ke update isActive=false
    await prisma.sourceTag.delete({ where: { id } });
    res.json({ status: "success", message: "Source deleted" });
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Source not found" });
      return;
    }
    res.status(500).json({ status: "error", error: "Failed to delete source", detail: e?.message });
  }
}

/** Helper untuk validasi di HSP item */
export async function getActiveSourceCodes(): Promise<Set<string>> {
  const list = await prisma.sourceTag.findMany({
    where: { isActive: true },
    select: { code: true, label: true },
  });
  // izinkan match ke code atau label (case-insensitive)
  const s = new Set<string>();
  for (const it of list) {
    s.add(it.code.toLowerCase());
    s.add(it.label.toLowerCase());
  }
  return s;
}
