// src/controllers/hsp.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { scopeOf, mergeUserOverGlobal } from "../lib/_scoping";
import { normalizeRole } from "../lib/authz";
import { getActiveSourceCodes } from "./source.controller";

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

type Role = "USER" | "ADMIN";

async function getRole(req: Request): Promise<Role | undefined> {
  const u = (req as any).user as { id?: string; role?: unknown } | undefined;

  // 1) coba dari req.user.role (bisa "admin" lowercase dll) → normalisasi
  const roleFromReq = normalizeRole(u?.role);
  if (roleFromReq) return roleFromReq;

  // 2) fallback ke DB
  if (u?.id) {
    const db = await prisma.user.findUnique({
      where: { id: u.id },
      select: { role: true },
    });
    return normalizeRole(db?.role);
  }
  return undefined;
}
function userScopeOf(req: Request) {
  const anyReq = req as any;
  const uid = anyReq.user?.id || anyReq.userId;
  return scopeOf(uid);
}

async function isGlobalBaseEmpty(): Promise<boolean> {
  const [cCats, cItems] = await Promise.all([
    prisma.hSPCategory.count({ where: { scope: "GLOBAL" } }),
    prisma.hSPItem.count({ where: { scope: "GLOBAL" } }),
  ]);
  return cCats === 0 && cItems === 0;
}

/** Seeding mode aktif kalau base GLOBAL masih kosong atau pakai ?seed=1 */
async function isSeedingMode(req: Request): Promise<boolean> {
  const seed = String((req.query.seed ?? req.body?.seed) || "").toLowerCase();
  if (seed === "1" || seed === "true") return true;
  return await isGlobalBaseEmpty();
}
/** ===== Helpers exist-anywhere (GLOBAL atau scope user manapun) ===== */
async function hspCategoryExistsAnywhere(name: string) {
  // case-insensitive agar nama sama beda kapital tetap terdeteksi
  return prisma.hSPCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, scope: true },
  });
}

async function hspItemExistsAnywhere(kode: string) {
  // kode biasanya case-sensitive; kalau mau aman bisa samakan kapitalisasi
  const kodeTrim = String(kode || "").trim();
  return prisma.hSPItem.findFirst({
    where: { kode: kodeTrim },
    select: { id: true, scope: true },
  });
}

/** Pastikan categoryId sesuai target scope; kalau beda scope, cari/buat berdasarkan name */
async function resolveCategoryIdForScope(
  categoryId: string,
  targetScope: string
): Promise<string> {
  const cat = await prisma.hSPCategory.findUnique({
    where: { id: categoryId },
  });
  if (!cat) throw new Error("Category not found");
  if (cat.scope === targetScope) return cat.id;

  const sameName = await prisma.hSPCategory.findFirst({
    where: { scope: targetScope, name: cat.name },
    select: { id: true },
  });
  if (sameName) return sameName.id;

  const created = await prisma.hSPCategory.create({
    data: { scope: targetScope, name: cat.name },
    select: { id: true },
  });
  return created.id;
}

/** ===========================================
 *  Penentu sumber efektif (override vs GLOBAL)
 *  =========================================== */
type SlimItem = {
  id: string;
  scope: string;
  kode: string;
  deskripsi: string;
  satuan: string;
  harga: number;
  hspCategoryId: string;
  isDeleted: boolean;
  isDisabled: boolean;
};
function chooseEffective(
  viewerRole: Role | undefined,
  u?: SlimItem | null,
  g?: SlimItem | null
): {
  chosen?: SlimItem;
  meta: {
    source: "USER" | "ADMIN";
    hasUserOverride: boolean;
    userActive: boolean;
  };
} {
  const hasUser = !!u && !u.isDeleted;
  const userActive = !!u && !u.isDeleted && !u.isDisabled;
  const hasGlobal = !!g && !g.isDeleted;

  // 1) user membuat tombstone -> sembunyikan item (tidak pilih apa pun)
  if (!!u && u.isDeleted) {
    return {
      chosen: undefined,
      meta: { source: "USER", hasUserOverride: true, userActive: false },
    };
  }

  // 2) override user aktif → pakai USER
  if (userActive) {
    return {
      chosen: u!,
      meta: { source: "USER", hasUserOverride: true, userActive: true },
    };
  }

  // 3) tidak ada override aktif, ada GLOBAL → pakai ADMIN
  if (hasGlobal) {
    return {
      chosen: g!,
      meta: { source: "ADMIN", hasUserOverride: !!u, userActive: false },
    };
  }

  // 4) fallback: ada user nonaktif tapi tidak ada global
  if (hasUser) {
    return {
      chosen: u!,
      meta: { source: "USER", hasUserOverride: true, userActive: false },
    };
  }

  return {
    chosen: undefined,
    meta: { source: "ADMIN", hasUserOverride: false, userActive: false },
  };
}

/** =========================
 *  CATEGORIES (scoped read)
 *  ========================= */
