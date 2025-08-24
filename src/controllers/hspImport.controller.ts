// src/controllers/hspImport.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import ExcelJS from "exceljs";
import fs from "fs";
import { scopeOf } from "../lib/_scoping";

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

/** ===== Utils ===== */
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

    // skip baris header kedua/duplikat deteksi
    if (
      ["no", "nomor", "no."].includes(noV.toLowerCase()) ||
      ["kode", "code", "kd"].includes(kodeV.toLowerCase()) ||
      [
        "jenis pekerjaan",
        "uraian pekerjaan",
        "uraian",
        "deskripsi",
        "pekerjaan",
      ].includes(jenisV.toLowerCase()) ||
      ["satuan", "unit", "uom"].includes(satuanV.toLowerCase()) ||
      ["harga", "harga satuan", "price", "biaya"].includes(hargaV.toLowerCase())
    )
      continue;

    // skip baris kosong total
    if (![noV, kodeV, jenisV, satuanV, hargaV].some(Boolean)) continue;

    // kategori?
    if (looksLikeCategory(noV, kodeV, jenisV)) {
      parsed.push({ kind: "category", name: jenisV });
      continue;
    }

    // item?
    const hargaNum = toNumber(hargaV);
    if (
      (isNumeric(noV) && kodeV && jenisV) ||
      (looksLikeKodeItem(kodeV) && hargaNum > 0)
    ) {
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

/** util: jalankan pekerjaan per-chunk agar stabil di DB */
const runInChunks = async <T>(
  arr: T[],
  size: number,
  worker: (x: T) => Promise<any>
) => {
  for (let i = 0; i < arr.length; i += size) {
    const slice = arr.slice(i, i + size);
    await Promise.all(slice.map(worker));
  }
};

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

  // === Scope ===
  const userId = (req as any).user?.id || req.userId || undefined;
  const scope = scopeOf(userId); // pastikan ini return string stabil, mis. "GLOBAL" untuk admin

  // === Validate file ===
  if (!req.file) {
    res
      .status(400)
      .json({
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

  // === Detect header & parse rows ===
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

  // === Counters & errors ===
  let createdCategories = 0;
  let updatedCategories = 0;
  let createdItems = 0;
  let updatedItems = 0;
  let updatedPriceCount = 0;
  const errors: Array<{ kode?: string; reason: string }> = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        /* ========== 1) Upsert CATEGORIES (scoped) ========== */
        const allCategoryNames = Array.from(byCategory.keys());

        // prefetch existing untuk kalkulasi created/updated
        const existingCats = allCategoryNames.length
          ? await tx.hSPCategory.findMany({
              where: { scope, name: { in: allCategoryNames } },
              select: { id: true, name: true },
            })
          : [];
        const existingCatSet = new Set(existingCats.map((c) => c.name));
        createdCategories = allCategoryNames.filter(
          (n) => !existingCatSet.has(n)
        ).length;
        updatedCategories = allCategoryNames.length - createdCategories;

        // upsert pakai compound unique scope+name
        const categoryResults = await Promise.all(
          allCategoryNames.map((name) =>
            tx.hSPCategory.upsert({
              where: { scope_name_unique: { scope, name } },
              create: { scope, name },
              update: {}, // nama kategori tidak diupdate di import
            })
          )
        );

        const categoryMap = new Map<string, string>();
        for (const cat of categoryResults) categoryMap.set(cat.name, cat.id);

        /* ========== 2) Dedupe ITEMS per kode ========== */
        const dedupedByKode = new Map<
          string,
          {
            kode: string;
            deskripsi: string;
            satuan: string;
            harga: number;
            categoryId: string;
          }
        >();

        for (const [catName, items] of byCategory.entries()) {
          const categoryId = categoryMap.get(catName);
          if (!categoryId) continue;

          for (const it of items) {
            const kode = (it.kode || "").trim();
            const deskripsi = (it.deskripsi || "").trim();
            if (!kode) {
              errors.push({ reason: "Missing kode" });
              continue;
            }
            if (!deskripsi) {
              errors.push({ kode, reason: "Missing deskripsi" });
              continue;
            }

            dedupedByKode.set(kode, {
              kode,
              deskripsi,
              satuan: it.satuan || "",
              harga: useHargaFile ? (it.harga ?? 0) : 0,
              categoryId,
            });
          }
        }

        const uniqueItems = Array.from(dedupedByKode.values());
        const allCodes = uniqueItems.map((u) => u.kode);

        // fetch existing items DI SCOPE YANG SAMA
        const existingItems = allCodes.length
          ? await tx.hSPItem.findMany({
              where: { scope, kode: { in: allCodes } },
              select: { id: true, kode: true, harga: true },
            })
          : [];
        const existMap = new Map(existingItems.map((e) => [e.kode, e]));

        /* ========== 3a) CREATE many untuk yang belum ada (sertakan scope) ========== */
        const toCreate = uniqueItems
          .filter((u) => !existMap.has(u.kode))
          .map((u) => ({
            scope, // ← penting
            kode: u.kode,
            deskripsi: u.deskripsi,
            satuan: u.satuan,
            harga: u.harga, // bisa 0 jika useHargaFile=false
            hspCategoryId: u.categoryId,
          }));

        createdItems = 0;
        if (toCreate.length) {
          const r = await tx.hSPItem.createMany({
            data: toCreate,
            skipDuplicates: true,
          });
          createdItems = r.count;
        }

        /* ========== 3b) UPDATE untuk yang sudah ada (pakai where compound unique) ========== */
        const toUpdate = uniqueItems.filter((u) => existMap.has(u.kode));
        updatedItems = 0;
        updatedPriceCount = 0;

        await runInChunks(toUpdate, 50, async (u) => {
          const ex = existMap.get(u.kode)!;

          // aturan update harga
          const shouldUpdateHarga =
            useHargaFile && (!lockExistingPrice || (ex.harga ?? 0) === 0);

          const data: any = {
            deskripsi: u.deskripsi,
            satuan: u.satuan,
            hspCategoryId: u.categoryId,
          };
          if (shouldUpdateHarga) {
            data.harga = u.harga;
            if ((ex.harga ?? 0) !== u.harga) updatedPriceCount += 1;
          }

          await tx.hSPItem.update({
            where: { scope_kode_unique: { scope, kode: u.kode } }, // ← penting
            data,
          });
          updatedItems += 1;
        });
      },
      { timeout: 30000, maxWait: 30000 }
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

  // === OK ===
  res.status(200).json({
    status: "success",
    message: "Import finished",
    summary: {
      options: { useHargaFile, lockExistingPrice },
      categories: {
        total: byCategory.size,
        created: createdCategories,
        updated: updatedCategories,
      },
      items: {
        created: createdItems,
        updated: updatedItems,
        updatedPrice: updatedPriceCount,
      },
      errors,
      _debug: {
        detectedHeader: header,
        parsedRows: parsed.length,
        categoriesFound: Array.from(byCategory.keys()),
        scope,
      },
    },
  });
};
