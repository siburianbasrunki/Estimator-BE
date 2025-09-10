// src/controllers/hspImport.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import ExcelJS from "exceljs";
import fs from "fs";
import { scopeOf } from "../lib/_scoping";
import type { Prisma } from "@prisma/client";
import { normalizeRole } from "../lib/authz";

export interface AuthenticatedRequest extends Request {
  userId?: string; // fallback kalau middleware lama
  userRole?: string; // fallback kalau middleware lama
}

type ParsedRow =
  | { kind: "category"; name: string }
  | {
      kind: "item";
      kode: string;
      deskripsi: string;
      satuan: string;
      harga: number;
    };

/** ===== Utils (string & number) ===== */
const norm = (s: any) => String(s ?? "").trim();

const isNumeric = (v?: any) => {
  const s = norm(v);
  if (s === "") return false;
  return !isNaN(Number(s));
};

const toNumber = (v: any): number => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
};

/** Pola Kode item umum: A.1.1.1.1 atau 1.2.3.4, dll (≥3 titik total segmen ≥4) */
const looksLikeKodeItem = (kode: string) => {
  const k = norm(kode);
  if (!k) return false;
  const dotCount = (k.match(/\./g) || []).length;
  return dotCount >= 3;
};

/** Kategori: No kosong + (Jenis mengandung HARGA SATUAN atau Kode bukan item) */
const looksLikeCategory = (
  no: string,
  kode: string,
  jenis: string
): boolean => {
  if (isNumeric(no)) return false;
  if (!norm(kode) || !norm(jenis)) return false;
  if (/^HARGA\s+SATUAN/i.test(jenis)) return true;
  const dotCount = (kode.match(/\./g) || []).length;
  const isItemCode = looksLikeKodeItem(kode);
  return dotCount >= 2 && !isItemCode;
};

/** ===== Baca worksheet & deteksi header dinamis ===== */
type HeaderIdx = {
  no?: number;
  kode?: number;
  jenis?: number;
  satuan?: number;
  harga?: number;
};

const headerSynonyms = {
  no: ["no", "nomor", "no."],
  kode: ["kode", "code", "kd"],
  jenis: [
    "jenis pekerjaan",
    "uraian pekerjaan",
    "uraian",
    "deskripsi",
    "pekerjaan",
  ],
  satuan: ["satuan", "unit", "uom"],
  harga: ["harga", "harga satuan", "price", "biaya"],
};

const readWorksheetAsText = async (
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

const detectHeader = (
  ws: ExcelJS.Worksheet
): { header: HeaderIdx; rows: string[][] } => {
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const arr: string[] = [];
    for (let c = 1; c <= (ws.columnCount || 50); c++) {
      const cell = row.getCell(c);
      const t = (cell?.text ?? "").trim();
      arr.push(t);
    }
    while (arr.length && arr[arr.length - 1] === "") arr.pop();
    rows.push(arr);
  });

  let best: { score: number; idx: number; header: HeaderIdx } = {
    score: 0,
    idx: -1,
    header: {},
  };

  const matchToken = (text: string, list: string[]) =>
    list.some((w) => text.toLowerCase() === w);
  const normalizeCell = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[:*]/g, "").trim();

  const maxScan = Math.min(rows.length, 30);
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r].map(normalizeCell);
    const header: HeaderIdx = {};
    let score = 0;

    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (!val) continue;
      if (header.no === undefined && matchToken(val, headerSynonyms.no)) {
        header.no = c;
        score++;
        continue;
      }
      if (header.kode === undefined && matchToken(val, headerSynonyms.kode)) {
        header.kode = c;
        score++;
        continue;
      }
      if (header.jenis === undefined && matchToken(val, headerSynonyms.jenis)) {
        header.jenis = c;
        score++;
        continue;
      }
      if (
        header.satuan === undefined &&
        matchToken(val, headerSynonyms.satuan)
      ) {
        header.satuan = c;
        score++;
        continue;
      }
      if (header.harga === undefined && matchToken(val, headerSynonyms.harga)) {
        header.harga = c;
        score++;
        continue;
      }
    }

    if (score > best.score) best = { score, idx: r, header };
    if (score >= 4) break;
  }

  if (best.score === 0) {
    best.header = { no: 0, kode: 1, jenis: 2, satuan: 3, harga: 4 };
    best.idx = -1;
  }

  return { header: best.header, rows };
};

