// src/controllers/masterImport.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import ExcelJS from "exceljs";
import fs from "fs";
import { scopeOf } from "../lib/_scoping";
import { normalizeRole } from "../lib/authz";
import type { Prisma } from "@prisma/client";

/** ===== Small utils ===== */
const norm = (s: any) => String(s ?? "").trim();
const squash = (s: any) => norm(s).replace(/\s+/g, " ");
const isNumeric = (v?: any) => {
  const s = norm(v);
  if (!s) return false;
  return !isNaN(Number(s));
};
const toNumber = (v: any): number => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
};
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
  const userId: string | undefined =
    anyReq.user?.id || anyReq.userId || undefined;

  let role: Role | undefined;
  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    role = normalizeRole(u?.role);
  }
  return { userId, role };
}

const readFirstWorksheet = async (
  filePath: string
): Promise<ExcelJS.Worksheet> => {
  const workbook = new ExcelJS.Workbook();
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  if (ext === "csv") {
    await workbook.csv.readFile(filePath);
  } else {
    await workbook.xlsx.readFile(filePath);
  }
  return workbook.worksheets[0];
};

const readRowsAsText = (ws: ExcelJS.Worksheet): string[][] => {
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const arr: string[] = [];
    for (let c = 1; c <= (ws.columnCount || 50); c++) {
      const t = (row.getCell(c)?.text ?? "").trim();
      arr.push(t);
    }
    while (arr.length && arr[arr.length - 1] === "") arr.pop();
    rows.push(arr);
  });
  return rows;
};

/** ===== Header detection for MATERIAL ===== */
type MatHeaderIdx = {
  no?: number;
  name?: number;
  unit?: number;
  price?: number;
  notes?: number;
};
const MATERIAL_SYNONYMS = {
  no: ["no", "nomor", "no."],
  name: ["bahan", "material", "nama", "uraian", "deskripsi"],
  unit: ["satuan", "unit", "uom"],
  price: ["harga satuan (rp.)", "harga satuan", "harga", "price", "biaya"],
  notes: ["keterangan", "catatan", "remark", "notes"],
};
function detectMatHeader(rows: string[][]): {
  header: MatHeaderIdx;
  startRow: number;
} {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[:*]/g, "").trim();
  const matchOne = (v: string, list: string[]) => list.some((w) => v === w);

  let best = { score: 0, idx: -1, header: {} as MatHeaderIdx };
  const maxScan = Math.min(rows.length, 30);
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r].map(normalize);
    const header: MatHeaderIdx = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (!v) continue;
      if (header.no === undefined && matchOne(v, MATERIAL_SYNONYMS.no)) {
        header.no = c;
        score++;
        continue;
      }
      if (header.name === undefined && matchOne(v, MATERIAL_SYNONYMS.name)) {
        header.name = c;
        score++;
        continue;
      }
      if (header.unit === undefined && matchOne(v, MATERIAL_SYNONYMS.unit)) {
        header.unit = c;
        score++;
        continue;
      }
      if (header.price === undefined && matchOne(v, MATERIAL_SYNONYMS.price)) {
        header.price = c;
        score++;
        continue;
      }
      if (header.notes === undefined && matchOne(v, MATERIAL_SYNONYMS.notes)) {
        header.notes = c;
        score++;
        continue;
      }
    }
    if (score > best.score) best = { score, idx: r, header };
    if (score >= 4) break;
  }
  if (best.score === 0) {
    best.header = { no: 0, name: 1, unit: 2, price: 3, notes: 4 };
    best.idx = -1;
  }
  return { header: best.header, startRow: best.idx >= 0 ? best.idx + 1 : 0 };
}

type MaterialRow = {
  name: string;
  unit: string;
  price: number;
  notes?: string;
};
function parseMaterials(
  rows: string[][],
  header: MatHeaderIdx,
  startRow: number
): MaterialRow[] {
  const { no = 0, name = 1, unit = 2, price = 3, notes = 4 } = header;
  const out: MaterialRow[] = [];
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    const noV = norm(row[no!]);
    const nameV = squash(row[name!]);
    const unitV = squash(row[unit!]);
    const priceV = toNumber(row[price!]);
    const notesV = norm(row[notes!]);
    if (!nameV || !unitV) continue;
    if (noV && !isNumeric(noV)) continue;
    out.push({
      name: nameV,
      unit: unitV,
      price: priceV,
      notes: notesV || undefined,
    });
  }
  return out;
}

