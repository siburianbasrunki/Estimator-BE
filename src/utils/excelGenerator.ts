// src/utils/excelGenerator.ts
import ExcelJS from "exceljs";
import dayjs from "dayjs";
import {
  Estimation,
  EstimationItem,
  ItemDetail,
  CustomField,
  User,
  VolumeDetail as VD,
  HSPItem,
  HSPCategory,
  AHSPRecipe,
  AHSPComponent,
  MasterItem,
  AHSPComponentGroup,
} from "@prisma/client";
import { calcTotals } from "./exportHelpers";

/** =========================
 *   Types with deep include
 *  ========================= */
type EstimationDetailWithMore = ItemDetail & {
  volumeDetails?: VD[];
  hspItem?:
    | (HSPItem & {
        category: HSPCategory;
        ahsp?:
          | (AHSPRecipe & {
              components: (AHSPComponent & { masterItem: MasterItem })[];
            })
          | null;
      })
    | null;
};

type EstimationWithRelations = Estimation & {
  author: Pick<User, "id" | "name" | "email">;
  customFields: CustomField[];
  items: (EstimationItem & { details: EstimationDetailWithMore[] })[];
};

/** =========================
 *   Styles & helpers
 *  ========================= */
const COLORS = {
  titleBlue: "FF0EA5E9",
  headerBlue: "FF0284C7",
  lightBlue: "FFE0F2FE",
  zebra: "FFF8FAFC",
  white: "FFFFFFFF",
  black: "FF000000",
  border: "FF000000",
};

const FONT = {
  base: { name: "Calibri", size: 11, color: { argb: COLORS.black } as any },
  title: {
    name: "Calibri",
    size: 18,
    bold: true,
    color: { argb: COLORS.white } as any,
  },
  h1Black: {
    name: "Calibri",
    size: 16,
    bold: true,
    color: { argb: COLORS.black } as any,
  },
  h2: {
    name: "Calibri",
    size: 12,
    bold: true,
    color: { argb: COLORS.black } as any,
  },
  header: {
    name: "Calibri",
    size: 11,
    bold: true,
    color: { argb: COLORS.white } as any,
  },
};

const BORDER_THIN = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
} as const;

const NUMFMT_IDR = '"Rp" #,##0;-"Rp" #,##0;""';
const NUMFMT_DATETIME = "dd mmm yyyy hh:mm";

const roman = (n: number) => {
  const map: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let r = "",
    x = Math.max(1, Math.floor(n));
  for (const [v, s] of map)
    while (x >= v) {
      r += s;
      x -= v;
    }
  return r;
};

const N = (v: any, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const pxToColWidth = (px: number) => Math.max(10, Math.round((px - 5) / 7));
const pxToRowHeight = (px: number) => Math.max(24, Math.round(px * 0.75));

const colNumToLetter = (n: number) => {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
};

// SAFE: auto-merge sampai kolom terakhir; fallback kalau belum ada columns
function addTitleBarAuto(
  ws: ExcelJS.Worksheet,
  title: string,
  fallbackCols = 8
) {
  const count = ws.columnCount || (ws as any).columns?.length || fallbackCols;
  const last = colNumToLetter(Math.max(1, count));
  const range = `A1:${last}1`;
  ws.mergeCells(range);
  const c = ws.getCell("A1");
  c.value = title;
  c.font = FONT.title as any;
  c.alignment = { vertical: "middle", horizontal: "center" };
  c.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.titleBlue },
  };
  ws.getRow(1).height = Math.max(ws.getRow(1).height || 0, 28);
}

function addHeaderWithLogo(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  title: string,
  logo: { base64: string; extension: "png" | "jpeg" },
  size: { width: number; height: number },
  titleMergeUntilColLetter: string
) {
  ws.getRow(1).height = Math.max(
    ws.getRow(1).height || 0,
    pxToRowHeight(size.height)
  );
  ws.getColumn(1).width = Math.max(
    ws.getColumn(1).width ?? 10,
    pxToColWidth(size.width + 10)
  );

  try {
    const imgId = wb.addImage({
      base64: logo.base64,
      extension: logo.extension,
    });
    ws.addImage(imgId, {
      tl: { col: 0, row: 0 },
      ext: { width: size.width, height: size.height },
      editAs: "oneCell",
    });
  } catch (e) {
    console.warn("Logo placement failed:", e);
  }

  const mergeRange = `B1:${titleMergeUntilColLetter}1`;
  ws.mergeCells(mergeRange);
  const t = ws.getCell("B1");
  t.value = title;
  t.font = FONT.title as any;
  t.alignment = { vertical: "middle", horizontal: "center" };
  t.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.titleBlue },
  };
}

