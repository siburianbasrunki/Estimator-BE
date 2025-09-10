import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { scopeOf } from "../lib/_scoping";
import { pickEffective } from "../lib/_override";
import { normalizeRole } from "../lib/authz";

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
type Role = "ADMIN" | "USER";

async function getAuth(
  req: Request
): Promise<{ userId?: string; role?: Role }> {
  const anyReq = req as any;
  const userId = anyReq.user?.id || anyReq.userId || undefined;

  let role =
    normalizeRole(anyReq.user?.role) ||
    normalizeRole(anyReq.userRole) ||
    undefined;

  if (!role && userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    role = normalizeRole(u?.role);
  }
  return { userId, role };
}
async function getRole(req: Request): Promise<Role | undefined> {
  const anyReq = req as any;
  const r =
    (anyReq.user?.role && String(anyReq.user.role).toUpperCase()) ||
    (anyReq.userRole && String(anyReq.userRole).toUpperCase());
  if (r === "ADMIN" || r === "USER") return r as Role;

  const uid = anyReq.user?.id || anyReq.userId;
  if (uid) {
    const row = await prisma.user.findUnique({
      where: { id: uid },
      select: { role: true },
    });
    const rr = row?.role && String(row.role).toUpperCase();
    if (rr === "ADMIN" || rr === "USER") return rr as Role;
  }
  return undefined;
}
function chooseEffective(
  viewerRole: Role | undefined,
  u?: { isDeleted: boolean; isDisabled: boolean } | null,
  g?: { isDeleted: boolean } | null
): {
  chosen?: any;
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
      meta: {
        source: viewerRole === "ADMIN" ? "ADMIN" : "USER",
        hasUserOverride: true,
        userActive: false,
      },
    };
  }

  if (userActive) {
    return {
      chosen: u!,
      meta: {
        source: viewerRole === "ADMIN" ? "ADMIN" : "USER",
        hasUserOverride: true,
        userActive: true,
      },
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
      meta: {
        source: viewerRole === "ADMIN" ? "ADMIN" : "USER",
        hasUserOverride: true,
        userActive: false,
      },
    };
  }

  return {
    chosen: undefined,
    meta: { source: "ADMIN", hasUserOverride: false, userActive: false },
  };
}

/** LIST GENERIC BY TYPE (effective + meta) */
export const listMasterGeneric = async (req: Request, res: Response) => {
  try {
    const { userId, role } = await getAuth(req);
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

    // ⬅️ USER: TANPA filter isDeleted (agar tombstone bisa menyembunyikan GLOBAL)
    const whereUser: any = { type, scope: userScope };
    // ⬅️ GLOBAL: tetap buang yang isDeleted
    const whereGlobal: any = { type, scope: "GLOBAL", isDeleted: false };

    if (q) {
      const OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { unit: { contains: q, mode: "insensitive" } },
      ];
      whereUser.OR = OR;
      whereGlobal.OR = OR;
    }

    const [rowsUser, rowsGlobal] = await Promise.all([
      prisma.masterItem.findMany({ where: whereUser }),
      prisma.masterItem.findMany({ where: whereGlobal }),
    ]);

    const mapU = new Map(rowsUser.map((r) => [r.code, r]));
    const mapG = new Map(rowsGlobal.map((r) => [r.code, r]));
    const codes = new Set([...mapU.keys(), ...mapG.keys()]);

    // pakai resolver efektif yang kamu punya (pickEffective) atau logika sejenis
    let data = Array.from(codes)
      .map((code) => {
        const { chosen, meta } = pickEffective(mapU.get(code), mapG.get(code));
        return chosen ? { ...chosen, meta } : null;
      })
      .filter(Boolean) as any[];

    data.sort((a, b) => {
      const dir = orderDir === "desc" ? -1 : 1;
      if (orderByField === "price") return (a.price - b.price) * dir;
      if (orderByField === "name") return a.name.localeCompare(b.name) * dir;
      return a.code.localeCompare(b.code) * dir;
    });

    const total = data.length;
    data = data.slice(skip, skip + take);

    res.status(200).json({
      status: "success",
      data,
      pagination: { skip, take, total },
      meta: { type, viewerRole: role },
    });
  } catch (e: any) {
    res
      .status(500)
      .json({
        status: "error",
        error: `Failed to fetch master items`,
        detail: e?.message,
      });
  }
};

