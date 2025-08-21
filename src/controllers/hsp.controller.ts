import { Request, Response } from "express";
import prisma from "../lib/prisma";

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

export const listCategories = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 20), 1, 200);

    const where = q
      ? { name: { contains: q, mode: "insensitive" as const } }
      : {};

    const [total, data] = await Promise.all([
      prisma.hSPCategory.count({ where }),
      prisma.hSPCategory.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
        include: { _count: { select: { items: true } } },
      }),
    ]);

    res.status(200).json({
      status: "success",
      data,
      pagination: { skip, take, total },
    });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch categories",
      detail: e?.message,
    });
  }
};

export const getCategoryWithItems = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 50), 1, 500);
    const orderByField = (req.query.orderBy as string) || "kode";
    const orderDir = (req.query.orderDir as string) === "desc" ? "desc" : "asc";

    const itemWhere = q
      ? {
          OR: [
            { kode: { contains: q, mode: "insensitive" as const } },
            { deskripsi: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const category = await prisma.hSPCategory.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!category) {
      res.status(404).json({ status: "error", error: "Category not found" });
      return;
    }

    const [totalItems, items] = await Promise.all([
      prisma.hSPItem.count({
        where: { hspCategoryId: id, ...(itemWhere as any) },
      }),
      prisma.hSPItem.findMany({
        where: { hspCategoryId: id, ...(itemWhere as any) },
        orderBy:
          orderByField === "harga"
            ? { harga: orderDir as "asc" | "desc" }
            : { kode: orderDir as "asc" | "desc" },
        skip,
        take,
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

    res.status(200).json({
      status: "success",
      data: { ...category, items },
      pagination: { skip, take, total: totalItems },
    });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch category",
      detail: e?.message,
    });
  }
};

export const listItems = async (req: Request, res: Response) => {
  try {
    const categoryId = (req.query.categoryId as string) || undefined;
    const kodeExact = (req.query.kode as string) || undefined;
    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 50), 1, 1000);
    const orderByField = (req.query.orderBy as string) || "kode";
    const orderDir = (req.query.orderDir as string) === "desc" ? "desc" : "asc";

    const where: any = {};
    if (categoryId) where.hspCategoryId = categoryId;
    if (kodeExact) where.kode = kodeExact;
    if (q) {
      where.OR = [
        { kode: { contains: q, mode: "insensitive" } },
        { deskripsi: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, data] = await Promise.all([
      prisma.hSPItem.count({ where }),
      prisma.hSPItem.findMany({
        where,
        orderBy:
          orderByField === "harga"
            ? { harga: orderDir as "asc" | "desc" }
            : { kode: orderDir as "asc" | "desc" },
        skip,
        take,
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

    res.status(200).json({
      status: "success",
      data,
      pagination: { skip, take, total },
    });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch items",
      detail: e?.message,
    });
  }
};

export const listAllGrouped = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || "";
    const limitParam = toInt(req.query.limitPerCategory, 1000);
    const takePerCat = limitParam > 0 ? limitParam : undefined;
    const includeEmpty =
      String(req.query.includeEmpty || "false").toLowerCase() === "true";
    const itemOrderBy = (req.query.itemOrderBy as string) || "kode";
    const itemOrderDir =
      (req.query.itemOrderDir as string) === "desc" ? "desc" : "asc";

    const itemWhere = q
      ? {
          OR: [
            { kode: { contains: q, mode: "insensitive" as const } },
            { deskripsi: { contains: q, mode: "insensitive" as const } },
            { satuan: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const categoryWhere = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { items: { some: itemWhere as any } },
          ],
        }
      : {};

    const categories = await prisma.hSPCategory.findMany({
      where: categoryWhere as any,
      orderBy: { name: "asc" },
      include: {
        items: {
          where: itemWhere as any,
          orderBy:
            itemOrderBy === "harga"
              ? { harga: itemOrderDir as "asc" | "desc" }
              : { kode: itemOrderDir as "asc" | "desc" },
          take: takePerCat, // undefined => no limit
          select: { kode: true, deskripsi: true, satuan: true, harga: true },
        },
      },
    });

    const grouped: Record<
      string,
      Array<{ kode: string; deskripsi: string; satuan: string; harga: number }>
    > = {};
    let totalItems = 0;
    for (const cat of categories) {
      if (!includeEmpty && cat.items.length === 0) continue;
      grouped[cat.name] = cat.items.map((it) => ({
        kode: it.kode,
        deskripsi: it.deskripsi,
        satuan: it.satuan,
        harga: it.harga,
      }));
      totalItems += cat.items.length;
    }

    res.status(200).json({
      status: "success",
      data: grouped,
      meta: {
        categories: Object.keys(grouped).length,
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
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch categories with items",
      detail: e?.message,
    });
  }
};

export const getHsdDetail = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const useSnapshot =
      String(req.query.useSnapshot || "false").toLowerCase() === "true";
    const includeMaster =
      String(req.query.includeMaster || "true").toLowerCase() !== "false";

    const item = await prisma.hSPItem.findUnique({
      where: { id },
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

    if (!item) {
      res.status(404).json({ status: "error", error: "HSP item not found" });
      return;
    }

    // Jika belum ada recipe, tetap kembalikan informasi HSP-nya
    const recipe = item.ahsp;

    // Kelompok & hitung subtotal (A/B/C/Other)
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

        // Basis harga:
        // - jika useSnapshot: pakai snapshot terlebih dulu
        // - jika tidak: pakai priceOverride -> masterItem.price -> snapshot
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
          // master (opsional)
          masterItem: includeMaster ? comp.masterItem : undefined,

          // snapshot
          nameSnapshot: comp.nameSnapshot,
          unitSnapshot: comp.unitSnapshot,
          unitPriceSnapshot: comp.unitPriceSnapshot,

          // editable
          coefficient: comp.coefficient,
          priceOverride: comp.priceOverride,
          notes: comp.notes,

          // computed (on the fly)
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

    // Response payload
    const payload = {
      id: item.id,
      kode: item.kode,
      deskripsi: item.deskripsi,
      satuan: item.satuan,
      category: item.category,
      harga: item.harga, // harga tersimpan (cache)
      recipe: recipe
        ? {
            id: recipe.id,
            overheadPercent,
            // nilai tersimpan (jika ada)
            stored: {
              subtotalABC: recipe.subtotalABC,
              overheadAmount: recipe.overheadAmount,
              finalUnitPrice: recipe.finalUnitPrice,
            },
            // nilai terhitung saat ini
            computed: {
              A,
              B,
              C,
              D,
              E,
              F,
            },
            groups,
            notes: recipe.notes,
            updatedAt: recipe.updatedAt,
          }
        : null,
    };

    res.status(200).json({ status: "success", data: payload });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch HSD detail",
      detail: e?.message,
    });
  }
};

/**
 * Utility: daftar master item per type
 * Query:
 *  q?=string (search code/name/unit)
 *  skip?=0  take?=20 (1..200)
 *  orderBy?=code|name|price  orderDir?=asc|desc
 */
const listMasterByType = async (
  req: Request,
  res: Response,
  type: GroupKey
) => {
  try {
    const q = (req.query.q as string) || "";
    const skip = Math.max(0, toInt(req.query.skip, 0));
    const take = clamp(toInt(req.query.take, 20), 1, 200);
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

    const orderBy =
      orderByField === "price"
        ? { price: orderDir as "asc" | "desc" }
        : orderByField === "name"
          ? { name: orderDir as "asc" | "desc" }
          : { code: orderDir as "asc" | "desc" };

    const [total, data] = await Promise.all([
      prisma.masterItem.count({ where }),
      prisma.masterItem.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          price: true,
          type: true,
          hourlyRate: true,
          dailyRate: true,
          notes: true,
          updatedAt: true,
        },
      }),
    ]);

    res.status(200).json({
      status: "success",
      data,
      pagination: { skip, take, total },
      meta: { type },
    });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: `Failed to fetch master items (${type})`,
      detail: e?.message,
    });
  }
};