/** =========================
 *   SHEETS
 *  ========================= */
function addSheetKategoriDipakai(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  const ws = wb.addWorksheet("Rekapitulasi Kategori", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: { defaultRowHeight: 18 },
  });

  ws.columns = [
    { header: "Kategori", key: "kategori", width: 48 },
    {
      header: "Total (Rp)",
      key: "total",
      width: 24,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
  ];

  addTitleBarAuto(ws, "Kategori Dipakai");

  const header = ws.getRow(2);
  header.values = ["Kategori", "Total (Rp)"];
  header.eachCell((c) => {
    c.font = FONT.header as any;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBlue },
    };
    c.border = BORDER_THIN as any;
  });

  const totalsByCat = new Map<string, number>();
  for (const section of est.items) {
    for (const d of section.details) {
      const catName =
        section.title?.trim() || d.hspItem?.category?.name?.trim() || "Lainnya";
      const jumlah =
        (typeof d.hargaTotal === "number" ? d.hargaTotal : undefined) ??
        Number(d.volume || 0) * Number(d.hargaSatuan || 0);
      const safeJumlah = Number.isFinite(jumlah) ? Number(jumlah) : 0;
      totalsByCat.set(catName, (totalsByCat.get(catName) || 0) + safeJumlah);
    }
  }

  const rows = [...totalsByCat.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map<[string, number]>(([name, total]) => [name, total]);
  if (rows.length) ws.addRows(rows);

  const dataStart = 3;
  for (let r = dataStart; r < dataStart + rows.length; r++) {
    const row = ws.getRow(r);
    row.eachCell((c) => (c.border = BORDER_THIN as any));
    if ((r - dataStart) % 2 === 1)
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
  }

  return ws;
}

function addSheetJobItemDipakai(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  const ws = wb.addWorksheet("Rekapitulasi Pekerjaan", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: { defaultRowHeight: 18 },
  });

  ws.columns = [
    { header: "Nama Pekerjaan", key: "desk", width: 64 },
    { header: "Satuan", key: "sat", width: 12 },
    {
      header: "Harga Satuan (Rp)",
      key: "hs",
      width: 22,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
  ];

  addTitleBarAuto(ws, "Job Item Dipakai");

  const header = ws.getRow(2);
  header.values = ["Nama Pekerjaan", "Satuan", "Harga Satuan (Rp)"];
  header.eachCell((c) => {
    c.font = FONT.header as any;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBlue },
    };
    c.border = BORDER_THIN as any;
  });

  const uniq = new Map<string, { desk: string; sat: string; hs: number }>();
  for (const it of est.items) {
    for (const d of it.details) {
      const kode = d.hspItem?.kode || d.kode || "";
      const desk = d.hspItem?.deskripsi || d.deskripsi || "-";
      const sat = d.hspItem?.satuan || d.satuan || "-";
      const hsRaw =
        (typeof d.hargaSatuan === "number" ? d.hargaSatuan : undefined) ?? 0;
      const hs = Number.isFinite(hsRaw) ? Number(hsRaw) : 0;
      const key = kode ? `K:${kode}` : `D:${desk}|S:${sat}`;
      if (!uniq.has(key)) uniq.set(key, { desk, sat, hs });
    }
  }

  const rows = [...uniq.values()].map<(string | number)[]>((r) => [
    r.desk,
    r.sat,
    r.hs,
  ]);
  if (rows.length) ws.addRows(rows);

  const dataStart = 3;
  for (let r = dataStart; r < dataStart + rows.length; r++) {
    const row = ws.getRow(r);
    row.eachCell((c, ci) => {
      c.border = BORDER_THIN as any;
      if (ci === 1) c.alignment = { wrapText: true };
      if (ci === 3) c.alignment = { horizontal: "right" };
    });
    if ((r - dataStart) % 2 === 1)
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
  }

  return ws;
}