export const createMasterItem = async (req: Request, res: Response) => {
  try {
    const { userId, role } = await getAuth(req);
    const userScope = scopeOf(userId);

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

    // hitung price utk LABOR
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

    // ⬅️ KUNCI: admin → GLOBAL, user → userScope
    const targetScope = role === "ADMIN" ? "GLOBAL" : userScope;

    const data: any = {
      scope: targetScope,
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
    res.status(201).json({
      status: "success",
      data: created,
      _debug: { role, targetScope }, // ⬅️ supaya kamu bisa lihat peran & scope saat create
    });
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
  }
};

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
        res.status(400).json({
          status: "error",
          error: "price must be a non-negative number",
        });
        return;
      }
      payload.price = n;
    }
    if (req.body.type !== undefined) {
      if (!isValidType(req.body.type)) {
        res.status(400).json({
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

    res.status(200).json({
      status: "success",
      data: updated,
      meta: { recomputed: recompute },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({
        status: "error",
        error: "Duplicate code. 'code' must be unique in its scope.",
      });
      return;
    }
    res.status(500).json({
      status: "error",
      error: "Failed to update master item",
      detail: e?.message,
    });
  }
};

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

export const getMasterItemByCode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const userScope = scopeOf(userId);
    const raw = decodeURIComponent((req.params.code || "").trim());
    if (!raw) {
      res.status(400).json({ status: "error", error: "Missing code" });
      return;
    }

    let item = await prisma.masterItem
      .findUnique({
        where: { scope_code_unique: { scope: userScope, code: raw } },
      })
      .catch(() => null);

    if (!item || item.isDeleted) {
      const g = await prisma.masterItem.findUnique({
        where: { scope_code_unique: { scope: "GLOBAL", code: raw } },
      });
      if (!g || g.isDeleted) {
        res
          .status(404)
          .json({ status: "error", error: "Master item not found" });
        return;
      }
      item = g;
    }

    res.status(200).json({ status: "success", data: item });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to fetch by code",
      detail: e?.message,
    });
  }
};

export const updateMasterItemByCode = async (req: Request, res: Response) => {
  try {
    const { userId, role } = await getAuth(req);
    if (!userId) {
      res.status(401).json({ status: "error", error: "Unauthorized" });
      return;
    }

    const userScope = scopeOf(userId);
    const code = decodeURIComponent((req.params.code || "").trim());
    if (!code) {
      res.status(400).json({ status: "error", error: "Missing code" });
      return;
    }

    if (role === "ADMIN") {
      const g = await prisma.masterItem.findUnique({
        where: { scope_code_unique: { scope: "GLOBAL", code } },
      });
      if (!g || g.isDeleted) {
        res.status(404).json({ status: "error", error: "Global item not found" });
        return;
      }

      const payload: any = {};
      if (req.body.name !== undefined) payload.name = String(req.body.name).trim();
      if (req.body.unit !== undefined) payload.unit = String(req.body.unit).trim();
      if (req.body.price !== undefined) payload.price = Number(req.body.price);
      if (req.body.notes !== undefined) payload.notes = req.body.notes ? String(req.body.notes) : null;
      if (req.body.hourlyRate !== undefined) payload.hourlyRate = Number(req.body.hourlyRate);
      if (req.body.dailyRate !== undefined) payload.dailyRate = Number(req.body.dailyRate);
      if (req.body.type !== undefined) payload.type = String(req.body.type);

      const updated = await prisma.masterItem.update({ where: { id: g.id }, data: payload });
      res.status(200).json({ status: "success", data: updated, _debug: { role, scope: "GLOBAL" } });
      return;
    }

    // USER → copy-on-write (override)
    let userItem = await prisma.masterItem
      .findUnique({ where: { scope_code_unique: { scope: userScope, code } } })
      .catch(() => null);

    if (!userItem) {
      const base = await prisma.masterItem.findUnique({
        where: { scope_code_unique: { scope: "GLOBAL", code } },
      });
      if (!base || base.isDeleted) {
        res.status(404).json({ status: "error", error: "Base not found" });
        return;
      }
      userItem = await prisma.masterItem.create({
        data: {
          scope: userScope,
          code: base.code,
          name: base.name,
          unit: base.unit,
          price: base.price,
          type: base.type,
          hourlyRate: base.hourlyRate,
          dailyRate: base.dailyRate,
          notes: base.notes,
          isDeleted: false,
          isDisabled: false,
        },
      });
    }

    const payload: any = {};
    if (req.body.name !== undefined) payload.name = String(req.body.name).trim();
    if (req.body.unit !== undefined) payload.unit = String(req.body.unit).trim();
    if (req.body.price !== undefined) payload.price = Number(req.body.price);
    if (req.body.notes !== undefined) payload.notes = req.body.notes ? String(req.body.notes) : null;
    if (req.body.hourlyRate !== undefined) payload.hourlyRate = Number(req.body.hourlyRate);
    if (req.body.dailyRate !== undefined) payload.dailyRate = Number(req.body.dailyRate);
    if (req.body.type !== undefined) payload.type = String(req.body.type);
    payload.isDeleted = false;
    payload.isDisabled = false;

    const updated = await prisma.masterItem.update({ where: { id: userItem.id }, data: payload });
    res.status(200).json({ status: "success", data: updated, _debug: { role, scope: userScope } });
  } catch (e: any) {
    if (e?.code === "P2002") {
      res.status(409).json({ status: "error", error: "Duplicate code in your scope" });
      return;
    }
    res.status(500).json({ status: "error", error: "Failed to update by code", detail: e?.message });
  }
};