export const listCategories = async (req: Request, res: Response) => {
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
    const viewerRole = await getRole(req);
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

    // Pasangkan id kategori berdasar nama (user & global)
    const [uCat, gCat] = await Promise.all([
      prisma.hSPCategory.findFirst({
        where: { scope: userScope, name: cat.name },
        select: { id: true },
      }),
      prisma.hSPCategory.findFirst({
        where: { scope: "GLOBAL", name: cat.name },
        select: { id: true },
      }),
    ]);

    const idsForUser = [uCat?.id, gCat?.id].filter(Boolean) as string[];

    const whereUser: any = {
      isDeleted: false,
      scope: userScope,
      hspCategoryId: idsForUser.length ? { in: idsForUser } : "__NO_MATCH__",
    };
    const whereGlobal: any = {
      isDeleted: false,
      scope: "GLOBAL",
      hspCategoryId: gCat?.id ?? "__NO_MATCH__",
    };

    if (q) {
      const or = [
        { kode: { contains: q, mode: "insensitive" as const } },
        { deskripsi: { contains: q, mode: "insensitive" as const } },
      ];
      whereUser.OR = or;
      whereGlobal.OR = or;
    }

    const select = {
      id: true,
      scope: true,
      kode: true,
      deskripsi: true,
      satuan: true,
      harga: true,
      hspCategoryId: true,
      isDeleted: true,
      isDisabled: true,
      source: true,
    } as const;

    const [itemsUser, itemsGlobal] = await Promise.all([
      prisma.hSPItem.findMany({ where: whereUser, select }),
      prisma.hSPItem.findMany({ where: whereGlobal, select }),
    ]);

    const byKodeUser = new Map(itemsUser.map((r) => [r.kode, r]));
    const byKodeGlobal = new Map(itemsGlobal.map((r) => [r.kode, r]));
    const allKode = new Set([...byKodeUser.keys(), ...byKodeGlobal.keys()]);
    let items = Array.from(allKode)
      .map((kode) => {
        const { chosen, meta } = chooseEffective(
          viewerRole,
          byKodeUser.get(kode),
          byKodeGlobal.get(kode)
        );
        return chosen ? { ...chosen, meta } : null;
      })
      .filter(Boolean) as any[];

    items.sort((a, b) => {
      const dir = orderDir === "desc" ? -1 : 1;
      if (orderByField === "harga") return (a.harga - b.harga) * dir;
      return a.kode.localeCompare(b.kode) * dir;
    });

    const totalItems = items.length;
    items = items.slice(skip, skip + take);

    res.status(200).json({
      status: "success",
      data: { id: cat.id, name: cat.name, items },
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

/** =========================
 *  ITEMS LIST + GROUPED
 *  ========================= */
export const listItems = async (req: Request, res: Response) => {
  try {
    const viewerRole = await getRole(req);
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
    if (kodeExact) whereBase.kode = kodeExact;
    if (q) {
      whereBase.OR = [
        { kode: { contains: q, mode: "insensitive" } },
        { deskripsi: { contains: q, mode: "insensitive" } },
      ];
    }

    let categoryIdUser: string | undefined;
    let categoryIdGlobal: string | undefined;

    if (categoryId) {
      const cat = await prisma.hSPCategory.findUnique({
        where: { id: categoryId },
        select: { id: true, name: true },
      });
      if (cat) {
        const [uCat, gCat] = await Promise.all([
          prisma.hSPCategory.findFirst({
            where: { scope: userScope, name: cat.name },
            select: { id: true },
          }),
          prisma.hSPCategory.findFirst({
            where: { scope: "GLOBAL", name: cat.name },
            select: { id: true },
          }),
        ]);
        categoryIdUser = uCat?.id;
        categoryIdGlobal = gCat?.id;
      }
    }

    const whereUser: any = { ...whereBase, scope: userScope };
    const whereGlobal: any = { ...whereBase, scope: "GLOBAL" };

    if (categoryId) {
      const idsForUser = [categoryIdUser, categoryIdGlobal].filter(Boolean);
      if (idsForUser.length) whereUser.hspCategoryId = { in: idsForUser };
      whereGlobal.hspCategoryId = categoryIdGlobal ?? "__NO_MATCH__";
    }

    const select = {
      id: true,
      scope: true,
      kode: true,
      deskripsi: true,
      satuan: true,
      harga: true,
      hspCategoryId: true,
      isDeleted: true,
      isDisabled: true,
      category: { select: { id: true, name: true } },
      source: true,
    } as const;

    const [rowsUser, rowsGlobal] = await Promise.all([
      prisma.hSPItem.findMany({ where: whereUser, select }),
      prisma.hSPItem.findMany({ where: whereGlobal, select }),
    ]);

    const byKodeUser = new Map(rowsUser.map((r) => [r.kode, r]));
    const byKodeGlobal = new Map(rowsGlobal.map((r) => [r.kode, r]));
    const allKode = new Set([...byKodeUser.keys(), ...byKodeGlobal.keys()]);
    let data = Array.from(allKode)
      .map((kode) => {
        const { chosen, meta } = chooseEffective(
          viewerRole,
          byKodeUser.get(kode),
          byKodeGlobal.get(kode)
        );
        return chosen ? { ...chosen, meta } : null;
      })
      .filter(Boolean) as any[];

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
    const viewerRole = await getRole(req);
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

    // Ambil semua kategori di user-scope dan GLOBAL
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

    // Buat index by name
    const byNameUser = new Map(catsUser.map((c) => [c.name, c]));
    const byNameGlobal = new Map(catsGlobal.map((c) => [c.name, c]));

    // >>>>>>> Perubahan utamanya di sini: pakai UNION nama kategori
    const categoryNames = Array.from(
      new Set<string>([
        ...catsGlobal.map((c) => c.name),
        ...catsUser.map((c) => c.name),
      ])
    ).sort((a, b) => a.localeCompare(b));
    // <<<<<<<

    const result: Record<
      string,
      Array<{
        kode: string;
        deskripsi: string;
        satuan: string;
        harga: number;
        source: string;
        meta?: any;
      }>
    > = {};
    let totalItems = 0;

    const select = {
      id: true,
      scope: true,
      kode: true,
      deskripsi: true,
      satuan: true,
      harga: true,
      isDeleted: true,
      isDisabled: true,
      hspCategoryId: true,
      source: true,
    } as const;

    for (const catName of categoryNames) {
      const uCat = byNameUser.get(catName) || null;
      const gCat = byNameGlobal.get(catName) || null;

      // Kalau tidak ada di dua-duanya (harusnya tidak mungkin) skip
      if (!uCat && !gCat) continue;

      const whereUser: any = { isDeleted: false, scope: userScope };
      const whereGlobal: any = { isDeleted: false, scope: "GLOBAL" };

      // Penting: user item bisa refer ke category GLOBAL (override lama),
      // jadi kita cari di kedua id kategori (user & global) sekaligus untuk sisi USER.
      const idsForUser = [uCat?.id, gCat?.id].filter(Boolean) as string[];
      if (idsForUser.length) whereUser.hspCategoryId = { in: idsForUser };
      whereGlobal.hspCategoryId = gCat?.id ?? "__NO_MATCH__";

      const [iu, ig] = await Promise.all([
        prisma.hSPItem.findMany({ where: whereUser, select }),
        prisma.hSPItem.findMany({ where: whereGlobal, select }),
      ]);

      const mapU = new Map(iu.map((r) => [r.kode, r]));
      const mapG = new Map(ig.map((r) => [r.kode, r]));
      const allKode = new Set([...mapU.keys(), ...mapG.keys()]);

      let merged = Array.from(allKode)
        .map((kode) => {
          const { chosen, meta } = chooseEffective(
            viewerRole,
            mapU.get(kode),
            mapG.get(kode)
          );
          return chosen ? { ...chosen, meta } : null;
        })
        .filter(Boolean) as any[];

      const dir = itemOrderDir === "desc" ? -1 : 1;
      merged.sort((a, b) =>
        itemOrderBy === "harga"
          ? (a.harga - b.harga) * dir
          : a.kode.localeCompare(b.kode) * dir
      );

      if (typeof takePerCat === "number") merged = merged.slice(0, takePerCat);
      if (!includeEmpty && merged.length === 0) continue;

      result[catName] = merged.map(
        ({ kode, deskripsi, satuan, harga, meta, source }: any) => ({
          kode,
          deskripsi,
          satuan,
          harga,
          source,
          meta,
        })
      );
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
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch categories with items",
      detail: e?.message,
    });
  }
};
/** =========================
 *  DETAIL HSD / AHSP
 *  ========================= */
export const getHsdDetail = async (req: Request, res: Response) => {
  try {
    const viewerRole = await getRole(req);
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const { id } = req.params;
    const useSnapshot =
      String(req.query.useSnapshot || "false").toLowerCase() === "true";
    const includeMaster =
      String(req.query.includeMaster || "true").toLowerCase() !== "false";

    const selectItem = {
      id: true,
      scope: true,
      kode: true,
      deskripsi: true,
      satuan: true,
      harga: true,
      hspCategoryId: true,
      isDeleted: true,
      isDisabled: true,
      source: true,
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
    } as const;

    const base = await prisma.hSPItem.findFirst({
      where: { id, isDeleted: false },
      include: selectItem.ahsp,
      select: selectItem as any,
    } as any);

    if (!base) {
      res.status(404).json({ status: "error", error: "HSP item not found" });
      return;
    }

    let chosen = base as any;

    if (base.scope === "GLOBAL") {
      const override = await prisma.hSPItem
        .findUnique({
          where: { scope_kode_unique: { scope: userScope, kode: base.kode } },
          select: selectItem as any,
        })
        .catch(() => null);

      const eff = chooseEffective(viewerRole, override as any, base as any);
      if (eff.chosen) chosen = eff.chosen as any;
    }

    const recipe = chosen.ahsp;
    const groups: Record<GroupKey, any> = {
      LABOR: { key: "LABOR", label: GROUP_LABEL.LABOR, subtotal: 0, items: [] },
      MATERIAL: {
        key: "MATERIAL",
        label: GROUP_LABEL.MATERIAL,
        subtotal: 0,
        items: [],
      },
      EQUIPMENT: {
        key: "EQUIPMENT",
        label: GROUP_LABEL.EQUIPMENT,
        subtotal: 0,
        items: [],
      },
      OTHER: { key: "OTHER", label: GROUP_LABEL.OTHER, subtotal: 0, items: [] },
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
      id: chosen.id,
      scope: chosen.scope,
      kode: chosen.kode,
      deskripsi: chosen.deskripsi,
      satuan: chosen.satuan,
      category: chosen.category,
      harga: chosen.harga,
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
      error: "Failed to fetch HSD detail",
      detail: e?.message,
    });
  }
};

export const getHsdDetailByKode = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const viewerRole = await getRole(req);
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);

    const rawKode = decodeURIComponent((req.params.kode || "").trim());
    if (!rawKode) {
      res
        .status(400)
        .json({ status: "error", error: "Missing parameter 'kode'" });
      return;
    }

    const view = String(req.query.view || "AUTO").toUpperCase() as
      | "AUTO"
      | "ADMIN"
      | "USER";
    const useSnapshot =
      String(req.query.useSnapshot || "false").toLowerCase() === "true";
    const includeMaster =
      String(req.query.includeMaster || "true").toLowerCase() !== "false";

    const selectItem = {
      id: true,
      scope: true,
      kode: true,
      deskripsi: true,
      satuan: true,
      harga: true,
      hspCategoryId: true,
      isDeleted: true,
      isDisabled: true,
      source: true,
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
    } as const;

    const [userItem, globalItem] = await Promise.all([
      prisma.hSPItem
        .findUnique({
          where: { scope_kode_unique: { scope: userScope, kode: rawKode } },
          select: selectItem as any,
        })
        .catch(() => null),
      prisma.hSPItem
        .findUnique({
          where: { scope_kode_unique: { scope: "GLOBAL", kode: rawKode } },
          select: selectItem as any,
        })
        .catch(() => null),
    ]);

    const hasUser = !!userItem && !userItem.isDeleted;
    const userActive =
      !!userItem && !userItem.isDeleted && !userItem.isDisabled;

    let chosen: any = null;
    let effectiveSource: "USER" | "ADMIN" = "ADMIN";

    if (view === "USER") {
      if (!hasUser) {
        res
          .status(404)
          .json({ status: "error", error: "User override not found" });
        return;
      }
      chosen = userItem!;
      effectiveSource = viewerRole === "ADMIN" ? "ADMIN" : "USER";
    } else if (view === "ADMIN") {
      if (!globalItem || globalItem.isDeleted) {
        res
          .status(404)
          .json({ status: "error", error: "Admin item not found" });
        return;
      }
      chosen = globalItem;
      effectiveSource = "ADMIN";
    } else {
      const eff = chooseEffective(
        viewerRole,
        userItem as any,
        globalItem as any
      );
      chosen = eff.chosen;
      effectiveSource = eff.meta.source;
      if (!chosen) {
        res
          .status(404)
          .json({ status: "error", error: "HSP item not found by kode" });
        return;
      }
    }

    const recipe = chosen.ahsp;
    const groups: Record<GroupKey, any> = {
      LABOR: { key: "LABOR", label: GROUP_LABEL.LABOR, subtotal: 0, items: [] },
      MATERIAL: {
        key: "MATERIAL",
        label: GROUP_LABEL.MATERIAL,
        subtotal: 0,
        items: [],
      },
      EQUIPMENT: {
        key: "EQUIPMENT",
        label: GROUP_LABEL.EQUIPMENT,
        subtotal: 0,
        items: [],
      },
      OTHER: { key: "OTHER", label: GROUP_LABEL.OTHER, subtotal: 0, items: [] },
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
      id: chosen.id,
      scope: chosen.scope,
      kode: chosen.kode,
      deskripsi: chosen.deskripsi,
      satuan: chosen.satuan,
      category: chosen.category,
      harga: chosen.harga,
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
      meta: {
        effectiveSource,
        hasUserOverride: hasUser,
        userActive: !!userActive,
      },
    };

    res.status(200).json({ status: "success", data: payload });
    return;
  } catch (e: any) {
    res.status(500).json({
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
export const createHspCategory = async (req: Request, res: Response) => {
  try {
    const role = await getRole(req);
    const userScope = userScopeOf(req);

    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ status: "error", error: "Name is required" });
      return;
    }

    if (role === "ADMIN") {
      // Cek HANYA di GLOBAL
      const existsGlobal = await prisma.hSPCategory.findFirst({
        where: { scope: "GLOBAL", name: { equals: name, mode: "insensitive" } },
        select: {
          id: true,
          scope: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!existsGlobal) {
        // Belum ada di GLOBAL -> buat di GLOBAL
        const cat = await prisma.hSPCategory.create({
          data: { scope: "GLOBAL", name },
        });
        res
          .status(201)
          .json({ status: "success", data: cat, savedTo: "GLOBAL" });
        return;
      }

      // Sudah ada di GLOBAL -> kembalikan yang existing (tidak bikin copy)
      res.status(200).json({
        status: "success",
        data: existsGlobal,
        existing: true,
        savedTo: "GLOBAL",
      });
      return;
    }

    // USER biasa: selalu di scope user
    const existsInMyScope = await prisma.hSPCategory.findFirst({
      where: { scope: userScope, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existsInMyScope) {
      res.status(409).json({
        status: "error",
        error: "Category name already exists in your scope",
      });
      return;
    }

    const cat = await prisma.hSPCategory.create({
      data: { scope: userScope, name },
    });

    res.status(201).json({ status: "success", data: cat, savedTo: userScope });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({
        status: "error",
        error: "Category name already exists",
      });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to create category",
      detail: e?.message,
    });
  }
};

export const updateHspCategory = async (req: Request, res: Response) => {
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
    res.status(500).json({
      status: "error",
      error: "Failed to update category",
      detail: e?.message,
    });
  }
};

export const deleteHspCategory = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.hSPCategory.delete({ where: { id } });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to delete category",
      detail: e?.message,
    });
    return;
  }
  res.status(200).json({ status: "success", message: "Category deleted" });
};