function addSheetVolumeDetailed(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  const extrasOrder: string[] = [];
  const extrasSeen = new Set<string>();
  for (const sec of est.items) {
    for (const d of sec.details) {
      for (const v of d.volumeDetails || []) {
        const arr = Array.isArray(v.extras) ? (v.extras as any[]) : [];
        for (const e of arr) {
          const name = (e?.name ?? "").toString().trim();
          if (name && !extrasSeen.has(name)) {
            extrasSeen.add(name);
            extrasOrder.push(name);
          }
        }
      }
    }
  }

  const ws = wb.addWorksheet("Rekapitulasi Volume", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: { defaultRowHeight: 18 },
  });

  // 2) Definisikan kolom dasar
  const baseCols: Partial<ExcelJS.Column>[] = [
    { header: "Item Pekerjaan", key: "item", width: 56 },
    { header: "Nama Volume", key: "nama", width: 30 },
    { header: "Jenis (+/-)", key: "jenis", width: 12 },
    { header: "P", key: "p", width: 10 },
    { header: "L", key: "l", width: 10 },
    { header: "T", key: "t", width: 10 },
    { header: "Jumlah", key: "jml", width: 12 },
    { header: "Volume", key: "vol", width: 14 },
    { header: "Signed Vol", key: "svol", width: 14 },
    { header: "Satuan", key: "sat", width: 10 },
  ];

  // 3) Tambahkan kolom extras dinamis (mis. "Extra: Diameter")
  const extraCols: Partial<ExcelJS.Column>[] = extrasOrder.map((nm, i) => ({
    header: `Extra: ${nm}`,
    key: `extra_${i}`,
    width: 16,
  }));

  ws.columns = [...baseCols, ...extraCols];

  addTitleBarAuto(ws, "Volume Detail");

  // Header (row 2)
  const header = ws.getRow(2);
  header.values = ws.columns.map((c) => (c.header ?? "") as string);
  header.eachCell((c) => {
    c.font = FONT.header as any;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBlue },
    };
    c.border = BORDER_THIN as any;
  });

  const rows: (string | number)[][] = [];

  // Helper untuk render nilai extras sesuai urutan extrasOrder
  function renderExtras(values: any[] | undefined) {
    const arr = Array.isArray(values) ? values : [];
    const map = new Map<string, any>();
    for (const e of arr) {
      const name = (e?.name ?? "").toString().trim();
      if (name) map.set(name, e?.value);
    }
    return extrasOrder.map((nm) => {
      const v = map.get(nm);
      const n = Number(v);
      return Number.isFinite(n) ? n : (v ?? ""); // angka -> number, lainnya biarkan teks
    });
  }

  for (const sec of est.items) {
    for (const d of sec.details) {
      const job = d.deskripsi || d.hspItem?.deskripsi || "-";
      const sat = d.satuan || d.hspItem?.satuan || "-";
      const vols = d.volumeDetails || [];

      if (vols.length === 0) {
        // Fallback baris untuk item tanpa detail → pakai volume dari ItemDetail
        const vol = Number(d.volume || 0);
        rows.push([
          job, // Item Pekerjaan
          "–", // Nama Volume
          "+", // Jenis (+/-)
          0, // P
          0, // L
          0, // T
          0, // Jumlah
          vol, // Volume
          vol, // Signed Vol
          sat, // Satuan
          // extras kosong
          ...extrasOrder.map(() => ""),
        ]);
        continue;
      }

      for (const v of vols) {
        const sign = v.jenis === "SUB" ? -1 : 1;
        rows.push([
          job, // Item Pekerjaan
          v.nama || "-", // Nama Volume
          sign === 1 ? "+" : "-", // Jenis (+/-)
          Number(v.panjang || 0), // P
          Number(v.lebar || 0), // L
          Number(v.tinggi || 0), // T
          Number(v.jumlah || 0), // Jumlah
          Number(v.volume || 0), // Volume
          sign * Number(v.volume || 0), // Signed Vol
          sat, // Satuan
          ...renderExtras(v.extras as any[]),
        ]);
      }
    }
  }

  if (rows.length) ws.addRows(rows);

  // Styling baris data
  const dataStart = 3;
  const dataEnd = dataStart + rows.length - 1;
  // Indeks kolom numerik dasar (P..SignedVol) = 4..9
  const numericIdxs = new Set<number>([4, 5, 6, 7, 8, 9]);
  // Kalau extras berisi angka, biarin default (teks/angka mixed), tidak dipaksa kanan.

  for (let r = dataStart; r <= dataEnd; r++) {
    const row = ws.getRow(r);
    row.eachCell((c, ci) => {
      c.border = BORDER_THIN as any;
      if (numericIdxs.has(ci)) c.alignment = { horizontal: "right" };
      if (ci === 1 || ci === 2)
        c.alignment = { vertical: "top", wrapText: true };
    });
    if ((r - dataStart) % 2 === 1) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
    }
  }

  return ws;
}