/** ===== Header detection for LABOR ===== */
type LaborHeaderIdx = {
  no?: number;
  name?: number;
  code?: number;
  unit?: number;
  hourly?: number;
  daily?: number;
  notes?: number;
};
const LABOR_SYNONYMS = {
  no: ["no", "nomor", "no."],
  name: ["tenaga kerja", "nama", "jabatan", "pekerja", "uraian"],
  code: ["kode", "code", "kd"],
  unit: ["satuan", "unit", "uom"],
  hourly: ["jam", "per jam", "harga jam", "rate jam"],
  daily: [
    "hari",
    "per hari",
    "oh",
    "harga satuan (rp.) hari",
    "harga hari",
    "rate hari",
  ],
  notes: ["keterangan", "catatan", "remark", "notes"],
};
function detectLaborHeader(rows: string[][]): {
  header: LaborHeaderIdx;
  startRow: number;
} {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[:*]/g, "").trim();
  const matchOne = (v: string, list: string[]) => list.some((w) => v === w);

  let best = { score: 0, idx: -1, header: {} as LaborHeaderIdx };
  const maxScan = Math.min(rows.length, 30);
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r].map(normalize);
    const header: LaborHeaderIdx = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (!v) continue;
      if (header.no === undefined && matchOne(v, LABOR_SYNONYMS.no)) {
        header.no = c;
        score++;
        continue;
      }
      if (header.name === undefined && matchOne(v, LABOR_SYNONYMS.name)) {
        header.name = c;
        score++;
        continue;
      }
      if (header.code === undefined && matchOne(v, LABOR_SYNONYMS.code)) {
        header.code = c;
        score++;
        continue;
      }
      if (header.unit === undefined && matchOne(v, LABOR_SYNONYMS.unit)) {
        header.unit = c;
        score++;
        continue;
      }
      if (header.hourly === undefined && matchOne(v, LABOR_SYNONYMS.hourly)) {
        header.hourly = c;
        score++;
        continue;
      }
      if (header.daily === undefined && matchOne(v, LABOR_SYNONYMS.daily)) {
        header.daily = c;
        score++;
        continue;
      }
      if (header.notes === undefined && matchOne(v, LABOR_SYNONYMS.notes)) {
        header.notes = c;
        score++;
        continue;
      }
    }
    if (score > best.score) best = { score, idx: r, header };
    if (score >= 5) break;
  }
  if (best.score === 0) {
    best.header = {
      no: 0,
      name: 1,
      code: 2,
      unit: 3,
      hourly: 4,
      daily: 5,
      notes: 6,
    };
    best.idx = -1;
  }
  return { header: best.header, startRow: best.idx >= 0 ? best.idx + 1 : 0 };
}

type LaborRow = {
  code: string;
  name: string;
  unit: string;
  hourly?: number;
  daily?: number;
  notes?: string;
};
function parseLabor(
  rows: string[][],
  header: LaborHeaderIdx,
  startRow: number
): LaborRow[] {
  const {
    no = 0,
    name = 1,
    code = 2,
    unit = 3,
    hourly = 4,
    daily = 5,
    notes = 6,
  } = header;
  const out: LaborRow[] = [];
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    const noV = norm(row[no!]);
    const nameV = squash(row[name!]);
    const codeV = norm(row[code!]);
    const unitV = squash(row[unit!]) || "OH";
    const hourlyV =
      row[hourly!] !== undefined ? toNumber(row[hourly!]) : undefined;
    const dailyV =
      row[daily!] !== undefined ? toNumber(row[daily!]) : undefined;
    const notesV = norm(row[notes!]);

    if (!nameV || !codeV) continue;
    if (noV && !isNumeric(noV)) continue;

    out.push({
      code: codeV,
      name: nameV,
      unit: unitV || "OH",
      hourly: hourlyV && hourlyV > 0 ? hourlyV : undefined,
      daily: dailyV && dailyV > 0 ? dailyV : undefined,
      notes: notesV || undefined,
    });
  }
  return out;
}