/** =========================
 *  CRUD: HSP ITEMS (scoped)
 *  ========================= */
export const createHspItem = async (req: Request, res: Response) => {
  try {
    const role = await getRole(req);
    const userScope = userScopeOf(req);

    const {
      hspCategoryId,
      kode,
      deskripsi,
      satuan,
      source: sourceRaw,
    } = req.body || {};
    if (!hspCategoryId || !kode || !deskripsi) {
      res.status(400).json({
        status: "error",
        error: "hspCategoryId, kode, deskripsi are required",
      });
      return;
    }

    const kodeTrim = String(kode).trim();
    const deskripsiTrim = String(deskripsi).trim();
    const satuanTrim = String(satuan || "").trim();
    const s = String(sourceRaw || "").trim();
    let sourceTag: string | null = null;
    if (s) {
      const allowed = await getActiveSourceCodes();
      if (allowed.has(s.toLowerCase())) sourceTag = s;
    }
    if (role === "ADMIN") {
      // Cek HANYA di GLOBAL untuk item
      const existsGlobal = await prisma.hSPItem.findUnique({
        where: { scope_kode_unique: { scope: "GLOBAL", kode: kodeTrim } },
        select: { id: true },
      });

      if (!existsGlobal) {
        // Belum ada di GLOBAL -> buat ke GLOBAL (kategori direlokasi ke GLOBAL)
        const targetCategoryId = await resolveCategoryIdForScope(
          hspCategoryId,
          "GLOBAL"
        );

        const created = await prisma.hSPItem.create({
          data: {
            scope: "GLOBAL",
            hspCategoryId: targetCategoryId,
            kode: kodeTrim,
            deskripsi: deskripsiTrim,
            satuan: satuanTrim,
            harga: 0,
            isDeleted: false,
            isDisabled: false,
            source: sourceTag,
          },
          select: {
            id: true,
            scope: true,
            kode: true,
            deskripsi: true,
            satuan: true,
            harga: true,
            hspCategoryId: true,
            source: true,
          },
        });

        res
          .status(201)
          .json({ status: "success", data: created, savedTo: "GLOBAL" });
        return;
      }

      // Sudah ada di GLOBAL -> buat di scope admin sendiri (override admin)
      const existsInMyScope = await prisma.hSPItem.findFirst({
        where: { scope: userScope, kode: kodeTrim },
        select: { id: true },
      });
      if (existsInMyScope) {
        res.status(409).json({
          status: "error",
          error: "Kode already exists in your scope",
        });
        return;
      }

      const targetCategoryId = await resolveCategoryIdForScope(
        hspCategoryId,
        userScope
      );

      const created = await prisma.hSPItem.create({
        data: {
          scope: userScope,
          hspCategoryId: targetCategoryId,
          kode: kodeTrim,
          deskripsi: deskripsiTrim,
          satuan: satuanTrim,
          harga: 0,
          isDeleted: false,
          isDisabled: false,
          source: sourceTag,
        },
        select: {
          id: true,
          scope: true,
          kode: true,
          deskripsi: true,
          satuan: true,
          harga: true,
          hspCategoryId: true,
          source: true,
        },
      });

      res
        .status(201)
        .json({ status: "success", data: created, savedTo: userScope });
      return;
    }

    // USER biasa → selalu ke scope user
    const existsInMyScope = await prisma.hSPItem.findFirst({
      where: { scope: userScope, kode: kodeTrim },
      select: { id: true },
    });
    if (existsInMyScope) {
      res.status(409).json({
        status: "error",
        error: "Kode already exists in your scope",
      });
      return;
    }

    const targetCategoryId = await resolveCategoryIdForScope(
      hspCategoryId,
      userScope
    );

    const created = await prisma.hSPItem.create({
      data: {
        scope: userScope,
        hspCategoryId: targetCategoryId,
        kode: kodeTrim,
        deskripsi: deskripsiTrim,
        satuan: satuanTrim,
        harga: 0,
        isDeleted: false,
        isDisabled: false,
        source: sourceTag,
      },
      select: {
        id: true,
        scope: true,
        kode: true,
        deskripsi: true,
        satuan: true,
        harga: true,
        hspCategoryId: true,
        source: true,
      },
    });

    res
      .status(201)
      .json({ status: "success", data: created, savedTo: userScope });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({
        status: "error",
        error: "Kode already exists in target scope",
      });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to create item",
      detail: e?.message,
    });
  }
};