/** AHSP breakdown per item (ringkasan + tabel terperinci per grup) */
function addSheetAHSP(wb: ExcelJS.Workbook, est: EstimationWithRelations) {
  const ws = wb.addWorksheet("AHSP", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: { defaultRowHeight: 18 },
  });

  // 7 kolom agar cukup untuk tabel breakdown
  ws.columns = [
    { header: "", key: "c1", width: 6 }, // No / A-B-C / No komponen
    { header: "", key: "c2", width: 44 }, // Deskripsi / Uraian
    { header: "", key: "c3", width: 18 }, // Kode
    { header: "", key: "c4", width: 12 }, // Satuan
    { header: "", key: "c5", width: 12 }, // Koef
    { header: "", key: "c6", width: 18 }, // Harga Satuan
    { header: "", key: "c7", width: 18 }, // Jumlah Harga
  ];

  addTitleBarAuto(ws, "AHSP");

  const groups: Array<{
    key: AHSPComponentGroup;
    letter: "A" | "B" | "C";
    title: string;
    subLabel: string;
  }> = [
    {
      key: "LABOR",
      letter: "A",
      title: "TENAGA",
      subLabel: "JUMLAH TENAGA KERJA",
    },
    {
      key: "MATERIAL",
      letter: "B",
      title: "BAHAN",
      subLabel: "JUMLAH HARGA BAHAN",
    },
    {
      key: "EQUIPMENT",
      letter: "C",
      title: "PERALATAN",
      subLabel: "JUMLAH HARGA ALAT",
    },
  ];

  // Kumpulkan AHSP unik yang dipakai
  type Block = {
    hsp: HSPItem & {
      ahsp?:
        | (AHSPRecipe & {
            components: (AHSPComponent & { masterItem: MasterItem })[];
          })
        | null;
    };
  };
  const uniqHsp = new Map<string, Block>();

  for (const sec of est.items) {
    for (const d of sec.details) {
      const h = d.hspItem;
      if (!h) continue;
      if (!uniqHsp.has(h.id)) uniqHsp.set(h.id, { hsp: h as any });
    }
  }

  // Urutkan blok berdasarkan kode
  const blocks = [...uniqHsp.values()].sort((a, b) =>
    (a.hsp.kode || "").localeCompare(b.hsp.kode || "")
  );

  let rowIdx = 2;
  let idx = 1;

  for (const { hsp } of blocks) {
    const kode = hsp.kode || "";
    const desk = hsp.deskripsi || "-";
    const sat = hsp.satuan || "-";
    const recipe = hsp.ahsp || null;

    // Hitung subtotal per grup, subtotal ABC, overhead, final
    const comps = (recipe?.components || []).filter(
      (c) =>
        c.group === "LABOR" || c.group === "MATERIAL" || c.group === "EQUIPMENT"
    );

    const eff = (c: AHSPComponent & { masterItem: MasterItem }) =>
      N(
        c.effectiveUnitPrice ??
          c.priceOverride ??
          c.unitPriceSnapshot ??
          c.masterItem?.price,
        0
      );

    const sub = (c: AHSPComponent & { masterItem: MasterItem }) =>
      N(c.subtotal, N(c.coefficient, 1) * eff(c));

    const sumGroup = (g: AHSPComponentGroup) =>
      comps.filter((c) => c.group === g).reduce((acc, c) => acc + sub(c), 0);

    const subtotalA = sumGroup("LABOR");
    const subtotalB = sumGroup("MATERIAL");
    const subtotalC = sumGroup("EQUIPMENT");
    const subtotalABC = N(
      recipe?.subtotalABC,
      subtotalA + subtotalB + subtotalC
    );

    const ohPct = N(recipe?.overheadPercent, 10);
    const overheadAmount = N(
      recipe?.overheadAmount,
      Math.round((ohPct / 100) * subtotalABC)
    );
    const finalUnitPrice = N(
      recipe?.finalUnitPrice,
      subtotalABC + overheadAmount
    );

    // ===== Ringkasan baris: No | Kode | Deskripsi | Satuan | Harga Satuan (Rp.)
    {
      const r = ws.getRow(rowIdx++);
      r.getCell(1).value = idx++;
      r.getCell(2).value = desk;
      r.getCell(3).value = kode;
      r.getCell(4).value = sat;
      r.getCell(5).value = "Harga Satuan (Rp.)";
      r.getCell(6).value = finalUnitPrice;
      r.getCell(6).numFmt = NUMFMT_IDR;
      // style
      [1, 2, 3, 4, 5, 6, 7].forEach(
        (ci) => (r.getCell(ci).border = BORDER_THIN as any)
      );
      [1, 3, 4, 5, 6].forEach(
        (ci) =>
          (r.getCell(ci).alignment = {
            vertical: "middle",
            horizontal: ci === 6 ? "right" : "center",
            wrapText: true,
          })
      );
      r.getCell(2).alignment = {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      };
      r.eachCell((c) => {
        c.font = { ...(FONT.base as any), bold: true };
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.lightBlue },
        };
      });
    }

    // ===== Header breakdown
    {
      const r = ws.getRow(rowIdx++);
      r.values = [
        "No",
        "Uraian",
        "Kode",
        "Satuan",
        "Koefisien",
        "Harga Satuan (Rp.)",
        "Jumlah Harga (Rp.)",
      ];
      r.eachCell((c) => {
        c.font = FONT.header as any;
        c.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
        c.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.headerBlue },
        };
        c.border = BORDER_THIN as any;
      });
    }

    // ===== Per grup (A/B/C)
    for (const g of groups) {
      // Baris judul grup: "A" | "TENAGA"
      {
        const r = ws.getRow(rowIdx++);
        r.getCell(1).value = g.letter;
        r.getCell(2).value = g.title;
        ws.mergeCells(`B${r.number}:G${r.number}`);
        r.eachCell((c) => {
          c.font = { ...(FONT.base as any), bold: true };
          c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.lightBlue },
          };
          c.border = BORDER_THIN as any;
        });
        r.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
        r.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
      }

      const rowsStart = rowIdx;
      const compsG = comps.filter((c) => c.group === g.key);

      // Isi komponen
      for (const c of compsG) {
        const r = ws.getRow(rowIdx++);
        // "No" pada rincian dibiarkan kosong (mengikuti contoh)
        r.getCell(2).value = c.nameSnapshot || c.masterItem?.name || "-";
        r.getCell(3).value = c.masterItem?.code || "";
        r.getCell(4).value = c.unitSnapshot || c.masterItem?.unit || "";
        r.getCell(5).value = N(c.coefficient, 1);
        r.getCell(6).value = eff(c);
        r.getCell(7).value = sub(c);
        r.getCell(6).numFmt = NUMFMT_IDR;
        r.getCell(7).numFmt = NUMFMT_IDR;

        r.eachCell((cell, ci) => {
          cell.border = BORDER_THIN as any;
          if (ci === 2) cell.alignment = { wrapText: true };
          if ([5, 6, 7].includes(ci)) cell.alignment = { horizontal: "right" };
        });

        if ((rowIdx - rowsStart) % 2 === 0)
          r.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.zebra },
          };
      }

      // Subtotal grup
      {
        const sum = compsG.reduce((acc, c) => acc + sub(c), 0);
        const r = ws.getRow(rowIdx++);
        // Kosongkan kolom 1–2, taruh label di kolom 3-6 agar panjang
        r.getCell(3).value = g.subLabel;
        ws.mergeCells(`C${r.number}:F${r.number}`);
        r.getCell(7).value = sum || "-";
        if (sum) r.getCell(7).numFmt = NUMFMT_IDR;

        r.eachCell((cell) => {
          cell.border = BORDER_THIN as any;
          cell.font = { ...(FONT.base as any), bold: true };
        });
        r.getCell(3).alignment = { horizontal: "right" };
        r.getCell(7).alignment = { horizontal: sum ? "right" : "center" };
      }
    }

    // D / E / F
    {
      // D
      const rD = ws.getRow(rowIdx++);
      rD.getCell(3).value = "Jumlah (A+B+C)";
      ws.mergeCells(`C${rD.number}:F${rD.number}`);
      rD.getCell(7).value = subtotalABC || "-";
      if (subtotalABC) rD.getCell(7).numFmt = NUMFMT_IDR;
      rD.eachCell((c) => {
        c.border = BORDER_THIN as any;
        c.font = { ...(FONT.base as any), bold: true };
      });
      rD.getCell(3).alignment = { horizontal: "right" };
      rD.getCell(7).alignment = {
        horizontal: subtotalABC ? "right" : "center",
      };

      // E
      const rE = ws.getRow(rowIdx++);
      rE.getCell(3).value = `Overhead & Profit ${ohPct}%`;
      ws.mergeCells(`C${rE.number}:F${rE.number}`);
      rE.getCell(7).value = overheadAmount || "-";
      if (overheadAmount) rE.getCell(7).numFmt = NUMFMT_IDR;
      rE.eachCell((c) => {
        c.border = BORDER_THIN as any;
        c.font = { ...(FONT.base as any), bold: true };
      });
      rE.getCell(3).alignment = { horizontal: "right" };
      rE.getCell(7).alignment = {
        horizontal: overheadAmount ? "right" : "center",
      };

      // F
      const rF = ws.getRow(rowIdx++);
      rF.getCell(3).value = "Harga Satuan Pekerjaan (D+E)";
      ws.mergeCells(`C${rF.number}:F${rF.number}`);
      rF.getCell(7).value = finalUnitPrice || "-";
      if (finalUnitPrice) rF.getCell(7).numFmt = NUMFMT_IDR;
      rF.eachCell((c) => {
        c.border = BORDER_THIN as any;
        c.font = { ...(FONT.base as any), bold: true };
      });
      rF.getCell(3).alignment = { horizontal: "right" };
      rF.getCell(7).alignment = {
        horizontal: finalUnitPrice ? "right" : "center",
      };
    }

    // Spasi antar blok
    rowIdx++;
  }

  return ws;
}

