import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { scopeOf, mergeUserOverGlobal } from "../lib/_scoping";

/* Helpers */
const toInt = (v: any, def = 0) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

type GroupKey = "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER";
const GROUP_LABEL: Record<GroupKey, "A" | "B" | "C" | "X"> = {
  LABOR: "A",
  MATERIAL: "B",
  EQUIPMENT: "C",
  OTHER: "X",
};

/** =========================
 *  CATEGORIES (scoped read)
 *  ========================= */
export const listCategories = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 20), 1, 200);

    const whereBase: any = {};
    if (q) whereBase.name = { contains: q, mode: "insensitive" as const };

    const [rowsUser, rowsGlobal] = await Promise.all([
      prisma.hSPCategory.findMany({
        where: { ...whereBase, scope: userScope },
        orderBy: { name: "asc" },
        include: { _count: { select: { items: true } } },
      }),
      prisma.hSPCategory.findMany({
        where: { ...whereBase, scope: "GLOBAL" },
        orderBy: { name: "asc" },
        include: { _count: { select: { items: true } } },
      }),
    ]);

    const merged = mergeUserOverGlobal(rowsUser, rowsGlobal, (r) => r.name);
    const total = merged.length;
    const data = merged.slice(skip, skip + take);

    res
      .status(200)
      .json({ status: "success", data, pagination: { skip, take, total } });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch categories",
        detail: e?.message,
      });
    return;
  }
};

export const getCategoryWithItems = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const { id } = req.params;
    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 50), 1, 500);
    const orderByField = (req.query.orderBy as string) || "kode";
    const orderDir = (req.query.orderDir as string) === "desc" ? "desc" : "asc";

    const cat = await prisma.hSPCategory.findFirst({
      where: { id },
      select: { id: true, name: true, scope: true },
    });
    if (!cat) {
      res.status(404).json({ status: "error", error: "Category not found" });
      return;
    }

    const itemWhere: any = { isDeleted: false, hspCategoryId: cat.id };
    if (q) {
      itemWhere.OR = [
        { kode: { contains: q, mode: "insensitive" as const } },
        { deskripsi: { contains: q, mode: "insensitive" as const } },
      ];
    }

    const [itemsUser, itemsGlobal] = await Promise.all([
      prisma.hSPItem.findMany({
        where: { ...itemWhere, scope: userScope },
        select: {
          id: true,
          kode: true,
          deskripsi: true,
          satuan: true,
          harga: true,
          hspCategoryId: true,
        },
      }),
      prisma.hSPItem.findMany({
        where: { ...itemWhere, scope: "GLOBAL" },
        select: {
          id: true,
          kode: true,
          deskripsi: true,
          satuan: true,
          harga: true,
          hspCategoryId: true,
        },
      }),
    ]);

    let items = mergeUserOverGlobal(itemsUser, itemsGlobal, (r) => r.kode);

    items.sort((a, b) => {
      const dir = orderDir === "desc" ? -1 : 1;
      if (orderByField === "harga") return (a.harga - b.harga) * dir;
      return a.kode.localeCompare(b.kode) * dir;
    });

    const totalItems = items.length;
    items = items.slice(skip, skip + take);

    res
      .status(200)
      .json({
        status: "success",
        data: { id: cat.id, name: cat.name, items },
        pagination: { skip, take, total: totalItems },
      });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch category",
        detail: e?.message,
      });
    return;
  }
};

/** =========================
 *  ITEMS LIST + GROUPED
 *  ========================= */