export const updateHspItem = async (req: Request, res: Response) => {
  try {
    const role = await getRole(req);

    const { id } = req.params;

    const payload: {
      hspCategoryId?: string;
      kode?: string;
      deskripsi?: string;
      satuan?: string;
      source?: string | null;
    } = {};
    if (typeof req.body?.hspCategoryId === "string")
      payload.hspCategoryId = req.body.hspCategoryId;
    if (typeof req.body?.kode === "string") payload.kode = req.body.kode.trim();
    if (typeof req.body?.deskripsi === "string")
      payload.deskripsi = req.body.deskripsi.trim();
    if (typeof req.body?.satuan === "string")
      payload.satuan = req.body.satuan.trim();
    if (typeof req.body?.source === "string") {
      const s = req.body.source.trim();
      const allowed = await getActiveSourceCodes();
      (payload as any).source = allowed.has(s.toLowerCase()) ? s : null;
    }

    const current = await prisma.hSPItem.findUnique({
      where: { id },
      include: { category: { select: { id: true, name: true, scope: true } } },
    });
    if (!current) {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }

    if (role === "ADMIN" && current.scope === "GLOBAL") {
      let targetCategoryId: string | undefined;
      if (payload.hspCategoryId) {
        targetCategoryId = await resolveCategoryIdForScope(
          payload.hspCategoryId,
          "GLOBAL"
        );
      }

      const updated = await prisma.hSPItem.update({
        where: { id: current.id },
        data: {
          ...(payload.kode ? { kode: payload.kode } : {}),
          ...(payload.deskripsi ? { deskripsi: payload.deskripsi } : {}),
          ...(payload.satuan ? { satuan: payload.satuan } : {}),
          ...(payload.source !== undefined ? { source: payload.source } : {}),
          ...(typeof targetCategoryId === "string"
            ? { hspCategoryId: targetCategoryId }
            : {}),
          isDeleted: false,
          isDisabled: false,
        },
        select: {
          id: true,
          scope: true,
          kode: true,
          deskripsi: true,
          satuan: true,
          harga: true,
          hspCategoryId: true,
          source: true,
        },
      });

      res.status(200).json({ status: "success", data: updated });
      return;
    }

    if (current.scope === "GLOBAL" && role !== "ADMIN") {
      res.status(403).json({
        status: "error",
        error:
          "Forbidden: only admin can update GLOBAL items. Use override endpoints instead.",
      });
      return;
    }

    let targetCategoryId: string | undefined;
    if (payload.hspCategoryId) {
      const targetScope = current.scope;
      targetCategoryId = await resolveCategoryIdForScope(
        payload.hspCategoryId,
        targetScope
      );
    }

    const updated = await prisma.hSPItem.update({
      where: { id: current.id },
      data: {
        ...(payload.kode ? { kode: payload.kode } : {}),
        ...(payload.deskripsi ? { deskripsi: payload.deskripsi } : {}),
        ...(payload.satuan ? { satuan: payload.satuan } : {}),
        ...(typeof targetCategoryId === "string"
          ? { hspCategoryId: targetCategoryId }
          : {}),
        isDeleted: false,
        isDisabled: false,
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

    res.status(200).json({ status: "success", data: updated });
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }
    if (e?.code === "P2002") {
      res.status(409).json({
        status: "error",
        error: "Kode already exists in target scope",
      });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to update item",
      detail: e?.message,
    });
  }
};

export const deleteHspItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.hSPItem.delete({ where: { id } });
    res.status(200).json({ status: "success", message: "Item deleted" });
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to delete item",
      detail: e?.message,
    });
  }
};