/** =========================
 *   MAIN
 *  ========================= */
export async function buildEstimationExcel(
  est: EstimationWithRelations,
  opts?: {
    logo?: { base64: string; extension: "png" | "jpeg" };
    logoSize?: { width: number; height: number };
  }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estimation App";
  wb.created = new Date();

  /** ========= Sheet 1: Ringkasan (tanpa logo) ========= */
  const s1 = wb.addWorksheet("Ringkasan", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: {
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: { defaultRowHeight: 18 },
  });

  // set columns dulu → baru title auto (FIX error)
  s1.columns = [
    { header: "", key: "field", width: 28 },
    { header: "", key: "value", width: 52 },
    { header: "", key: "field2", width: 28 },
    { header: "", key: "value2", width: 30 },
  ];
  addTitleBarAuto(s1, `Ringkasan Estimasi • ${est.projectName}`);

  // Info header
  s1.mergeCells("A2", "D2");
  const infoHdr = s1.getCell("A2");
  infoHdr.value = "Informasi Proyek";
  infoHdr.font = FONT.h2 as any;
  infoHdr.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.lightBlue },
  };
  infoHdr.border = BORDER_THIN as any;

  const rowsLeft: Array<[string, ExcelJS.CellValue]> = [
    ["Nama Proyek", est.projectName],
    ["Penanggung Jawab", est.projectOwner],
    ["PPN", `${est.ppn}%`],
    ["Status", est.status],
    ["Dibuat", dayjs(est.createdAt).toDate()],
    ["Diupdate", dayjs(est.updatedAt).toDate()],
    ["Catatan", est.notes || "-"],
  ];
  const rowsRight: Array<[string, ExcelJS.CellValue]> = [
    ["Author", est.author?.name || "-"],
    ["Email Author", est.author?.email || "-"],
  ];

  let rowIdx = 3;
  const maxLen = Math.max(rowsLeft.length, rowsRight.length);
  for (let i = 0; i < maxLen; i++) {
    const r = s1.getRow(rowIdx++);
    const left = rowsLeft[i],
      right = rowsRight[i];
    r.getCell(1).value = (left?.[0] ?? "") as ExcelJS.CellValue;
    r.getCell(2).value = (left?.[1] ?? "") as ExcelJS.CellValue;
    r.getCell(3).value = (right?.[0] ?? "") as ExcelJS.CellValue;
    r.getCell(4).value = (right?.[1] ?? "") as ExcelJS.CellValue;
    [1, 2, 3, 4].forEach((c) => {
      const cell = r.getCell(c);
      cell.font = FONT.base as any;
      cell.border = BORDER_THIN as any;
      cell.alignment = {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      };
      if (cell.value instanceof Date) cell.numFmt = NUMFMT_DATETIME;
    });
    if (i % 2 === 1)
      r.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
  }

  const { subtotal, ppnAmount, grandTotal } = calcTotals(est as any);
  s1.addRow([]);
  const tHdr = s1.addRow(["Ringkasan Biaya"]);
  tHdr.font = FONT.h2 as any;
  tHdr.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.lightBlue },
  };
  tHdr.eachCell((c) => (c.border = BORDER_THIN as any));

  (
    [
      ["Subtotal", Number.isFinite(subtotal) ? subtotal : 0],
      [`PPN (${est.ppn}%)`, Number.isFinite(ppnAmount) ? ppnAmount : 0],
      ["Grand Total", Number.isFinite(grandTotal) ? grandTotal : 0],
    ] as [string, number][]
  ).forEach(([label, val], i, arr) => {
    const r = s1.addRow([label, val ?? 0]);
    r.getCell(1).border = BORDER_THIN as any;
    r.getCell(2).border = BORDER_THIN as any;
    r.getCell(2).numFmt = NUMFMT_IDR;
    r.getCell(2).alignment = { horizontal: "right" };
    if (i === arr.length - 1) {
      r.getCell(1).font = { ...(FONT.base as any), bold: true };
      r.getCell(2).font = { ...(FONT.base as any), bold: true };
      r.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
      r.getCell(2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLORS.zebra },
      };
    }
  });
  // tambahkan helper huruf di bagian helpers (bareng roman, N, dll.)
  const toLetter = (i: number) => String.fromCharCode(97 + i); // a,b,c,...

  /** ========= Sheet 2: RAB ========= */
  const sRAB = wb.addWorksheet("RAB", {
    views: [{ state: "frozen", ySplit: 6 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: { defaultRowHeight: 18 },
  });

  sRAB.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "Uraian Pekerjaan", key: "uraian", width: 56 },
    { header: "Satuan", key: "satuan", width: 10 },
    { header: "Volume", key: "volume", width: 12 },
    {
      header: "Satuan (Rp)",
      key: "hargaSatuan",
      width: 18,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
    {
      header: "Rancangan Anggaran Biaya",
      key: "jumlah",
      width: 18,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
  ];

  if (opts?.logo) {
    const scale = 0.7;
    const small = {
      width: Math.round((opts.logoSize?.width ?? 240) * scale),
      height: Math.round((opts.logoSize?.height ?? 80) * scale),
    };
    addHeaderWithLogo(
      wb,
      sRAB,
      "Rencana Anggaran Biaya",
      opts.logo,
      small,
      "F"
    );
  } else {
    addTitleBarAuto(sRAB, "Rencana Anggaran Biaya", 6);
  }

  sRAB.mergeCells("A2", "F2");
  sRAB.getCell("A2").value = `Nama Proyek: ${est.projectName}`;
  sRAB.getCell("A2").font = FONT.base as any;
  sRAB.getCell("A2").alignment = { horizontal: "center" };

  sRAB.mergeCells("A3", "F3");
  sRAB.getCell("A3").value =
    `Pemilik Proyek: ${est.projectOwner}  •  PPN: ${est.ppn}%  •  Status: ${est.status}`;
  sRAB.getCell("A3").font = FONT.base as any;
  sRAB.getCell("A3").alignment = { horizontal: "center" };

  sRAB.mergeCells("A4", "F4");
  sRAB.getCell("A4").value =
    `Dibuat: ${dayjs(est.createdAt).format("DD MMM YYYY HH:mm")}   •   Diupdate: ${dayjs(est.updatedAt).format("DD MMM YYYY HH:mm")}`;
  sRAB.getCell("A4").font = FONT.base as any;
  sRAB.getCell("A4").alignment = { horizontal: "center" };

  // header 2 baris
  const h1 = sRAB.getRow(5);
  h1.values = ["No", "Uraian Pekerjaan", "Satuan", "Volume", "Harga (Rp)", ""];
  h1.eachCell((c) => {
    c.font = FONT.header as any;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBlue },
    };
    c.border = BORDER_THIN as any;
  });
  sRAB.mergeCells("E5:F5");

  const h2 = sRAB.getRow(6);
  h2.values = ["", "", "", "", "Satuan (Rp)", "Jumlah (Rp)"];
  [5, 6].forEach((col) => {
    const c = h2.getCell(col);
    c.font = FONT.header as any;
    c.alignment = { vertical: "middle", horizontal: "center" };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBlue },
    };
    c.border = BORDER_THIN as any;
  });
  [1, 2, 3, 4].forEach((col) => (h2.getCell(col).border = BORDER_THIN as any));

  let currentRow = 7;

  est.items.forEach((section, sIdx) => {
    // ===== Header Section (Kategori) =====
    sRAB.mergeCells(`A${currentRow}:F${currentRow}`);
    const secCell = sRAB.getCell(`A${currentRow}`);
    secCell.value = `${roman(sIdx + 1)}    ${section.title?.toUpperCase?.() ?? "-"}`;
    secCell.font = FONT.h2 as any;
    secCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.lightBlue },
    };
    secCell.border = BORDER_THIN as any;
    secCell.alignment = { horizontal: "left" };
    currentRow++;

    let sectionSubtotal = 0;

    const hasGroups =
      Array.isArray((section as any).groups) &&
      (section as any).groups.length > 0;

    if (hasGroups) {
      // ========= FORMAT BARU: ada groups =========
      const groups = (section as any).groups as Array<{
        id: string;
        title: string;
        details: any[];
      }>;

      groups.forEach((g, gIdx) => {
        // -- header group: "1    Nama Group" (tanpa bold, gaya sama seperti deskripsi)
        sRAB.mergeCells(`A${currentRow}:F${currentRow}`);
        const gCell = sRAB.getCell(`A${currentRow}`);
        gCell.value = `${gIdx + 1}    ${g.title || "-"}`;
        gCell.font = FONT.base as any; // <= tidak bold
        gCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.zebra },
        };
        gCell.border = BORDER_THIN as any;
        gCell.alignment = { horizontal: "left" };
        currentRow++;

        // -- isi group: a., b., c. di kolom Uraian; kolom No dikosongkan
        let letterIdx = 0;
        (g.details || []).forEach((d: any, i: number) => {
          const jumlah =
            (typeof d.hargaTotal === "number" ? d.hargaTotal : undefined) ??
            Number(d.volume || 0) * Number(d.hargaSatuan || 0);
          const safeJumlah = Number.isFinite(jumlah) ? Number(jumlah) : 0;

          const r = sRAB.getRow(currentRow++);
          r.getCell(1).value = ""; // kolom No kosong untuk baris huruf
          r.getCell(2).value =
            `${toLetter(letterIdx++)}. ${d.deskripsi || "-"}`;
          r.getCell(3).value = d.satuan || "-";
          r.getCell(4).value = Number(d.volume || 0);
          r.getCell(5).value = Number(d.hargaSatuan || 0);
          r.getCell(6).value = safeJumlah;

          sectionSubtotal += safeJumlah;

          [1, 2, 3, 4, 5, 6].forEach(
            (c) => (r.getCell(c).border = BORDER_THIN as any)
          );
          r.getCell(2).alignment = { wrapText: true };
          r.getCell(4).alignment = { horizontal: "right" };
          r.getCell(5).numFmt = NUMFMT_IDR;
          r.getCell(6).numFmt = NUMFMT_IDR;

          if (i % 2 === 1) {
            r.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: COLORS.zebra },
            };
          }
        });

        // ⛔ Tidak ada subtotal per group — langsung lanjut
      });
    }

    // ========= Detail langsung (tanpa groups) tetap bernomor 1,2,3... =========
    if (!hasGroups && (section.details || []).length > 0) {
      let rowNo = 1;
      (section.details || []).forEach((d, i) => {
        const jumlah =
          (typeof d.hargaTotal === "number" ? d.hargaTotal : undefined) ??
          Number(d.volume || 0) * Number(d.hargaSatuan || 0);
        const safeJumlah = Number.isFinite(jumlah) ? Number(jumlah) : 0;

        const r = sRAB.getRow(currentRow++);
        r.getCell(1).value = rowNo++; // No
        r.getCell(2).value = d.deskripsi || "-"; // Uraian
        r.getCell(3).value = d.satuan || "-";
        r.getCell(4).value = Number(d.volume || 0);
        r.getCell(5).value = Number(d.hargaSatuan || 0);
        r.getCell(6).value = safeJumlah;

        sectionSubtotal += safeJumlah;

        [1, 2, 3, 4, 5, 6].forEach(
          (c) => (r.getCell(c).border = BORDER_THIN as any)
        );
        r.getCell(2).alignment = { wrapText: true };
        r.getCell(4).alignment = { horizontal: "right" };
        r.getCell(5).numFmt = NUMFMT_IDR;
        r.getCell(6).numFmt = NUMFMT_IDR;

        if (i % 2 === 1) {
          r.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.zebra },
          };
        }
      });
    }

    // ===== Subtotal Section (Kategori saja) =====
    sRAB.mergeCells(`A${currentRow}:D${currentRow}`);
    const empty = sRAB.getCell(`A${currentRow}`);
    empty.value = "";
    empty.border = BORDER_THIN as any;

    const lab = sRAB.getCell(`E${currentRow}`);
    lab.value = `Jumlah ${roman(sIdx + 1)}`;
    lab.font = { ...(FONT.base as any), bold: true };
    lab.alignment = { horizontal: "right" };
    lab.border = BORDER_THIN as any;

    const totCell = sRAB.getCell(`F${currentRow}`);
    totCell.value = sectionSubtotal;
    totCell.font = { ...(FONT.base as any), bold: true };
    totCell.numFmt = NUMFMT_IDR;
    totCell.alignment = { horizontal: "right" };
    totCell.border = BORDER_THIN as any;

    currentRow++;
  });

  /** ========= Sheets lain ========= */
  addSheetKategoriDipakai(wb, est);
  addSheetJobItemDipakai(wb, est);
  addSheetVolumeDetailed(wb, est); // ⬅️ Volume detail dengan kolom P, L, T, dst.
  addSheetAHSP(wb, est); // ⬅️ AHSP breakdown per item (A/B/C, D/E/F)
  // ⛔️ Tidak membuat sheet "Master Item Dipakai" (dihapus sesuai permintaan)

  // Font default fallback
  wb.worksheets.forEach((sh) => {
    sh.eachRow((row) =>
      row.eachCell((cell) => (cell.font = cell.font || (FONT.base as any)))
    );
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