const parseRows = (rows: string[][], header: HeaderIdx): ParsedRow[] => {
  const parsed: ParsedRow[] = [];
  const { no = 0, kode = 1, jenis = 2, satuan = 3, harga = 4 } = header;

  const normalize = (v?: string) => norm(v).replace(/\s+/g, " ");

  for (const r of rows) {
    const noV = normalize(r[no!]);
    const kodeV = normalize(r[kode!]);
    const jenisV = normalize(r[jenis!]);
    const satuanV = normalize(r[satuan!]);
    const hargaV = normalize(r[harga!]);
    const hargaNum = toNumber(hargaV);

    // (skip duplikat header & baris kosong) – biarkan sama seperti punyamu

    // kategori?
    if (looksLikeCategory(noV, kodeV, jenisV)) {
      parsed.push({ kind: "category", name: jenisV });
      continue;
    }

    // >>> PATCH: item boleh harga 0 <<<
    if (looksLikeKodeItem(kodeV) && jenisV) {
      parsed.push({
        kind: "item",
        kode: kodeV,
        deskripsi: jenisV,
        satuan: satuanV || "",
        harga: hargaNum, // nanti akan di-zero-kan kalau useHargaFile=false
      });
      continue;
    }

    // fallback: baris “No” numeric
    if (isNumeric(noV) && kodeV && jenisV) {
      parsed.push({
        kind: "item",
        kode: kodeV,
        deskripsi: jenisV,
        satuan: satuanV || "",
        harga: hargaNum,
      });
      continue;
    }
  }
  return parsed;
};

/** ===== Helpers untuk scope & seeding ===== */
type Role = "ADMIN" | "USER";

async function getRoleFromReq(req: Request): Promise<Role | undefined> {
  const anyReq = req as any;
  // gabung semua kemungkinan sumber role lalu normalisasi
  const role =
    normalizeRole(anyReq.user?.role) || normalizeRole(anyReq.userRole); // legacy field
  if (role) return role;

  const uid = anyReq.user?.id || anyReq.userId;
  if (uid) {
    const row = await prisma.user.findUnique({
      where: { id: uid },
      select: { role: true },
    });
    return normalizeRole(row?.role);
  }
  return undefined;
}

function userScopeOf(req: Request) {
  const uid = (req as any).user?.id || (req as any).userId;
  return scopeOf(uid);
}

async function isSeedingMode(req: Request): Promise<boolean> {
  const seed = String(
    (req.query.seed ?? (req as any).body?.seed) || ""
  ).toLowerCase();
  if (seed === "1" || seed === "true") return true;
  const [cats, items] = await Promise.all([
    prisma.hSPCategory.count({ where: { scope: "GLOBAL" } }),
    prisma.hSPItem.count({ where: { scope: "GLOBAL" } }),
  ]);
  return cats === 0 && items === 0;
}