export const deleteMasterItemByCode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) {
      res.status(401).json({ status: "error", error: "Unauthorized" });
      return;
    }

    const userScope = scopeOf(userId);
    const code = decodeURIComponent((req.params.code || "").trim());
    if (!code) {
      res.status(400).json({ status: "error", error: "Missing code" });
      return;
    }

    const userItem = await prisma.masterItem
      .findUnique({ where: { scope_code_unique: { scope: userScope, code } } })
      .catch(() => null);

    if (userItem) {
      await prisma.masterItem.update({
        where: { id: userItem.id },
        data: { isDeleted: true },
      });
      res.status(200).json({
        status: "success",
        message: "Item hidden (deleted) in your scope",
      });
      return;
    }

    const global = await prisma.masterItem.findUnique({
      where: { scope_code_unique: { scope: "GLOBAL", code } },
    });

    if (!global || global.isDeleted) {
      res.status(404).json({ status: "error", error: "Item not found" });
      return;
    }

    await prisma.masterItem.create({
      data: {
        scope: userScope,
        code: global.code,
        name: global.name,
        unit: global.unit,
        price: global.price,
        type: global.type,
        hourlyRate: global.hourlyRate,
        dailyRate: global.dailyRate,
        notes: global.notes,
        isDeleted: true,
      },
    });

    res
      .status(200)
      .json({ status: "success", message: "Item hidden for this user" });
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to delete by code",
      detail: e?.message,
    });
  }
};

/** PATCH /hsp/master/by-code/:code/override/active  { active: boolean } */
export const setMasterOverrideActive = async (
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

    const code = decodeURIComponent(String(req.params.code || "").trim());
    const active = !!req.body?.active;
    if (!code) {
      res.status(400).json({ status: "error", error: "Missing code" });
      return;
    }

    let u = await prisma.masterItem
      .findUnique({ where: { scope_code_unique: { scope, code } } })
      .catch(() => null);

    if (!u) {
      const g = await prisma.masterItem.findUnique({
        where: { scope_code_unique: { scope: "GLOBAL", code } },
      });
      if (!g || g.isDeleted) {
        res
          .status(404)
          .json({ status: "error", error: "Master item not found" });
        return;
      }

      await prisma.masterItem.create({
        data: {
          scope,
          code: g.code,
          name: g.name,
          unit: g.unit,
          price: g.price,
          type: g.type,
          hourlyRate: g.hourlyRate,
          dailyRate: g.dailyRate,
          notes: g.notes ?? null,
          isDeleted: false,
          isDisabled: !active,
        },
      });
    } else {
      await prisma.masterItem.update({
        where: { id: u.id },
        data: { isDisabled: !active, isDeleted: false },
      });
    }

    res.status(200).json({ status: "success", data: { code, active } });
    return;
  } catch (e: any) {
    res.status(500).json({
      status: "error",
      error: "Failed to set master override state",
      detail: e?.message,
    });
    return;
  }
};