export const listMasterLabor = (req: Request, res: Response) =>
  listMasterByType(req, res, "LABOR");
export const listMasterMaterials = (req: Request, res: Response) =>
  listMasterByType(req, res, "MATERIAL");
export const listMasterEquipments = (req: Request, res: Response) =>
  listMasterByType(req, res, "EQUIPMENT");
export const listMasterOthers = (req: Request, res: Response) =>
  listMasterByType(req, res, "OTHER");

/**
 * Versi generic:
 * GET /master
 *   ?type=LABOR|MATERIAL|EQUIPMENT|OTHER
 *   ?q=&skip=&take=&orderBy=&orderDir=
 */
export const listMasterGeneric = async (req: Request, res: Response) => {
  const raw = (req.query.type as string) || "";
  const type = ["LABOR", "MATERIAL", "EQUIPMENT", "OTHER"].includes(raw)
    ? (raw as GroupKey)
    : undefined;
  if (!type) {
    res.status(400).json({
      status: "error",
      error:
        "Query parameter 'type' is required (LABOR|MATERIAL|EQUIPMENT|OTHER)",
    });
    return;
  }
  return listMasterByType(req, res, type);
};

export const getHsdDetailByKode = async (req: Request, res: Response) => {
  try {
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

    // Cari by KODE (unik). Fallback case-insensitive kalau exact tidak ketemu.
    let item = await prisma.hSPItem.findUnique({
      where: { kode: rawKode },
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

    if (!item) {
      item = await prisma.hSPItem.findFirst({
        where: { kode: { equals: rawKode, mode: "insensitive" } },
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

    if (!item) {
      res
        .status(404)
        .json({ status: "error", error: "HSP item not found by kode" });
      return;
    }

    type GroupKey = "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER";
    const GROUP_LABEL: Record<GroupKey, "A" | "B" | "C" | "X"> = {
      LABOR: "A",
      MATERIAL: "B",
      EQUIPMENT: "C",
      OTHER: "X",
    };

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
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch HSD detail by kode",
      detail: e?.message,
    });
  }
};