async function ensureCategoryId(
  tx: Prisma.TransactionClient,
  name: string,
  targetScope: string
): Promise<string> {
  const existing = await tx.hSPCategory.findFirst({
    where: { scope: targetScope, name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.hSPCategory.create({
    data: { scope: targetScope, name },
    select: { id: true },
  });
  return created.id;
}

/** util: jalankan pekerjaan per-chunk agar stabil di DB (opsional dipakai) */
// const runInChunks = async <T>(
//   arr: T[],
//   size: number,
//   worker: (x: T) => Promise<any>
// ) => {
//   for (let i = 0; i < arr.length; i += size) {
//     const slice = arr.slice(i, i + size);
//     await Promise.all(slice.map(worker));
//   }
// };

async function getAuth(
  req: Request
): Promise<{ userId?: string; role?: Role }> {
  const anyReq = req as any;

  // Selalu pakai id dari middleware
  const userId: string | undefined =
    anyReq.user?.id || anyReq.userId || undefined;

  // >>> PENTING: Abaikan role di token. Selalu baca dari DB.
  let role: Role | undefined = undefined;
  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    // normalizeRole: pastikan hasilnya "ADMIN" | "USER"
    role = normalizeRole(u?.role);
  }

  return { userId, role };
}

/** ===== Controller ===== */
export const importHSP = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  // === Options ===
  const useHargaFile =
    String(req.query.useHargaFile || "false").toLowerCase() === "true";
  const lockExistingPrice =
    String(req.query.lockExistingPrice || "true").toLowerCase() === "true";

  // === Auth/Scope ===
  const { userId, role } = await getAuth(req as any);
  const userScope = scopeOf(userId);
  // ADMIN saja yang boleh tulis GLOBAL
  const allowWriteGlobal = role === "ADMIN";
  // === Validate file ===
  if (!req.file) {
    res.status(400).json({
      status: "error",
      error: "No file uploaded. Field name must be 'file'.",
    });
    return;
  }
  const filePath = req.file.path;

  let ws: ExcelJS.Worksheet;
  try {
    ws = await readWorksheetAsText(filePath);
  } catch (e: any) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    res.status(400).json({
      status: "error",
      error: "Failed to parse file. Make sure it's a valid .xlsx/.csv.",
      detail: e?.message,
    });
    return;
  }

  // === Parse ===
  const { header, rows } = detectHeader(ws);
  const parsed = parseRows(rows, header);

  // === Group by category ===
  const byCategory = new Map<
    string,
    Array<{ kode: string; deskripsi: string; satuan: string; harga: number }>
  >();
  let currentCategory: string | null = null;

  for (const row of parsed) {
    if (row.kind === "category") {
      currentCategory = row.name;
      if (!byCategory.has(currentCategory)) byCategory.set(currentCategory, []);
    } else {
      if (!currentCategory) {
        currentCategory = "UNCATEGORIZED";
        if (!byCategory.has(currentCategory))
          byCategory.set(currentCategory, []);
      }
      byCategory.get(currentCategory)!.push({
        kode: row.kode,
        deskripsi: row.deskripsi,
        satuan: row.satuan,
        harga: row.harga,
      });
    }
  }

  // === Dedupe per-kode dengan simpan nama kategori asal ===
  const dedupedByKode = new Map<
    string,
    {
      kode: string;
      deskripsi: string;
      satuan: string;
      harga: number;
      categoryName: string;
    }
  >();

  for (const [catName, items] of byCategory.entries()) {
    for (const it of items) {
      const kode = (it.kode || "").trim();
      const deskripsi = (it.deskripsi || "").trim();
      if (!kode) continue;
      if (!deskripsi) continue;

      dedupedByKode.set(kode, {
        kode,
        deskripsi,
        satuan: it.satuan || "",
        harga: useHargaFile ? (it.harga ?? 0) : 0,
        categoryName: catName,
      });
    }
  }

  const uniqueItems = Array.from(dedupedByKode.values());
  const allCodes = uniqueItems.map((u) => u.kode);
  const allCatNames = Array.from(byCategory.keys());

  // === Counters & debug ===
  let createdCategoriesGlobal = 0;
  let createdCategoriesUser = 0;
  let createdItemsGlobal = 0;
  let createdItemsUser = 0;
  let updatedItemsUser = 0;
  let updatedPriceUser = 0;
  const errors: Array<{ kode?: string; reason: string }> = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        // ==== Prefetch existing GLOBAL & USER (by kode) ====
        const [gItems, uItems] = await Promise.all([
          allCodes.length
            ? tx.hSPItem.findMany({
                where: { scope: "GLOBAL", kode: { in: allCodes } },
                select: {
                  id: true,
                  kode: true,
                  harga: true,
                  hspCategoryId: true,
                },
              })
            : Promise.resolve([]),
          allCodes.length
            ? tx.hSPItem.findMany({
                where: { scope: userScope, kode: { in: allCodes } },
                select: {
                  id: true,
                  kode: true,
                  harga: true,
                  hspCategoryId: true,
                },
              })
            : Promise.resolve([]),
        ]);

        const gItemByKode = new Map(gItems.map((r) => [r.kode, r]));
        const uItemByKode = new Map(uItems.map((r) => [r.kode, r]));

        // Tentukan kategori mana yang perlu ada di GLOBAL (untuk item baru yang akan dibuat di GLOBAL)
        const globalCatNamesNeeded = new Set<string>();
        // Dan kategori mana yang perlu di scope USER (hanya jika benar2 butuh; normal user mengimpor kode baru)
        const userCatNamesNeeded = new Set<string>();

        for (const it of uniqueItems) {
          const existsInGlobal = gItemByKode.has(it.kode);
          const shouldGoGlobal = role === "ADMIN" && !existsInGlobal; // ADMIN + kode baru => GLOBAL
          if (shouldGoGlobal) {
            globalCatNamesNeeded.add(it.categoryName);
          } else if (!existsInGlobal && role !== "ADMIN") {
            // user biasa mengimpor kode baru -> perlu kategori user
            userCatNamesNeeded.add(it.categoryName);
          }
        }

        // ==== Upsert KATEGORI GLOBAL yang diperlukan ====
        const gCatMap = new Map<string, string>();
        if (allowWriteGlobal) {
          if (allCatNames.length) {
            const existed = await tx.hSPCategory.findMany({
              where: { scope: "GLOBAL", name: { in: allCatNames } },
              select: { id: true, name: true },
            });
            existed.forEach((c) => gCatMap.set(c.name, c.id));
            const toCreate = allCatNames.filter((n) => !gCatMap.has(n));
            if (toCreate.length) {
              const created = await Promise.all(
                toCreate.map((name) =>
                  tx.hSPCategory.create({ data: { scope: "GLOBAL", name } })
                )
              );
              created.forEach((c) => gCatMap.set(c.name, c.id));
              createdCategoriesGlobal += created.length;
            }
          }
        }

        // ==== Upsert KATEGORI USER yang diperlukan (kasus user biasa impor kode baru saja) ====
        const uCatMap = new Map<string, string>(); // name -> id
        if (userCatNamesNeeded.size) {
          const names = Array.from(userCatNamesNeeded);
          const existed = await tx.hSPCategory.findMany({
            where: { scope: userScope, name: { in: names } },
            select: { id: true, name: true },
          });
          existed.forEach((c) => uCatMap.set(c.name, c.id));
          const toCreate = names.filter((n) => !uCatMap.has(n));
          if (toCreate.length) {
            const created = await Promise.all(
              toCreate.map((name) =>
                tx.hSPCategory.create({ data: { scope: userScope, name } })
              )
            );
            created.forEach((c) => uCatMap.set(c.name, c.id));
            createdCategoriesUser += created.length;
          }
        }

        // ==== CREATE/UPDATE ITEMS ====
        // src/controllers/hspImport.controller.ts (di dalam transaksi)

        for (const it of uniqueItems) {
          const g = gItemByKode.get(it.kode);
          const u = uItemByKode.get(it.kode);

          // ADMIN + belum ada di GLOBAL => buat di GLOBAL (harga 0)
          if (allowWriteGlobal && !g) {
            const catIdGlobal = gCatMap.get(it.categoryName);
            if (!catIdGlobal) {
              errors.push({
                kode: it.kode,
                reason: `Missing global category for "${it.categoryName}"`,
              });
              continue;
            }
            await tx.hSPItem.create({
              data: {
                scope: "GLOBAL",
                kode: it.kode,
                deskripsi: it.deskripsi,
                satuan: it.satuan,
                harga: 0, // requirement harga default 0
                hspCategoryId: catIdGlobal,
                isDeleted: false,
                isDisabled: false,
              },
            });
            createdItemsGlobal += 1;
            continue;
          }

          if (g) {
            if (allowWriteGlobal) {
              // ADMIN: update GLOBAL saja, jangan bikin override user
              await tx.hSPItem.update({
                where: { id: g.id },
                data: {
                  deskripsi: it.deskripsi,
                  satuan: it.satuan,
                  ...(useHargaFile ? { harga: it.harga } : {}), // by default tidak ubah harga
                  isDeleted: false,
                  isDisabled: false,
                },
              });
              continue;
            }

            // BUKAN ADMIN: tulis override user (kategori refer ke GLOBAL id)
            const catId = g.hspCategoryId;
            if (u) {
              const shouldUpdateHarga =
                useHargaFile && (!lockExistingPrice || (u.harga ?? 0) === 0);
              const data: any = {
                deskripsi: it.deskripsi,
                satuan: it.satuan,
                hspCategoryId: catId,
                isDeleted: false,
                isDisabled: false,
              };
              if (shouldUpdateHarga && (u.harga ?? 0) !== it.harga) {
                data.harga = it.harga;
                updatedPriceUser += 1;
              }
              await tx.hSPItem.update({ where: { id: u.id }, data });
              updatedItemsUser += 1;
            } else {
              await tx.hSPItem.create({
                data: {
                  scope: userScope,
                  kode: it.kode,
                  deskripsi: it.deskripsi,
                  satuan: it.satuan,
                  harga: useHargaFile ? it.harga : 0,
                  hspCategoryId: catId,
                  isDeleted: false,
                  isDisabled: false,
                },
              });
              createdItemsUser += 1;
            }
            continue;
          }

          // Tidak ada GLOBAL (g tidak ada)
          if (!allowWriteGlobal) {
            // user biasa: buat di scope user dengan kategori user
            const catIdUser = uCatMap.get(it.categoryName);
            if (!catIdUser) {
              errors.push({
                kode: it.kode,
                reason: `Missing user category for "${it.categoryName}"`,
              });
              continue;
            }
            if (u) {
              const shouldUpdateHarga =
                useHargaFile && (!lockExistingPrice || (u.harga ?? 0) === 0);
              const data: any = {
                deskripsi: it.deskripsi,
                satuan: it.satuan,
                hspCategoryId: catIdUser,
                isDeleted: false,
                isDisabled: false,
              };
              if (shouldUpdateHarga && (u.harga ?? 0) !== it.harga) {
                data.harga = it.harga;
                updatedPriceUser += 1;
              }
              await tx.hSPItem.update({ where: { id: u.id }, data });
              updatedItemsUser += 1;
            } else {
              await tx.hSPItem.create({
                data: {
                  scope: userScope,
                  kode: it.kode,
                  deskripsi: it.deskripsi,
                  satuan: it.satuan,
                  harga: useHargaFile ? it.harga : 0,
                  hspCategoryId: catIdUser,
                  isDeleted: false,
                  isDisabled: false,
                },
              });
              createdItemsUser += 1;
            }
          }
        }
      },
      { timeout: 60000, maxWait: 60000 }
    );
  } catch (e: any) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    res.status(500).json({
      status: "error",
      error: "Database transaction failed",
      detail: e?.message,
    });
    return;
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }

  res.status(200).json({
    status: "success",
    message: "Import finished",
    summary: {
      options: { useHargaFile, lockExistingPrice },
      categories: {
        total: byCategory.size,
        created_global: createdCategoriesGlobal,
        created_user: createdCategoriesUser,
      },
      items: {
        created_global: createdItemsGlobal,
        created_user: createdItemsUser,
        updated_user: updatedItemsUser,
        updated_user_price: updatedPriceUser,
      },
      errors,
      _debug: {
        role,
        scopeUser: userScope,
        detectedHeader: header,
        parsedRows: parsed.length,
      },
    },
  });
};
