// src/controllers/categories.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { scopeOf, mergeUserOverGlobal } from "../lib/_scoping";
import { normalizeRole } from "../lib/authz";

/* Helpers (disalin agar behavior sama persis) */
const toInt = (v: any, def = 0) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
};
function userScopeOf(req: Request) {
  const anyReq = req as any;
  const uid = anyReq.user?.id || anyReq.userId;
  return scopeOf(uid);
}

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

type Role = "USER" | "ADMIN";

async function getRole(req: Request): Promise<Role | undefined> {
  const anyReq = req as any;

  const roleFromReq = normalizeRole(anyReq.user?.role);
  if (roleFromReq) return roleFromReq;

  const uid = anyReq.user?.id || anyReq.userId;
  if (uid) {
    const db = await prisma.user.findUnique({
      where: { id: uid },
      select: { role: true },
    });
    return normalizeRole(db?.role);
  }
  return undefined;
}

type GroupKey = "LABOR" | "MATERIAL" | "EQUIPMENT" | "OTHER";
const GROUP_LABEL: Record<GroupKey, "A" | "B" | "C" | "X"> = {
  LABOR: "A",
  MATERIAL: "B",
  EQUIPMENT: "C",
  OTHER: "X",
};

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
  source: string | null;
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

  if (!!u && u.isDeleted) {
    return {
      chosen: undefined,
      meta: { source: "USER", hasUserOverride: true, userActive: false },
    };
  }
  if (userActive) {
    return {
      chosen: u!,
      meta: { source: "USER", hasUserOverride: true, userActive: true },
    };
  }
  if (hasGlobal) {
    return {
      chosen: g!,
      meta: { source: "ADMIN", hasUserOverride: !!u, userActive: false },
    };
  }
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
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          scope: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.hSPCategory.findMany({
        where: { ...whereBase, scope: "GLOBAL" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          scope: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const byNameUserIds = new Map<string, string[]>();
    const byNameGlobalIds = new Map<string, string[]>();
    for (const c of rowsUser) {
      if (!byNameUserIds.has(c.name)) byNameUserIds.set(c.name, []);
      byNameUserIds.get(c.name)!.push(c.id);
    }
    for (const c of rowsGlobal) {
      if (!byNameGlobalIds.has(c.name)) byNameGlobalIds.set(c.name, []);
      byNameGlobalIds.get(c.name)!.push(c.id);
    }

    const allCatIds = [
      ...rowsUser.map((c) => c.id),
      ...rowsGlobal.map((c) => c.id),
    ];

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

    const [itemsUser, itemsGlobal] = await Promise.all([
      prisma.hSPItem.findMany({
        where: {
          scope: userScope,
          hspCategoryId: { in: allCatIds },
          isDeleted: false,
        },
        select: selectItem,
      }),
      prisma.hSPItem.findMany({
        where: {
          scope: "GLOBAL",
          hspCategoryId: { in: allCatIds },
          isDeleted: false,
        },
        select: selectItem,
      }),
    ]);

    const catIdToName = new Map<string, string>();
    for (const c of [...rowsUser, ...rowsGlobal]) catIdToName.set(c.id, c.name);

    const byNameUserKode = new Map<
      string,
      Map<string, (typeof itemsUser)[number]>
    >();
    const byNameGlobalKode = new Map<
      string,
      Map<string, (typeof itemsGlobal)[number]>
    >();

    const addTo = (
      holder: Map<string, Map<string, any>>,
      name: string,
      it: any
    ) => {
      if (!holder.has(name)) holder.set(name, new Map());
      holder.get(name)!.set(it.kode, it);
    };

    for (const it of itemsUser) {
      const name = catIdToName.get(it.hspCategoryId);
      if (name) addTo(byNameUserKode, name, it);
    }
    for (const it of itemsGlobal) {
      const name = catIdToName.get(it.hspCategoryId);
      if (name) addTo(byNameGlobalKode, name, it);
    }

    const effectiveCountByName = new Map<string, number>();
    for (const name of new Set([...catIdToName.values()])) {
      const uMap = byNameUserKode.get(name) ?? new Map();
      const gMap = byNameGlobalKode.get(name) ?? new Map();
      const allKode = new Set<string>([...uMap.keys(), ...gMap.keys()]);
      let count = 0;
      for (const kode of allKode) {
        const u = uMap.get(kode);
        const g = gMap.get(kode);
        const { chosen } = chooseEffective(
          await getRole(req),
          u as any,
          g as any
        );
        if (chosen) count++;
      }
      effectiveCountByName.set(name, count);
    }

    const mergedRaw = mergeUserOverGlobal(rowsUser, rowsGlobal, (r) => r.name);
    const merged = mergedRaw.map((r) => ({
      ...r,
      _count: { items: effectiveCountByName.get(r.name) ?? 0 },
    }));

    merged.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const total = merged.length;
    const data = merged.slice(skip, skip + take);

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