/** ===== Batching helpers ===== */
const CREATE_BATCH = Number(process.env.IMPORT_CREATE_BATCH || 800);
const UPDATE_BATCH = Number(process.env.IMPORT_UPDATE_BATCH || 120);

async function runInBatches<T>(
  items: T[],
  size: number,
  worker: (slice: T[], idx: number) => Promise<void>
) {
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    await worker(slice, i / size);
  }
}

/** ===== MATERIAL Import ===== */
export const importMasterMaterials = async (req: Request, res: Response) => {
  const useHargaFile =
    String(req.query.useHargaFile ?? "true").toLowerCase() === "true";
  const lockExistingPrice =
    String(req.query.lockExistingPrice ?? "true").toLowerCase() === "true";

  const { userId, role } = await getAuth(req);
  const userScope = scopeOf(userId);
  const allowWriteGlobal = role === "ADMIN";

  if (!req.file) {
    res.status(400).json({
      status: "error",
      error: "No file uploaded. Field name must be 'file'.",
    });
    return;
  }
  const filePath = req.file.path;

  let rows: string[][];
  try {
    const ws = await readFirstWorksheet(filePath);
    rows = readRowsAsText(ws);
  } catch (e: any) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    res.status(400).json({
      status: "error",
      error: "Failed to parse file",
      detail: e?.message,
    });
    return;
  }

  const { header, startRow } = detectMatHeader(rows);
  const parsed = parseMaterials(rows, header, startRow);

  // Summary counters
  let createdGlobal = 0,
    updatedGlobal = 0;
  let createdUser = 0,
    updatedUser = 0,
    updatedUserPrice = 0;
  const errors: Array<{ key?: string; reason: string }> = [];

  // Dedupe by (name||unit)
  const keyOf = (r: MaterialRow) => `${squash(r.name)}||${squash(r.unit)}`;
  const uniq = new Map<string, MaterialRow>();
  for (const r of parsed) uniq.set(keyOf(r), r);
  const uniqueRows = Array.from(uniq.values());

  // Prefetch GLOBAL & USER by name (unit difilter di memori)
  const names = Array.from(new Set(uniqueRows.map((r) => r.name)));
  const [gRows, uRows] = await Promise.all([
    names.length
      ? prisma.masterItem.findMany({
          where: { scope: "GLOBAL", type: "MATERIAL", name: { in: names } },
          select: { id: true, code: true, name: true, unit: true, price: true },
        })
      : Promise.resolve([]),
    names.length
      ? prisma.masterItem.findMany({
          where: { scope: userScope, type: "MATERIAL", name: { in: names } },
          select: { id: true, code: true, name: true, unit: true, price: true },
        })
      : Promise.resolve([]),
  ]);

  const gByKey = new Map<string, (typeof gRows)[number]>(
    gRows.map((r) => [`${squash(r.name)}||${squash(r.unit)}`, r] as const)
  );
  const uByKey = new Map<string, (typeof uRows)[number]>(
    uRows.map((r) => [`${squash(r.name)}||${squash(r.unit)}`, r] as const)
  );

  type UJob = { id: string; data: Prisma.MasterItemUpdateInput };
  const toCreateGlobal: Prisma.MasterItemCreateManyInput[] = [];
  const toUpdateGlobal: UJob[] = [];
  const toCreateUser: Prisma.MasterItemCreateManyInput[] = [];
  const toUpdateUser: UJob[] = [];

  for (const row of uniqueRows) {
    const key = keyOf(row);
    const g = gByKey.get(key);
    const u = uByKey.get(key);

    const desiredPrice = useHargaFile ? row.price : 0;

    if (allowWriteGlobal) {
      if (g) {
        const data: Prisma.MasterItemUpdateInput = {
          name: row.name,
          unit: row.unit,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        };
        if (useHargaFile && (!lockExistingPrice || (g.price ?? 0) === 0)) {
          (data as any).price = desiredPrice;
        }
        toUpdateGlobal.push({ id: g.id, data });
      } else {
        toCreateGlobal.push({
          scope: "GLOBAL",
          type: "MATERIAL",
          code: autoCode("MATERIAL"),
          name: row.name,
          unit: row.unit,
          price: desiredPrice,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        });
      }
      continue;
    }

    // USER
    if (g) {
      if (u && u.code === g.code) {
        const data: Prisma.MasterItemUpdateInput = {
          name: row.name,
          unit: row.unit,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        };
        const shouldSetPrice =
          useHargaFile &&
          (!lockExistingPrice || (u.price ?? 0) === 0) &&
          (u.price ?? 0) !== desiredPrice;
        if (shouldSetPrice) {
          (data as any).price = desiredPrice;
          updatedUserPrice += 1;
        }
        toUpdateUser.push({ id: u.id, data });
      } else {
        toCreateUser.push({
          scope: userScope,
          type: "MATERIAL",
          code: g?.code ?? autoCode("MATERIAL"),
          name: row.name,
          unit: row.unit,
          price: desiredPrice,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        });
      }
    } else {
      if (u) {
        const data: Prisma.MasterItemUpdateInput = {
          name: row.name,
          unit: row.unit,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        };
        const shouldSetPrice =
          useHargaFile &&
          (!lockExistingPrice || (u.price ?? 0) === 0) &&
          (u.price ?? 0) !== desiredPrice;
        if (shouldSetPrice) {
          (data as any).price = desiredPrice;
          updatedUserPrice += 1;
        }
        toUpdateUser.push({ id: u.id, data });
      } else {
        toCreateUser.push({
          scope: userScope,
          type: "MATERIAL",
          code: autoCode("MATERIAL"),
          name: row.name,
          unit: row.unit,
          price: desiredPrice,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        });
      }
    }
  }

  // === INSERT createMany (chunk)
  await runInBatches(toCreateGlobal, CREATE_BATCH, async (slice) => {
    if (!slice.length) return;
    const r = await prisma.masterItem.createMany({
      data: slice,
      skipDuplicates: true,
    });
    createdGlobal += r.count;
  });
  await runInBatches(toCreateUser, CREATE_BATCH, async (slice) => {
    if (!slice.length) return;
    const r = await prisma.masterItem.createMany({
      data: slice,
      skipDuplicates: true,
    });
    createdUser += r.count;
  });

  // === UPDATE via interactive transaction (chunk) — opsi timeout/maxWait valid di sini
  await runInBatches(toUpdateGlobal, UPDATE_BATCH, async (slice) => {
    if (!slice.length) return;
    await prisma.$transaction(
      async (tx) => {
        // penting: jangan Promise.all di interactive txn
        for (const u of slice) {
          await tx.masterItem.update({ where: { id: u.id }, data: u.data });
        }
      },
      { timeout: 60000, maxWait: 60000 }
    );
    updatedGlobal += slice.length;
  });
  await runInBatches(toUpdateUser, UPDATE_BATCH, async (slice) => {
    if (!slice.length) return;
    await prisma.$transaction(
      async (tx) => {
        for (const u of slice) {
          await tx.masterItem.update({ where: { id: u.id }, data: u.data });
        }
      },
      { timeout: 60000, maxWait: 60000 }
    );
    updatedUser += slice.length;
  });

  try {
    fs.unlinkSync(filePath);
  } catch {}

  res.status(200).json({
    status: "success",
    message: "Import MATERIAL finished",
    summary: {
      options: { useHargaFile, lockExistingPrice },
      counts: {
        created_global: createdGlobal,
        updated_global: updatedGlobal,
        created_user: createdUser,
        updated_user: updatedUser,
        updated_user_price: updatedUserPrice,
      },
      errors,
    },
  });
};