export const listItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const categoryId = (req.query.categoryId as string) || undefined;
    const kodeExact = (req.query.kode as string) || undefined;
    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 50), 1, 1000);
    const orderByField = (req.query.orderBy as string) || "kode";
    const orderDir = (req.query.orderDir as string) === "desc" ? "desc" : "asc";

    const whereBase: any = { isDeleted: false };
    if (categoryId) whereBase.hspCategoryId = categoryId;
    if (kodeExact) whereBase.kode = kodeExact;
    if (q) {
      whereBase.OR = [
        { kode: { contains: q, mode: "insensitive" } },
        { deskripsi: { contains: q, mode: "insensitive" } },
      ];
    }

    const [rowsUser, rowsGlobal] = await Promise.all([
      prisma.hSPItem.findMany({
        where: { ...whereBase, scope: userScope },
        select: {
          id: true,
          kode: true,
          deskripsi: true,
          satuan: true,
          harga: true,
          hspCategoryId: true,
          category: { select: { id: true, name: true } },
        },
      }),
      prisma.hSPItem.findMany({
        where: { ...whereBase, scope: "GLOBAL" },
        select: {
          id: true,
          kode: true,
          deskripsi: true,
          satuan: true,
          harga: true,
          hspCategoryId: true,
          category: { select: { id: true, name: true } },
        },
      }),
    ]);

    let data = mergeUserOverGlobal(rowsUser, rowsGlobal, (r) => r.kode);

    data.sort((a, b) => {
      const dir = orderDir === "desc" ? -1 : 1;
      if (orderByField === "harga") return (a.harga - b.harga) * dir;
      return a.kode.localeCompare(b.kode) * dir;
    });

    const total = data.length;
    data = data.slice(skip, skip + take);

    res
      .status(200)
      .json({ status: "success", data, pagination: { skip, take, total } });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch items",
        detail: e?.message,
      });
    return;
  }
};

export const listAllGrouped = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const q = (req.query.q as string) || "";
    const limitParam = toInt(req.query.limitPerCategory, 1000);
    const takePerCat = limitParam > 0 ? limitParam : undefined;
    const includeEmpty =
      String(req.query.includeEmpty || "false").toLowerCase() === "true";
    const itemOrderBy = (req.query.itemOrderBy as string) || "kode";
    const itemOrderDir =
      (req.query.itemOrderDir as string) === "desc" ? "desc" : "asc";

    const catWhere: any = {};
    if (q) catWhere.name = { contains: q, mode: "insensitive" as const };

    const [catsUser, catsGlobal] = await Promise.all([
      prisma.hSPCategory.findMany({
        where: { ...catWhere, scope: userScope },
        orderBy: { name: "asc" },
      }),
      prisma.hSPCategory.findMany({
        where: { ...catWhere, scope: "GLOBAL" },
        orderBy: { name: "asc" },
      }),
    ]);

    const categories = mergeUserOverGlobal(catsUser, catsGlobal, (c) => c.name);

    const result: Record<
      string,
      Array<{ kode: string; deskripsi: string; satuan: string; harga: number }>
    > = {};
    let totalItems = 0;

    for (const cat of categories) {
      const whereItems: any = { isDeleted: false, hspCategoryId: cat.id };
      if (q) {
        whereItems.OR = [
          { kode: { contains: q, mode: "insensitive" as const } },
          { deskripsi: { contains: q, mode: "insensitive" as const } },
          { satuan: { contains: q, mode: "insensitive" as const } },
        ];
      }

      const [iu, ig] = await Promise.all([
        prisma.hSPItem.findMany({
          where: { ...whereItems, scope: userScope },
          select: { kode: true, deskripsi: true, satuan: true, harga: true },
        }),
        prisma.hSPItem.findMany({
          where: { ...whereItems, scope: "GLOBAL" },
          select: { kode: true, deskripsi: true, satuan: true, harga: true },
        }),
      ]);

      let merged = mergeUserOverGlobal(iu, ig, (r) => r.kode);

      merged.sort((a, b) => {
        const dir = itemOrderDir === "desc" ? -1 : 1;
        if (itemOrderBy === "harga") return (a.harga - b.harga) * dir;
        return a.kode.localeCompare(b.kode) * dir;
      });

      if (typeof takePerCat === "number") merged = merged.slice(0, takePerCat);

      if (!includeEmpty && merged.length === 0) continue;
      result[cat.name] = merged;
      totalItems += merged.length;
    }

    res.status(200).json({
      status: "success",
      data: result,
      meta: {
        categories: Object.keys(result).length,
        items: totalItems,
        params: {
          q,
          limitPerCategory: takePerCat ?? "ALL",
          includeEmpty,
          itemOrderBy,
          itemOrderDir,
        },
      },
    });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch categories with items",
        detail: e?.message,
      });
    return;
  }
};