/** PATCH /hsp/items/by-kode/:kode (copy-on-write + activate override) */
export const updateHspItemByKode = async (req: Request, res: Response) => {
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
      source?: string | null;
    } = {};
    if (typeof req.body?.hspCategoryId === "string")
      payload.hspCategoryId = req.body.hspCategoryId;
    if (typeof req.body?.kode === "string") payload.kode = req.body.kode.trim();
    if (typeof req.body?.deskripsi === "string")
      payload.deskripsi = req.body.deskripsi.trim();
    if (typeof req.body?.satuan === "string")
      payload.satuan = req.body.satuan.trim();

    if (typeof req.body?.source === "string") {
      const s = req.body.source.trim();
      const allowed = await getActiveSourceCodes();
      (payload as any).source = allowed.has(s.toLowerCase()) ? s : null;
    }

    let userItem = await prisma.hSPItem
      .findUnique({ where: { scope_kode_unique: { scope: userScope, kode } } })
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
          isDeleted: false,
          isDisabled: false,
          source: base.source ?? null,
        },
      });
    }

    const updated = await prisma.hSPItem.update({
      where: { id: userItem.id },
      data: { ...payload, isDeleted: false, isDisabled: false },
      select: {
        id: true,
        scope: true,
        kode: true,
        deskripsi: true,
        satuan: true,
        harga: true,
        hspCategoryId: true,
        source: true,
      },
    });

    res.status(200).json({ status: "success", data: updated });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res
        .status(409)
        .json({ status: "error", error: "Kode already exists in your scope" });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to update item",
      detail: e?.message,
    });
  }
};