/** ===== LABOR Import ===== */
/** ===== LABOR Import (with duplicate-code expansion) ===== */
export const importMasterLabor = async (req: Request, res: Response) => {
  const useHargaFile =
    String(req.query.useHargaFile ?? "true").toLowerCase() === "true";
  const lockExistingPrice =
    String(req.query.lockExistingPrice ?? "true").toLowerCase() === "true";
  const preferDaily =
    String(req.query.preferDaily ?? "true").toLowerCase() === "true";

  // strategi: 'expand' (default) = buat kode unik utk duplikat
  //           'strict'           = perilaku lama (kode sbg kunci; duplikat mengupdate record yang sama)
  const codeStrategyRaw = String(
    req.query.codeStrategy ?? "expand"
  ).toLowerCase();
  const codeStrategy: "expand" | "strict" =
    codeStrategyRaw === "strict" ? "strict" : "expand";

  const { userId, role } = await getAuth(req);
  const userScope = scopeOf(userId);
  const allowWriteGlobal = role === "ADMIN";

  if (!req.file) {
    res.status(400).json({
      status: "error",
      error: "No file uploaded. Field name must be 'file'.",
    });
    return;
  }
  const filePath = req.file.path;

  let rows: string[][];
  try {
    const ws = await readFirstWorksheet(filePath);
    rows = readRowsAsText(ws);
  } catch (e: any) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    res.status(400).json({
      status: "error",
      error: "Failed to parse file",
      detail: e?.message,
    });
    return;
  }

  const { header, startRow } = detectLaborHeader(rows);
  const parsed = parseLabor(rows, header, startRow);

  // ==== Group by code utk deteksi duplikasi
  const groups = new Map<string, LaborRow[]>();
  for (const r of parsed) {
    if (!groups.has(r.code)) groups.set(r.code, []);
    groups.get(r.code)!.push(r);
  }
  const incomingRows = parsed.length;
  const uniqueCodes = groups.size;
  const duplicatesDetected = Array.from(groups.values()).reduce(
    (acc, arr) => acc + Math.max(0, arr.length - 1),
    0
  );

  // Summary counters
  let createdGlobal = 0,
    updatedGlobal = 0;
  let createdUser = 0,
    updatedUser = 0,
    updatedUserPrice = 0;

  // Fetch existing by *all unique codes* (basis)
  const codeSet = Array.from(groups.keys());
  const [gRows, uRows] = await Promise.all([
    codeSet.length
      ? prisma.masterItem.findMany({
          where: { scope: "GLOBAL", type: "LABOR", code: { in: codeSet } },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            price: true,
            hourlyRate: true,
            dailyRate: true,
          },
        })
      : Promise.resolve([]),
    codeSet.length
      ? prisma.masterItem.findMany({
          where: { scope: userScope, type: "LABOR", code: { in: codeSet } },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            price: true,
            hourlyRate: true,
            dailyRate: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const gByCode = new Map<string, (typeof gRows)[number]>(
    gRows.map((r) => [r.code, r])
  );
  const uByCode = new Map<string, (typeof uRows)[number]>(
    uRows.map((r) => [r.code, r])
  );

  // Set seluruh kode yang SUDAH dipakai (DB + rencana create) untuk generator kode unik
  const usedCodes = new Set<string>([
    ...gRows.map((r) => r.code),
    ...uRows.map((r) => r.code),
  ]);
  const nextUniqueCode = (base: string) => {
    // jika base belum dipakai, pakai base
    if (!usedCodes.has(base)) {
      usedCodes.add(base);
      return base;
    }
    // tambahkan -02, -03, ...
    let n = 2;
    while (true) {
      const cand = `${base}-${String(n).padStart(2, "0")}`;
      if (!usedCodes.has(cand)) {
        usedCodes.add(cand);
        return cand;
      }
      n++;
      // guard
      if (n > 9999)
        throw new Error(`Failed to generate unique code for base ${base}`);
    }
  };

  type UJob = { id: string; data: Prisma.MasterItemUpdateInput };
  const toCreateGlobal: Prisma.MasterItemCreateManyInput[] = [];
  const toUpdateGlobal: UJob[] = [];
  const toCreateUser: Prisma.MasterItemCreateManyInput[] = [];
  const toUpdateUser: UJob[] = [];

  let createdFromDuplicatesGlobal = 0;
  let createdFromDuplicatesUser = 0;

  // === proses per kelompok kode
  for (const [baseCode, arr] of groups) {
    if (arr.length === 0) continue;

    // hitung price incoming
    const computeIncomingPrice = (row: LaborRow) => {
      const hourly = row.hourly ?? null;
      const daily = row.daily ?? null;
      if (!useHargaFile) return 0;
      if (preferDaily && daily) return daily;
      if (!preferDaily && hourly) return hourly;
      return daily || hourly || 0;
    };

    // ---- Baris pertama: pakai baseCode
    const first = arr[0];
    const incomingPriceFirst = computeIncomingPrice(first);
    const g = gByCode.get(baseCode);
    const u = uByCode.get(baseCode);

    if (allowWriteGlobal) {
      if (g) {
        const data: Prisma.MasterItemUpdateInput = {
          name: first.name,
          unit: first.unit || "OH",
          hourlyRate: first.hourly ?? null,
          dailyRate: first.daily ?? null,
          notes: first.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        };
        if (useHargaFile && (!lockExistingPrice || (g.price ?? 0) === 0)) {
          (data as any).price = incomingPriceFirst;
        } else if ((g.price ?? 0) === 0) {
          (data as any).price = incomingPriceFirst;
        }
        toUpdateGlobal.push({ id: g.id, data });
      } else {
        const code = nextUniqueCode(baseCode); // biasanya baseCode bebas, ini sekadar menandai terpakai
        toCreateGlobal.push({
          scope: "GLOBAL",
          type: "LABOR",
          code,
          name: first.name,
          unit: first.unit || "OH",
          hourlyRate: first.hourly ?? undefined,
          dailyRate: first.daily ?? undefined,
          price: incomingPriceFirst,
          notes: first.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        } as Prisma.MasterItemCreateManyInput);
      }
    } else {
      if (u) {
        const data: Prisma.MasterItemUpdateInput = {
          name: first.name,
          unit: first.unit || "OH",
          hourlyRate: first.hourly ?? null,
          dailyRate: first.daily ?? null,
          notes: first.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        };
        const shouldSetPrice =
          (useHargaFile &&
            (!lockExistingPrice || (u.price ?? 0) === 0) &&
            (u.price ?? 0) !== incomingPriceFirst) ||
          (!useHargaFile && (u.price ?? 0) === 0 && incomingPriceFirst !== 0);
        if (shouldSetPrice) {
          (data as any).price = incomingPriceFirst;
          updatedUserPrice += 1;
        }
        toUpdateUser.push({ id: u.id, data });
      } else {
        const code = nextUniqueCode(baseCode);
        toCreateUser.push({
          scope: userScope,
          type: "LABOR",
          code,
          name: first.name,
          unit: first.unit || "OH",
          hourlyRate: first.hourly ?? undefined,
          dailyRate: first.daily ?? undefined,
          price: incomingPriceFirst,
          notes: first.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        } as Prisma.MasterItemCreateManyInput);
      }
    }

    // ---- Baris duplikat: expand atau strict
    for (let i = 1; i < arr.length; i++) {
      const row = arr[i];
      const incomingPrice = computeIncomingPrice(row);

      if (codeStrategy === "strict") {
        // Perilaku lama: update record yg sama (GLOBAL/User)
        if (allowWriteGlobal) {
          const gg = gByCode.get(baseCode);
          if (!gg) continue;
          const data: Prisma.MasterItemUpdateInput = {
            name: row.name,
            unit: row.unit || "OH",
            hourlyRate: row.hourly ?? null,
            dailyRate: row.daily ?? null,
            notes: row.notes ?? null,
            isDeleted: false,
            isDisabled: false,
          };
          if (useHargaFile && (!lockExistingPrice || (gg.price ?? 0) === 0)) {
            (data as any).price = incomingPrice;
          } else if ((gg.price ?? 0) === 0) {
            (data as any).price = incomingPrice;
          }
          toUpdateGlobal.push({ id: gg.id, data });
        } else {
          const uu = uByCode.get(baseCode);
          if (!uu) continue;
          const data: Prisma.MasterItemUpdateInput = {
            name: row.name,
            unit: row.unit || "OH",
            hourlyRate: row.hourly ?? null,
            dailyRate: row.daily ?? null,
            notes: row.notes ?? null,
            isDeleted: false,
            isDisabled: false,
          };
          const shouldSetPrice =
            (useHargaFile &&
              (!lockExistingPrice || (uu.price ?? 0) === 0) &&
              (uu.price ?? 0) !== incomingPrice) ||
            (!useHargaFile && (uu.price ?? 0) === 0 && incomingPrice !== 0);
          if (shouldSetPrice) {
            (data as any).price = incomingPrice;
            updatedUserPrice += 1;
          }
          toUpdateUser.push({ id: uu.id, data });
        }
        continue;
      }

      // === EXPAND: buat kode baru unik utk tiap duplikat
      const newCode = nextUniqueCode(baseCode);
      if (allowWriteGlobal) {
        toCreateGlobal.push({
          scope: "GLOBAL",
          type: "LABOR",
          code: newCode,
          name: row.name,
          unit: row.unit || "OH",
          hourlyRate: row.hourly ?? undefined,
          dailyRate: row.daily ?? undefined,
          price: incomingPrice,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        } as Prisma.MasterItemCreateManyInput);
        createdFromDuplicatesGlobal += 1;
      } else {
        toCreateUser.push({
          scope: userScope,
          type: "LABOR",
          code: newCode,
          name: row.name,
          unit: row.unit || "OH",
          hourlyRate: row.hourly ?? undefined,
          dailyRate: row.daily ?? undefined,
          price: incomingPrice,
          notes: row.notes ?? null,
          isDeleted: false,
          isDisabled: false,
        } as Prisma.MasterItemCreateManyInput);
        createdFromDuplicatesUser += 1;
      }
    }
  }

  // === EXECUTE: createMany (batched)
  await runInBatches(toCreateGlobal, CREATE_BATCH, async (slice) => {
    if (!slice.length) return;
    const r = await prisma.masterItem.createMany({
      data: slice,
      skipDuplicates: true,
    });
    createdGlobal += r.count;
  });
  await runInBatches(toCreateUser, CREATE_BATCH, async (slice) => {
    if (!slice.length) return;
    const r = await prisma.masterItem.createMany({
      data: slice,
      skipDuplicates: true,
    });
    createdUser += r.count;
  });

  // === EXECUTE: updates (interactive transaction, batched)
  await runInBatches(toUpdateGlobal, UPDATE_BATCH, async (slice) => {
    if (!slice.length) return;
    await prisma.$transaction(
      async (tx) => {
        for (const u of slice) {
          await tx.masterItem.update({ where: { id: u.id }, data: u.data });
        }
      },
      { timeout: 60000, maxWait: 60000 }
    );
    updatedGlobal += slice.length;
  });
  await runInBatches(toUpdateUser, UPDATE_BATCH, async (slice) => {
    if (!slice.length) return;
    await prisma.$transaction(
      async (tx) => {
        for (const u of slice) {
          await tx.masterItem.update({ where: { id: u.id }, data: u.data });
        }
      },
      { timeout: 60000, maxWait: 60000 }
    );
    updatedUser += slice.length;
  });

  try {
    fs.unlinkSync(filePath);
  } catch {}

  res.status(200).json({
    status: "success",
    message: "Import LABOR finished",
    summary: {
      options: { useHargaFile, preferDaily, lockExistingPrice, codeStrategy },
      counts: {
        created_global: createdGlobal,
        updated_global: updatedGlobal,
        created_user: createdUser,
        updated_user: updatedUser,
        updated_user_price: updatedUserPrice,
        created_from_duplicates_global: createdFromDuplicatesGlobal,
        created_from_duplicates_user: createdFromDuplicatesUser,
      },
      meta: {
        incoming_rows: incomingRows,
        unique_codes: uniqueCodes,
        duplicates_detected: duplicatesDetected,
      },
      errors: [],
    },
  });
};