/** =========================
 *  DETAIL HSD / AHSP
 *  ========================= */
export const getHsdDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const { id } = req.params;
    const useSnapshot =
      String(req.query.useSnapshot || "false").toLowerCase() === "true";
    const includeMaster =
      String(req.query.includeMaster || "true").toLowerCase() !== "false";

    const base = await prisma.hSPItem.findFirst({
      where: { id, isDeleted: false },
      include: {
        category: { select: { id: true, name: true } },
        ahsp: {
          include: {
            components: {
              include: includeMaster
                ? {
                    masterItem: {
                      select: {
                        id: true,
                        code: true,
                        name: true,
                        unit: true,
                        price: true,
                        type: true,
                      },
                    },
                  }
                : undefined,
              orderBy: [{ group: "asc" }, { order: "asc" }],
            },
          },
        },
      },
    });
    if (!base) {
      res.status(404).json({ status: "error", error: "HSP item not found" });
      return;
    }

    let item = base;
    if (base.scope === "GLOBAL") {
      const override = await prisma.hSPItem
        .findUnique({
          where: { scope_kode_unique: { scope: userScope, kode: base.kode } },
          include: {
            category: { select: { id: true, name: true } },
            ahsp: {
              include: {
                components: {
                  include: includeMaster
                    ? {
                        masterItem: {
                          select: {
                            id: true,
                            code: true,
                            name: true,
                            unit: true,
                            price: true,
                            type: true,
                          },
                        },
                      }
                    : undefined,
                  orderBy: [{ group: "asc" }, { order: "asc" }],
                },
              },
            },
          },
        })
        .catch(() => null);
      if (override && !override.isDeleted) item = override;
    }

    const recipe = item.ahsp;
    const groups: Record<GroupKey, any> = {
      LABOR: {
        key: "LABOR",
        label: GROUP_LABEL.LABOR,
        subtotal: 0,
        items: [] as any[],
      },
      MATERIAL: {
        key: "MATERIAL",
        label: GROUP_LABEL.MATERIAL,
        subtotal: 0,
        items: [] as any[],
      },
      EQUIPMENT: {
        key: "EQUIPMENT",
        label: GROUP_LABEL.EQUIPMENT,
        subtotal: 0,
        items: [] as any[],
      },
      OTHER: {
        key: "OTHER",
        label: GROUP_LABEL.OTHER,
        subtotal: 0,
        items: [] as any[],
      },
    };

    if (recipe) {
      for (const comp of recipe.components) {
        const g = comp.group as GroupKey;
        const basePrice = useSnapshot
          ? (comp.priceOverride ??
            comp.unitPriceSnapshot ??
            comp.masterItem?.price ??
            0)
          : (comp.priceOverride ??
            comp.masterItem?.price ??
            comp.unitPriceSnapshot ??
            0);

        const effectiveUnitPrice = basePrice;
        const subtotal = (comp.coefficient ?? 1) * effectiveUnitPrice;

        groups[g].subtotal += subtotal;
        groups[g].items.push({
          id: comp.id,
          order: comp.order,
          group: comp.group,
          masterItemId: comp.masterItemId,
          masterItem: includeMaster ? comp.masterItem : undefined,
          nameSnapshot: comp.nameSnapshot,
          unitSnapshot: comp.unitSnapshot,
          unitPriceSnapshot: comp.unitPriceSnapshot,
          coefficient: comp.coefficient,
          priceOverride: comp.priceOverride,
          notes: comp.notes,
          effectiveUnitPrice,
          subtotal,
        });
      }
    }

    const A = groups.LABOR.subtotal;
    const B = groups.MATERIAL.subtotal;
    const C = groups.EQUIPMENT.subtotal;
    const D = A + B + C;
    const overheadPercent = recipe?.overheadPercent ?? 10;
    const E = D * (overheadPercent / 100);
    const F = D + E;

    const payload = {
      id: item.id,
      scope: item.scope,
      kode: item.kode,
      deskripsi: item.deskripsi,
      satuan: item.satuan,
      category: item.category,
      harga: item.harga,
      recipe: recipe
        ? {
            id: recipe.id,
            overheadPercent,
            stored: {
              subtotalABC: recipe.subtotalABC,
              overheadAmount: recipe.overheadAmount,
              finalUnitPrice: recipe.finalUnitPrice,
            },
            computed: { A, B, C, D, E, F },
            groups,
            notes: recipe.notes,
            updatedAt: recipe.updatedAt,
          }
        : null,
    };

    res.status(200).json({ status: "success", data: payload });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch HSD detail",
        detail: e?.message,
      });
    return;
  }
};