/** DELETE /hsp/items/by-kode/:kode (tombstone) */
export const deleteHspItemByKode = async (req: Request, res: Response) => {
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
      .findUnique({ where: { scope_kode_unique: { scope: userScope, kode } } })
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

    res.status(200).json({
      status: "success",
      message: "Item hidden (deleted) for this user",
    });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to delete item",
      detail: e?.message,
    });
  }
};

/** PATCH /hsp/items/by-kode/:kode/override/active  { active: boolean } */
export const setHspOverrideActive = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      res.status(401).json({ status: "error", error: "Unauthorized" });
      return;
    }

    const scope = scopeOf(userId);
    const kode = decodeURIComponent(String(req.params.kode || "").trim());
    const active = !!req.body?.active;
    if (!kode) {
      res.status(400).json({ status: "error", error: "Missing kode" });
      return;
    }

    let u = await prisma.hSPItem
      .findUnique({
        where: { scope_kode_unique: { scope, kode } },
        include: { ahsp: { include: { components: true } } },
      })
      .catch(() => null);

    if (!u) {
      const g = await prisma.hSPItem.findUnique({
        where: { scope_kode_unique: { scope: "GLOBAL", kode } },
        include: { ahsp: { include: { components: true } } },
      });
      if (!g || g.isDeleted) {
        res.status(404).json({ status: "error", error: "Item not found" });
        return;
      }

      u = await prisma.hSPItem.create({
        data: {
          scope,
          kode: g.kode,
          deskripsi: g.deskripsi,
          satuan: g.satuan,
          harga: g.harga,
          hspCategoryId: g.hspCategoryId,
          isDeleted: false,
          isDisabled: !active,
        },
      });

      if (g.ahsp) {
        const newRecipe = await prisma.aHSPRecipe.create({
          data: {
            scope,
            hspItemId: u.id,
            overheadPercent: g.ahsp.overheadPercent,
            notes: g.ahsp.notes ?? null,
            subtotalABC: g.ahsp.subtotalABC ?? null,
            overheadAmount: g.ahsp.overheadAmount ?? null,
            finalUnitPrice: g.ahsp.finalUnitPrice ?? null,
          },
        });
        if (g.ahsp.components?.length) {
          await prisma.$transaction(
            g.ahsp.components.map((c) =>
              prisma.aHSPComponent.create({
                data: {
                  scope,
                  ahspId: newRecipe.id,
                  group: c.group,
                  masterItemId: c.masterItemId,
                  nameSnapshot: c.nameSnapshot,
                  unitSnapshot: c.unitSnapshot,
                  unitPriceSnapshot: c.unitPriceSnapshot,
                  coefficient: c.coefficient,
                  priceOverride: c.priceOverride,
                  effectiveUnitPrice:
                    c.effectiveUnitPrice ?? c.priceOverride ?? null,
                  subtotal: c.subtotal ?? null,
                  order: c.order,
                  notes: c.notes ?? null,
                },
              })
            )
          );
        }
      }
    } else {
      await prisma.hSPItem.update({
        where: { id: u.id },
        data: { isDisabled: !active, isDeleted: false },
      });
    }

    res.status(200).json({ status: "success", data: { kode, active } });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to set override state",
      detail: e?.message,
    });
    return;
  }
};
export const listAllScopesWithItems = async (req: Request, res: Response) => {
  try {
    // ROLE & SCOPE PEMANGGIL
    const roleRaw = await getRole(req);
    const effectiveRole: Role = roleRaw === "ADMIN" ? "ADMIN" : "USER"; // fallback aman
    const callerUserId = (req as any).user?.id as string | undefined;
    const callerScope = scopeOf(callerUserId); // "u:<id>" atau "u:guest" kalau undefined

    // ==== PARAMS ====
    const q = (req.query.q as string) || "";
    const requestedScopeFilter = (req.query.scope as string) || "ALL"; // ALL | GLOBAL | USER | u:<id>
    const includeEmpty =
      String(req.query.includeEmpty || "false").toLowerCase() === "true";
    const includeDisabled =
      String(req.query.includeDisabled || "false").toLowerCase() === "true";
    const includeDeleted =
      String(req.query.includeDeleted || "false").toLowerCase() === "true";
    const limitParam = toInt(req.query.limitPerCategory, 0);
    const takePerCat = limitParam > 0 ? limitParam : undefined;

    const itemOrderBy = (req.query.itemOrderBy as string) || "kode"; // kode | harga
    const itemOrderDir =
      (req.query.itemOrderDir as string) === "desc" ? "desc" : "asc";
    const flat = String(req.query.flat || "false").toLowerCase() === "true";

    // ==== SCOPE FILTER RESOLVER ====
    // ADMIN: hormati requested filter.
    // USER: abaikan requested filter; batasi ke GLOBAL + callerScope saja.
    const isAdmin = effectiveRole === "ADMIN";

    const adminMatchScope = (scope: string) => {
      if (requestedScopeFilter === "ALL") return true;
      if (requestedScopeFilter === "GLOBAL") return scope === "GLOBAL";
      if (requestedScopeFilter === "USER") return scope.startsWith("u:");
      if (requestedScopeFilter.startsWith("u:"))
        return scope === requestedScopeFilter;
      return true;
    };

    const userMatchScope = (scope: string) => {
      if (scope === "GLOBAL") return true;
      if (callerScope && scope === callerScope) return true;
      return false;
    };

    const canSeeScope = (scope: string) =>
      isAdmin ? adminMatchScope(scope) : userMatchScope(scope);

    // 1) AMBIL SEMUA KATEGORI LALU FILTER SESUAI AKSES
    const allCats = await prisma.hSPCategory.findMany({
      select: { id: true, name: true, scope: true },
      orderBy: { name: "asc" },
    });
    const cats = allCats.filter((c) => canSeeScope(c.scope));

    if (cats.length === 0) {
      res.status(200).json({
        status: "success",
        data: flat ? [] : {},
        meta: {
          categories: 0,
          items: 0,
          scopes: {
            GLOBAL: 0,
            USER: 0,
          },
          role: effectiveRole,
          params: {
            q,
            scope: isAdmin ? requestedScopeFilter : "SELF", // info meta
            includeEmpty,
            includeDisabled,
            includeDeleted,
            flat,
            itemOrderBy,
            itemOrderDir,
          },
        },
      });
      return;
    }

    const catIdToName = new Map<string, string>();
    const catIdToScope = new Map<string, string>();
    const nameToCatIds = new Map<string, string[]>();
    let countGlobalCats = 0;
    let countUserCats = 0;

    for (const c of cats) {
      catIdToName.set(c.id, c.name);
      catIdToScope.set(c.id, c.scope);
      if (!nameToCatIds.has(c.name)) nameToCatIds.set(c.name, []);
      nameToCatIds.get(c.name)!.push(c.id);
      if (c.scope === "GLOBAL") countGlobalCats++;
      else if (c.scope.startsWith("u:")) countUserCats++;
    }

    const allCatIds = cats.map((c) => c.id);

    // 2) AMBIL ITEM SESUAI KATEGORI DI ATAS
    const whereItems: any = { hspCategoryId: { in: allCatIds } };
    if (!includeDeleted) whereItems.isDeleted = false;
    if (!includeDisabled) whereItems.isDisabled = false;
    if (q) {
      whereItems.OR = [
        { kode: { contains: q, mode: "insensitive" } },
        { deskripsi: { contains: q, mode: "insensitive" } },
      ];
    }

    const selectItem = {
      id: true,
      scope: true,
      kode: true,
      deskripsi: true,
      satuan: true,
      harga: true,
      isDeleted: true,
      isDisabled: true,
      hspCategoryId: true,
      source: true,
    } as const;

    const allItems = await prisma.hSPItem.findMany({
      where: whereItems,
      select: selectItem,
    });

    // 3) SUSUN HASIL
    const sortItems = (arr: any[]) => {
      const dir = itemOrderDir === "desc" ? -1 : 1;
      arr.sort((a, b) => {
        if (itemOrderBy === "harga") return (a.harga - b.harga) * dir;
        return a.kode.localeCompare(b.kode) * dir;
      });
    };

    if (flat) {
      const flatArr = allItems.map((it) => ({
        id: it.id,
        scope: it.scope,
        source: it.scope === "GLOBAL" ? "ADMIN" : "USER",
        ownerUserId: it.scope.startsWith("u:") ? it.scope.slice(2) : null,
        kode: it.kode,
        deskripsi: it.deskripsi,
        satuan: it.satuan,
        harga: it.harga,
        categoryId: it.hspCategoryId,
        categoryName: catIdToName.get(it.hspCategoryId) || null,
        categoryScope: catIdToScope.get(it.hspCategoryId) || null,
      }));

      sortItems(flatArr);

      res.status(200).json({
        status: "success",
        data: flatArr,
        meta: {
          categories: nameToCatIds.size,
          items: flatArr.length,
          scopes: { GLOBAL: countGlobalCats, USER: countUserCats },
          role: effectiveRole,
          params: {
            q,
            scope: isAdmin ? requestedScopeFilter : "SELF",
            includeEmpty,
            includeDisabled,
            includeDeleted,
            flat: true,
            itemOrderBy,
            itemOrderDir,
          },
        },
      });
      return;
    }

    // GROUPED
    const grouped: Record<string, any[]> = {};
    for (const [catName, ids] of nameToCatIds.entries()) {
      const items = allItems
        .filter((it) => ids.includes(it.hspCategoryId))
        .map((it) => ({
          id: it.id,
          scope: it.scope,
          source: it.scope === "GLOBAL" ? "ADMIN" : "USER",
          ownerUserId: it.scope.startsWith("u:") ? it.scope.slice(2) : null,
          kode: it.kode,
          deskripsi: it.deskripsi,
          satuan: it.satuan,
          harga: it.harga,
          categoryId: it.hspCategoryId,
          categoryName: catName,
          categoryScope: catIdToScope.get(it.hspCategoryId) || null,
        }));

      sortItems(items);
      const sliced =
        typeof takePerCat === "number" ? items.slice(0, takePerCat) : items;
      if (!includeEmpty && sliced.length === 0) continue;
      grouped[catName] = sliced;
    }

    const totalItems = Object.values(grouped).reduce(
      (a, arr) => a + arr.length,
      0
    );

    res.status(200).json({
      status: "success",
      data: grouped,
      meta: {
        categories: Object.keys(grouped).length,
        items: totalItems,
        scopes: { GLOBAL: countGlobalCats, USER: countUserCats },
        role: effectiveRole,
        params: {
          q,
          scope: isAdmin ? requestedScopeFilter : "SELF",
          includeEmpty,
          includeDisabled,
          includeDeleted,
          limitPerCategory: takePerCat ?? "ALL",
          itemOrderBy,
          itemOrderDir,
          flat: false,
        },
      },
    });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch all scopes with items",
      detail: e?.message,
    });
  }
};
