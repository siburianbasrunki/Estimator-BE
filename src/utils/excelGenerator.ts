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
import { terbilangIDExcel } from "./terbilang";

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
function flattenDetails(section: {
  details?: any[];
  groups?: Array<{ details?: any[] }>;
}): EstimationDetailWithMore[] {
  const out: EstimationDetailWithMore[] = [];
  const pushWithChildren = (d: any) => {
    out.push(d);
    if (Array.isArray(d.children)) d.children.forEach(pushWithChildren);
  };

  if (Array.isArray(section.details)) section.details.forEach(pushWithChildren);
  if (Array.isArray(section.groups)) {
    section.groups.forEach((g) => (g.details || []).forEach(pushWithChildren));
  }
  return out;
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

  for (const section of est.items as any[]) {
    const catName =
      (section.title && String(section.title).trim()) ||
      section?.hspItem?.category?.name?.trim() ||
      "Lainnya";

    const allDetails = flattenDetails(section);
    const sectionTotal = allDetails.reduce((acc, d) => {
      const jumlah =
        typeof d.hargaTotal === "number"
          ? d.hargaTotal
          : N(d.volume, 0) * N(d.hargaSatuan, 0);
      return acc + (Number.isFinite(jumlah) ? Number(jumlah) : 0);
    }, 0);

    totalsByCat.set(catName, (totalsByCat.get(catName) || 0) + sectionTotal);
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

  // === BEDA DARI SEBELUMNYA: TIDAK DI-DEDUPE ===
  const rows: (string | number)[][] = [];

  for (const it of est.items as any[]) {
    for (const d of flattenDetails(it)) {
      const desk = d.hspItem?.deskripsi || d.deskripsi || "-";
      const sat = d.hspItem?.satuan || d.satuan || "-";
      // fallback kalau hargaSatuan kosong → pakai harga HSP (kalau ada)
      const hsRaw =
        (typeof d.hargaSatuan === "number" ? d.hargaSatuan : undefined) ??
        (typeof d.hspItem?.harga === "number" ? d.hspItem.harga : 0);
      const hs = Number.isFinite(hsRaw) ? Number(hsRaw) : 0;

      rows.push([desk, sat, hs]); // setiap detail ditambahkan apa adanya
    }
  }

  if (rows.length) ws.addRows(rows);

  // Styling baris data
  const dataStart = 3;
  for (let r = dataStart; r < dataStart + rows.length; r++) {
    const row = ws.getRow(r);
    row.eachCell((c, ci) => {
      c.border = BORDER_THIN as any;
      if (ci === 1) c.alignment = { wrapText: true };
      if (ci === 3) c.alignment = { horizontal: "right" };
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

function addSheetVolumeDetailed(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  // Kumpulkan urutan "extras" dinamis dari semua volumeDetails di seluruh item (details & groups)
  const extrasOrder: string[] = [];
  const extrasSeen = new Set<string>();

  for (const sec of est.items as any[]) {
    for (const d of flattenDetails(sec)) {
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

  // Kolom dasar
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

  // Kolom extras dinamis (jika ada)
  const extraCols: Partial<ExcelJS.Column>[] = extrasOrder.map((nm, i) => ({
    header: `Extra: ${nm}`,
    key: `extra_${i}`,
    width: 16,
  }));

  ws.columns = [...baseCols, ...extraCols];

  // Title bar
  addTitleBarAuto(ws, "Volume Detail");

  // Header row (baris 2)
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

  // Helper: render nilai extras mengikuti urutan extrasOrder
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
      return Number.isFinite(n) ? n : (v ?? "");
    });
  }

  // Isi data
  const rows: (string | number)[][] = [];

  for (const sec of est.items as any[]) {
    for (const d of flattenDetails(sec)) {
      const job = d.deskripsi || d.hspItem?.deskripsi || "-";
      const sat = d.satuan || d.hspItem?.satuan || "-";
      const vols = d.volumeDetails || [];

      if (vols.length === 0) {
        // Fallback: jika tidak ada volumeDetails, pakai volume dari ItemDetail
        const vol = Number(d.volume || 0);
        rows.push([
          job,
          "–",
          "+",
          0,
          0,
          0,
          0,
          vol,
          vol,
          sat,
          ...extrasOrder.map(() => ""),
        ]);
        continue;
      }

      for (const v of vols) {
        const sign = v.jenis === "SUB" ? -1 : 1;
        rows.push([
          job,
          v.nama || "-",
          sign === 1 ? "+" : "-",
          Number(v.panjang || 0),
          Number(v.lebar || 0),
          Number(v.tinggi || 0),
          Number(v.jumlah || 0),
          Number(v.volume || 0),
          sign * Number(v.volume || 0),
          sat,
          ...renderExtras(v.extras as any[]),
        ]);
      }
    }
  }

  if (rows.length) ws.addRows(rows);

  // Styling baris data
  const dataStart = 3;
  const dataEnd = dataStart + rows.length - 1;
  const numericIdxs = new Set<number>([4, 5, 6, 7, 8, 9]); // P..SignedVol

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
/** AHSP breakdown dikelompokkan: Kategori → HSP → Recipe */
/** AHSP: per Kategori → per HSP → satu tabel berisi breakdown komponen (A/B/C) + subtotal D/E/F */
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

  // Struktur kolom (tetap sama)
  ws.columns = [
    { header: "", key: "c1", width: 6 }, // No
    { header: "", key: "c2", width: 44 }, // Uraian
    { header: "", key: "c3", width: 18 }, // Kode
    { header: "", key: "c4", width: 12 }, // Satuan
    { header: "", key: "c5", width: 12 }, // Koefisien
    { header: "", key: "c6", width: 18 }, // Harga Satuan (Rp.)
    { header: "", key: "c7", width: 18 }, // Jumlah Harga (Rp.)
  ];

  addTitleBarAuto(ws, "AHSP (ANALISA HARGA SATUAN PEKERJAAN)");

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

  type Block = {
    hsp: HSPItem & {
      category: HSPCategory;
      ahsp?:
        | (AHSPRecipe & {
            components: (AHSPComponent & { masterItem: MasterItem })[];
          })
        | null;
    };
  };

  // Kumpulkan HSP per kategori (urutan kemunculan)
  const catMap = new Map<string, Map<string, Block>>();
  for (const sec of est.items as any[]) {
    for (const d of flattenDetails(sec)) {
      const h = d.hspItem as Block["hsp"] | undefined;
      if (!h) continue;
      const catName =
        (h.category?.name && String(h.category.name).trim()) ||
        (sec.title && String(sec.title).trim()) ||
        "Lainnya";

      let hspMap = catMap.get(catName);
      if (!hspMap) {
        hspMap = new Map<string, Block>();
        catMap.set(catName, hspMap);
      }
      if (!hspMap.has(h.id)) hspMap.set(h.id, { hsp: h });
    }
  }

  let rowIdx = 2;

  if (catMap.size === 0) {
    const r = ws.getRow(rowIdx++);
    ws.mergeCells(`A${r.number}:G${r.number}`);
    const c = ws.getCell(`A${r.number}`);
    c.value = "Tidak ada data AHSP yang terkait dengan item.";
    c.alignment = { horizontal: "center" };
    return ws;
  }

  // Helper harga/koef/subtotal
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

  // === Render per kategori
  for (const [catName, hspMap] of catMap.entries()) {
    // Header kategori
    {
      const r = ws.getRow(rowIdx++);
      r.getCell(2).value = (catName || "-").toUpperCase();
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
      r.getCell(2).alignment = { vertical: "middle", horizontal: "left" };
    }

    // Urutkan HSP berdasarkan kode di dalam kategori
    const blocks = [...hspMap.values()].sort((a, b) =>
      (a.hsp.kode || "").localeCompare(b.hsp.kode || "")
    );

    for (const { hsp } of blocks) {
      const kode = hsp.kode || "";
      const desk = hsp.deskripsi || "-";
      const sat = hsp.satuan || "-";
      const recipe = hsp.ahsp || null;

      // ===== Subheader HSP (baris judul HSP)
      {
        const r = ws.getRow(rowIdx++);
        // Tampilkan ringkas: KODE — DESKRIPSI [SATUAN]
        r.getCell(2).value =
          `${kode ? `${kode} — ` : ""}${desk}${sat ? ` [${sat}]` : ""}`;
        ws.mergeCells(`B${r.number}:G${r.number}`);
        r.eachCell((c) => {
          c.font = { ...(FONT.base as any), bold: true };
          c.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.zebra },
          };
          c.border = BORDER_THIN as any;
        });
        r.getCell(2).alignment = {
          vertical: "middle",
          horizontal: "left",
          wrapText: true,
        };
      }

      // ===== Header tabel komponen (No | Uraian | Kode | Satuan | Koef | Harga Satuan | Jumlah Harga)
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

      // Ambil komponen hanya A/B/C
      const comps = (recipe?.components || []).filter(
        (c) =>
          c.group === "LABOR" ||
          c.group === "MATERIAL" ||
          c.group === "EQUIPMENT"
      );

      // Penomoran baris komponen per-HSP
      let compNo = 1;

      // ===== Per grup (A/B/C)
      for (const g of groups) {
        const compsG = comps.filter((c) => c.group === g.key);
        if (compsG.length === 0) continue;

        // Judul grup (A/B/C)
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

        // Baris komponen
        for (const c of compsG) {
          const r = ws.getRow(rowIdx++);
          r.getCell(1).value = compNo++; // No
          r.getCell(2).value = c.nameSnapshot || c.masterItem?.name || "-"; // Uraian
          r.getCell(3).value = c.masterItem?.code || ""; // Kode
          r.getCell(4).value = c.unitSnapshot || c.masterItem?.unit || ""; // Satuan
          r.getCell(5).value = N(c.coefficient, 1); // Koef
          r.getCell(6).value = eff(c);
          r.getCell(6).numFmt = NUMFMT_IDR; // Harga Satuan
          r.getCell(7).value = sub(c);
          r.getCell(7).numFmt = NUMFMT_IDR; // Jumlah Harga

          r.eachCell((cell, ci) => {
            cell.border = BORDER_THIN as any;
            if ([5, 6, 7].includes(ci))
              cell.alignment = { horizontal: "right" };
            if (ci === 2) cell.alignment = { wrapText: true };
          });

          if ((rowIdx - rowsStart) % 2 === 0) {
            r.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: COLORS.zebra },
            };
          }
        }

        // Subtotal grup
        {
          const sum = compsG.reduce((acc, c) => acc + sub(c), 0);
          const r = ws.getRow(rowIdx++);
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

      // ===== D / E / F (ringkasan angka recipe)
      const subtotalA = comps
        .filter((c) => c.group === "LABOR")
        .reduce((acc, c) => acc + sub(c), 0);
      const subtotalB = comps
        .filter((c) => c.group === "MATERIAL")
        .reduce((acc, c) => acc + sub(c), 0);
      const subtotalC = comps
        .filter((c) => c.group === "EQUIPMENT")
        .reduce((acc, c) => acc + sub(c), 0);
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

      // D
      {
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
      }
      // E
      {
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
      }
      // F
      {
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

      // Spasi antar HSP
      rowIdx++;
    }

    // Spasi antar kategori (opsional)
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
  const cfPairs = (est.customFields || []).map(
    (cf) => `${cf.label}: ${cf.value}`
  );
  const cfLine = cfPairs.join("  •  ");

  sRAB.mergeCells("A3", "F3");
  sRAB.getCell("A3").value = cfLine || `Pemilik Proyek: ${est.projectOwner}`;
  sRAB.getCell("A3").font = FONT.base as any;
  sRAB.getCell("A3").alignment = { horizontal: "center", wrapText: true };
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

  // spasi
  currentRow++;

  // Subtotal
  sRAB.mergeCells(`A${currentRow}:E${currentRow}`);
  const subLab = sRAB.getCell(`A${currentRow}`);
  subLab.value = "Subtotal";
  subLab.border = BORDER_THIN as any;
  subLab.font = { ...(FONT.base as any), bold: true };

  {
    const c = sRAB.getCell(`F${currentRow}`);
    c.value = subtotal || 0;
    c.numFmt = NUMFMT_IDR;
    c.alignment = { horizontal: "right" };
    c.border = BORDER_THIN as any;
    c.font = { ...(FONT.base as any), bold: true };
  }
  currentRow++;

  // PPN (x%)
  sRAB.mergeCells(`A${currentRow}:E${currentRow}`);
  const ppnLab = sRAB.getCell(`A${currentRow}`);
  ppnLab.value = `PPN (${est.ppn}%)`;
  ppnLab.border = BORDER_THIN as any;
  ppnLab.font = { ...(FONT.base as any), bold: true };

  {
    const c = sRAB.getCell(`F${currentRow}`);
    c.value = ppnAmount || 0;
    c.numFmt = NUMFMT_IDR;
    c.alignment = { horizontal: "right" };
    c.border = BORDER_THIN as any;
    c.font = { ...(FONT.base as any), bold: true };
  }
  currentRow++;

  // Grand Total (bold)
  sRAB.mergeCells(`A${currentRow}:E${currentRow}`);
  const gtLab = sRAB.getCell(`A${currentRow}`);
  gtLab.value = "Grand Total";
  gtLab.border = BORDER_THIN as any;
  gtLab.font = { ...(FONT.base as any), bold: true };

  const gtCell = sRAB.getCell(`F${currentRow}`);
  gtCell.value = grandTotal || 0;
  gtCell.numFmt = NUMFMT_IDR;
  gtCell.alignment = { horizontal: "right" };
  gtCell.border = BORDER_THIN as any;
  gtCell.font = { ...(FONT.base as any), bold: true };
  currentRow++;

  // Terbilang
  sRAB.mergeCells(`A${currentRow}:F${currentRow}`);
  const tbTitle = sRAB.getCell(`A${currentRow}`);
  tbTitle.value = "Terbilang";
  tbTitle.font = { ...(FONT.base as any), bold: true };
  tbTitle.alignment = { horizontal: "left" };
  tbTitle.border = BORDER_THIN as any;
  currentRow++;

  sRAB.mergeCells(`A${currentRow}:F${currentRow}`);
  const tbText = sRAB.getCell(`A${currentRow}`);
  tbText.value = terbilangIDExcel(grandTotal || 0);
  tbText.font = { ...(FONT.base as any), italic: true };
  tbText.alignment = { horizontal: "left", wrapText: true };
  tbText.border = BORDER_THIN as any;
  // sRAB.getRow(currentRow).height = 30;
  currentRow++;

  /** ========= Sheets lain ========= */
  addSheetAHSP(wb, est); // ⬅️ AHSP breakdown per item (A/B/C, D/E/F)
  addSheetKategoriDipakai(wb, est);
  addSheetJobItemDipakai(wb, est);
  addSheetVolumeDetailed(wb, est); // ⬅️ Volume detail dengan kolom P, L, T, dst.
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