export const getHsdDetailByKode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const rawKode = decodeURIComponent((req.params.kode || "").trim());
    if (!rawKode) {
      res
        .status(400)
        .json({ status: "error", error: "Missing parameter 'kode'" });
      return;
    }

    const useSnapshot =
      String(req.query.useSnapshot || "false").toLowerCase() === "true";
    const includeMaster =
      String(req.query.includeMaster || "true").toLowerCase() !== "false";

    let item = await prisma.hSPItem
      .findUnique({
        where: { scope_kode_unique: { scope: userScope, kode: rawKode } },
        include: {
          category: { select: { id: true, name: true } },
          ahsp: {
            include: {
              components: {
                include: includeMaster
                  ? {
                      masterItem: {
                        select: {
                          id: true,
                          code: true,
                          name: true,
                          unit: true,
                          price: true,
                          type: true,
                        },
                      },
                    }
                  : undefined,
                orderBy: [{ group: "asc" }, { order: "asc" }],
              },
            },
          },
        },
      })
      .catch(() => null);

    if (!item || item.isDeleted) {
      item = await prisma.hSPItem.findUnique({
        where: { scope_kode_unique: { scope: "GLOBAL", kode: rawKode } },
        include: {
          category: { select: { id: true, name: true } },
          ahsp: {
            include: {
              components: {
                include: includeMaster
                  ? {
                      masterItem: {
                        select: {
                          id: true,
                          code: true,
                          name: true,
                          unit: true,
                          price: true,
                          type: true,
                        },
                      },
                    }
                  : undefined,
                orderBy: [{ group: "asc" }, { order: "asc" }],
              },
            },
          },
        },
      });
    }

    if (!item || item.isDeleted) {
      res
        .status(404)
        .json({ status: "error", error: "HSP item not found by kode" });
      return;
    }

    const groups: Record<GroupKey, any> = {
      LABOR: {
        key: "LABOR",
        label: GROUP_LABEL.LABOR,
        subtotal: 0,
        items: [] as any[],
      },
      MATERIAL: {
        key: "MATERIAL",
        label: GROUP_LABEL.MATERIAL,
        subtotal: 0,
        items: [] as any[],
      },
      EQUIPMENT: {
        key: "EQUIPMENT",
        label: GROUP_LABEL.EQUIPMENT,
        subtotal: 0,
        items: [] as any[],
      },
      OTHER: {
        key: "OTHER",
        label: GROUP_LABEL.OTHER,
        subtotal: 0,
        items: [] as any[],
      },
    };

    const recipe = item.ahsp;
    if (recipe) {
      for (const comp of recipe.components) {
        const g = comp.group as GroupKey;
        const basePrice = useSnapshot
          ? (comp.priceOverride ??
            comp.unitPriceSnapshot ??
            comp.masterItem?.price ??
            0)
          : (comp.priceOverride ??
            comp.masterItem?.price ??
            comp.unitPriceSnapshot ??
            0);

        const effectiveUnitPrice = basePrice;
        const subtotal = (comp.coefficient ?? 1) * effectiveUnitPrice;

        groups[g].subtotal += subtotal;
        groups[g].items.push({
          id: comp.id,
          order: comp.order,
          group: comp.group,
          masterItemId: comp.masterItemId,
          masterItem: includeMaster ? comp.masterItem : undefined,
          nameSnapshot: comp.nameSnapshot,
          unitSnapshot: comp.unitSnapshot,
          unitPriceSnapshot: comp.unitPriceSnapshot,
          coefficient: comp.coefficient,
          priceOverride: comp.priceOverride,
          notes: comp.notes,
          effectiveUnitPrice,
          subtotal,
        });
      }
    }

    const A = groups.LABOR.subtotal;
    const B = groups.MATERIAL.subtotal;
    const C = groups.EQUIPMENT.subtotal;
    const D = A + B + C;
    const overheadPercent = recipe?.overheadPercent ?? 10;
    const E = D * (overheadPercent / 100);
    const F = D + E;

    const payload = {
      id: item.id,
      scope: item.scope,
      kode: item.kode,
      deskripsi: item.deskripsi,
      satuan: item.satuan,
      category: item.category,
      harga: item.harga,
      recipe: recipe
        ? {
            id: recipe.id,
            overheadPercent,
            stored: {
              subtotalABC: recipe.subtotalABC,
              overheadAmount: recipe.overheadAmount,
              finalUnitPrice: recipe.finalUnitPrice,
            },
            computed: { A, B, C, D, E, F },
            groups,
            notes: recipe.notes,
            updatedAt: recipe.updatedAt,
          }
        : null,
    };

    res.status(200).json({ status: "success", data: payload });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to fetch HSD detail by kode",
        detail: e?.message,
      });
    return;
  }
};

/** =========================
 *  CRUD: CATEGORIES (scoped)
 *  ========================= */
export const createHspCategory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const scope = scopeOf(userId);

    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ status: "error", error: "Name is required" });
      return;
    }

    const cat = await prisma.hSPCategory.create({ data: { scope, name } });
    res.status(201).json({ status: "success", data: cat });
    return;
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({
          status: "error",
          error: "Category name already exists in your scope",
        });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to create category",
        detail: e?.message,
      });
    return;
  }
};

export const updateHspCategory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ status: "error", error: "Name is required" });
      return;
    }

    const updated = await prisma.hSPCategory.update({
      where: { id },
      data: { name },
    });
    res.status(200).json({ status: "success", data: updated });
    return;
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Category not found" });
      return;
    }
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({ status: "error", error: "Category name already exists" });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to update category",
        detail: e?.message,
      });
    return;
  }
};

export const deleteHspCategory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.hSPCategory.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Category deleted" });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to delete category",
        detail: e?.message,
      });
    return;
  }
};

/** =========================
 *  CRUD: HSP ITEMS (scoped)
 *  ========================= */
export const createHspItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const scope = scopeOf(userId);

    const { hspCategoryId, kode, deskripsi, satuan } = req.body || {};
    if (!hspCategoryId || !kode || !deskripsi) {
      res
        .status(400)
        .json({
          status: "error",
          error: "hspCategoryId, kode, deskripsi are required",
        });
      return;
    }

    const created = await prisma.hSPItem.create({
      data: {
        scope,
        hspCategoryId,
        kode: String(kode).trim(),
        deskripsi: String(deskripsi).trim(),
        satuan: String(satuan || "").trim(),
        harga: 0,
      },
      select: {
        id: true,
        scope: true,
        kode: true,
        deskripsi: true,
        satuan: true,
        harga: true,
        hspCategoryId: true,
      },
    });

    res.status(201).json({ status: "success", data: created });
    return;
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({ status: "error", error: "Kode already exists in your scope" });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to create item",
        detail: e?.message,
      });
    return;
  }
};

// Admin-like direct update by id
export const updateHspItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const payload: {
      hspCategoryId?: string;
      kode?: string;
      deskripsi?: string;
      satuan?: string;
    } = {};
    if (typeof req.body?.hspCategoryId === "string")
      payload.hspCategoryId = req.body.hspCategoryId;
    if (typeof req.body?.kode === "string") payload.kode = req.body.kode.trim();
    if (typeof req.body?.deskripsi === "string")
      payload.deskripsi = req.body.deskripsi.trim();
    if (typeof req.body?.satuan === "string")
      payload.satuan = req.body.satuan.trim();

    const updated = await prisma.hSPItem.update({
      where: { id },
      data: payload,
      select: {
        id: true,
        scope: true,
        kode: true,
        deskripsi: true,
        satuan: true,
        harga: true,
        hspCategoryId: true,
      },
    });

    res.status(200).json({ status: "success", data: updated });
    return;
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({
          status: "error",
          error: "Kode already exists in target scope",
        });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to update item",
        detail: e?.message,
      });
    return;
  }
};

export const deleteHspItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.hSPItem.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Item deleted" });
    return;
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to delete item",
        detail: e?.message,
      });
    return;
  }
};

/**
 * User-facing: PATCH /hsp/items/by-kode/:kode (copy-on-write)
 */
export const updateHspItemByKode = async (
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
    const kode = decodeURIComponent(String(req.params.kode || "").trim());
    if (!kode) {
      res.status(400).json({ status: "error", error: "Missing kode" });
      return;
    }

    const payload: {
      hspCategoryId?: string;
      kode?: string;
      deskripsi?: string;
      satuan?: string;
    } = {};
    if (typeof req.body?.hspCategoryId === "string")
      payload.hspCategoryId = req.body.hspCategoryId;
    if (typeof req.body?.kode === "string") payload.kode = req.body.kode.trim();
    if (typeof req.body?.deskripsi === "string")
      payload.deskripsi = req.body.deskripsi.trim();
    if (typeof req.body?.satuan === "string")
      payload.satuan = req.body.satuan.trim();

    let userItem = await prisma.hSPItem
      .findUnique({
        where: { scope_kode_unique: { scope: userScope, kode } },
      })
      .catch(() => null);

    if (!userItem) {
      const base = await prisma.hSPItem.findUnique({
        where: { scope_kode_unique: { scope: "GLOBAL", kode } },
      });
      if (!base) {
        res.status(404).json({ status: "error", error: "Item not found" });
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
    }

    const updated = await prisma.hSPItem.update({
      where: { id: userItem.id },
      data: { ...payload, isDeleted: false },
      select: {
        id: true,
        scope: true,
        kode: true,
        deskripsi: true,
        satuan: true,
        harga: true,
        hspCategoryId: true,
      },
    });

    res.status(200).json({ status: "success", data: updated });
    return;
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({ status: "error", error: "Kode already exists in your scope" });
      return;
    }
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to update item",
        detail: e?.message,
      });
    return;
  }
};

/**
 * User-facing: DELETE /hsp/items/by-kode/:kode (tombstone)
 */
export const deleteHspItemByKode = async (
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
    const kode = decodeURIComponent(String(req.params.kode || "").trim());
    if (!kode) {
      res.status(400).json({ status: "error", error: "Missing kode" });
      return;
    }

    const userItem = await prisma.hSPItem
      .findUnique({
        where: { scope_kode_unique: { scope: userScope, kode } },
      })
      .catch(() => null);

    if (userItem) {
      await prisma.hSPItem.update({
        where: { id: userItem.id },
        data: { isDeleted: true },
      });
      res
        .status(200)
        .json({ status: "success", message: "Item deleted in your scope" });
      return;
    }

    const global = await prisma.hSPItem.findUnique({
      where: { scope_kode_unique: { scope: "GLOBAL", kode } },
    });

    if (!global) {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }

    await prisma.hSPItem.create({
      data: {
        scope: userScope,
        kode: global.kode,
        deskripsi: global.deskripsi,
        satuan: global.satuan,
        harga: global.harga,
        hspCategoryId: global.hspCategoryId,
        isDeleted: true,
      },
    });

    res
      .status(200)
      .json({
        status: "success",
        message: "Item hidden (deleted) for this user",
      });
    return;
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: "Failed to delete item",
        detail: e?.message,
      });
    return;
  }
};
