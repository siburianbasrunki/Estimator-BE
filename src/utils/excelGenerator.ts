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

const GROUP_LABEL: Record<AHSPComponentGroup, string> = {
  LABOR: "A • Labor",
  MATERIAL: "B • Material",
  EQUIPMENT: "C • Equipment",
  OTHER: "Other",
};

/** =========================
 *   Header helpers
 *  ========================= */
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
 *   SHEETS (return ws)
 *  ========================= */
function addSheetKategoriDipakai(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  const ws = wb.addWorksheet("Kategori Dipakai", {
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
        d.hspItem?.category?.name?.trim() || section.title?.trim() || "Lainnya";
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
  const ws = wb.addWorksheet("Job Item Dipakai", {
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

function addSheetVolume(wb: ExcelJS.Workbook, est: EstimationWithRelations) {
  const ws = wb.addWorksheet("Volume", {
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

  addTitleBarAuto(ws, "Volume Detail");

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
  for (const sec of est.items) {
    for (const d of sec.details) {
      const sat = d.satuan || d.hspItem?.satuan || "-";
      const vols = d.volumeDetails || [];
      if (!vols.length) continue;
      for (const v of vols) {
        const sign = v.jenis === "SUB" ? -1 : 1;
        rows.push([
          v.nama || "-",
          v.jenis || "-",
          Number(v.panjang || 0),
          Number(v.lebar || 0),
          Number(v.tinggi || 0),
          Number(v.jumlah || 0),
          Number(v.volume || 0),
          sign * Number(v.volume || 0),
          sat,
        ]);
      }
    }
  }
  if (rows.length) ws.addRows(rows);

  const dataStart = 3;
  for (let r = dataStart; r < dataStart + rows.length; r++) {
    const row = ws.getRow(r);
    row.eachCell((c, ci) => {
      c.border = BORDER_THIN as any;
      if ([3, 4, 5, 6, 7, 8].includes(ci))
        c.alignment = { horizontal: "right" };
      if (ci === 1) c.alignment = { wrapText: true };
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

function addSheetAHSPDipakai(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  const ws = wb.addWorksheet("AHSP Dipakai", {
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
    { header: "Kode HSP", key: "kode", width: 18 },
    { header: "Deskripsi HSP", key: "desk", width: 48 },
    { header: "Satuan HSP", key: "sat", width: 12 },
    { header: "Group", key: "grp", width: 16 },
    { header: "Kode Master", key: "mcode", width: 18 },
    { header: "Nama Komponen", key: "mname", width: 40 },
    { header: "Satuan", key: "munit", width: 12 },
    { header: "Koef.", key: "coef", width: 10 },
    {
      header: "Harga Satuan",
      key: "uprice",
      width: 18,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
    {
      header: "Subtotal",
      key: "subtotal",
      width: 18,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
  ];

  addTitleBarAuto(ws, "AHSP Dipakai");

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

  type Row = (string | number)[];
  const rows: Row[] = [];

  for (const sec of est.items) {
    for (const d of sec.details) {
      const h = d.hspItem;
      if (!h || !h.ahsp) continue;

      const kode = h.kode || "";
      const desk = h.deskripsi || d.deskripsi || "-";
      const satuanHsp = h.satuan || d.satuan || "-";
      const recipe = h.ahsp;

      for (const c of recipe.components || []) {
        const grp = GROUP_LABEL[c.group] || c.group;
        const m = c.masterItem;
        const eff = N(c.effectiveUnitPrice ?? c.priceOverride ?? m?.price, 0);
        const sub = N(c.subtotal, N(c.coefficient, 1) * eff);

        rows.push([
          kode,
          desk,
          satuanHsp,
          grp,
          m?.code || "",
          c.nameSnapshot || m?.name || "",
          c.unitSnapshot || m?.unit || "",
          N(c.coefficient, 1),
          eff,
          sub,
        ]);
      }

      if (
        recipe.subtotalABC != null ||
        recipe.overheadAmount != null ||
        recipe.finalUnitPrice != null
      ) {
        rows.push([
          kode,
          desk,
          satuanHsp,
          "—",
          "",
          "Subtotal ABC (D)",
          "",
          "",
          "",
          N(recipe.subtotalABC, 0),
        ]);
        rows.push([
          kode,
          desk,
          satuanHsp,
          "—",
          "",
          `Overhead ${N(recipe.overheadPercent, 10)}% (E)`,
          "",
          "",
          "",
          N(recipe.overheadAmount, 0),
        ]);
        rows.push([
          kode,
          desk,
          satuanHsp,
          "—",
          "",
          "Harga Akhir (F = D + E)",
          "",
          "",
          "",
          N(recipe.finalUnitPrice, 0),
        ]);
        rows.push(["", "", "", "", "", "", "", "", "", ""]);
      }
    }
  }

  if (rows.length) ws.addRows(rows);

  const dataStart = 3;
  for (let r = dataStart; r < dataStart + rows.length; r++) {
    const row = ws.getRow(r);
    row.eachCell((c, ci) => {
      c.border = BORDER_THIN as any;
      if ([8, 9, 10].includes(ci)) c.alignment = { horizontal: "right" };
      if ([2, 6].includes(ci)) c.alignment = { wrapText: true };
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

function addSheetMasterItemDipakai(
  wb: ExcelJS.Workbook,
  est: EstimationWithRelations
) {
  const ws = wb.addWorksheet("Master Item Dipakai", {
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
    { header: "Kode", key: "code", width: 18 },
    { header: "Nama", key: "name", width: 40 },
    { header: "Satuan", key: "unit", width: 12 },
    { header: "Tipe", key: "type", width: 16 },
    {
      header: "Harga (Master)",
      key: "price",
      width: 18,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
    { header: "Dipakai di HSP (unik)", key: "usedIn", width: 18 },
    {
      header: "Total Subtotal di AHSP",
      key: "sum",
      width: 22,
      style: { numFmt: NUMFMT_IDR, alignment: { horizontal: "right" } },
    },
    { header: "Catatan", key: "notes", width: 28 },
  ];

  addTitleBarAuto(ws, "Master Item Dipakai");

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

  type Agg = {
    code: string;
    name: string;
    unit: string;
    type: string;
    price: number;
    usedHsp: Set<string>;
    sumSubtotal: number;
    notes?: string | null;
  };
  const agg = new Map<string, Agg>();

  for (const sec of est.items) {
    for (const d of sec.details) {
      const h = d.hspItem;
      if (!h || !h.ahsp) continue;
      const hspCode = h.kode || "";

      for (const c of h.ahsp.components || []) {
        const m = c.masterItem;
        if (!m) continue;
        const id = m.id;
        const eff = N(c.effectiveUnitPrice ?? c.priceOverride ?? m.price, 0);
        const sub = N(c.subtotal, N(c.coefficient, 1) * eff);

        if (!agg.has(id)) {
          agg.set(id, {
            code: m.code,
            name: c.nameSnapshot || m.name,
            unit: c.unitSnapshot || m.unit,
            type: String(m.type),
            price: N(m.price, 0),
            usedHsp: new Set<string>(),
            sumSubtotal: 0,
            notes: m.notes ?? undefined,
          });
        }
        const a = agg.get(id)!;
        a.usedHsp.add(hspCode);
        a.sumSubtotal += sub;
      }
    }
  }

  const rows = [...agg.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => [
      a.code,
      a.name,
      a.unit,
      a.type,
      a.price,
      a.usedHsp.size,
      a.sumSubtotal,
      a.notes || "",
    ]);
  if (rows.length) ws.addRows(rows);

  const dataStart = 3;
  for (let r = dataStart; r < dataStart + rows.length; r++) {
    const row = ws.getRow(r);
    row.eachCell((c, ci) => {
      c.border = BORDER_THIN as any;
      if ([5, 7].includes(ci)) c.alignment = { horizontal: "right" };
      if ([2, 8].includes(ci)) c.alignment = { wrapText: true };
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
    sRAB.mergeCells(`A${currentRow}:F${currentRow}`);
    const secCell = sRAB.getCell(`A${currentRow}`);
    secCell.value = `${roman(sIdx + 1)}    ${section.title.toUpperCase()}`; // 4 spasi
    secCell.font = FONT.h2 as any;
    secCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.lightBlue },
    };
    secCell.border = BORDER_THIN as any;
    secCell.alignment = { horizontal: "left" };
    currentRow++;

    let no = 1;
    let subtotal = 0;

    (section.details || []).forEach((d) => {
      const jumlah =
        (typeof d.hargaTotal === "number" ? d.hargaTotal : undefined) ??
        Number(d.volume || 0) * Number(d.hargaSatuan || 0);
      const safeJumlah = Number.isFinite(jumlah) ? Number(jumlah) : 0;

      const r = sRAB.getRow(currentRow++);
      r.getCell(1).value = no++;
      r.getCell(2).value = d.deskripsi || "-";
      r.getCell(3).value = d.satuan || "-";
      r.getCell(4).value = Number(d.volume || 0);
      r.getCell(5).value = Number(d.hargaSatuan || 0);
      r.getCell(6).value = safeJumlah;

      subtotal += safeJumlah;

      [1, 2, 3, 4, 5, 6].forEach(
        (c) => (r.getCell(c).border = BORDER_THIN as any)
      );
      r.getCell(2).alignment = { wrapText: true };
      r.getCell(4).alignment = { horizontal: "right" };
      r.getCell(5).numFmt = NUMFMT_IDR;
      r.getCell(6).numFmt = NUMFMT_IDR;

      if ((no - 1) % 2 === 0)
        r.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.zebra },
        };
    });

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
    totCell.value = subtotal;
    totCell.font = { ...(FONT.base as any), bold: true };
    totCell.numFmt = NUMFMT_IDR;
    totCell.alignment = { horizontal: "right" };
    totCell.border = BORDER_THIN as any;

    currentRow++;
  });

  /** ========= Sheet lain (tanpa logo + judul auto) ========= */
  addSheetKategoriDipakai(wb, est);
  addSheetJobItemDipakai(wb, est);
  addSheetVolume(wb, est);
  addSheetAHSPDipakai(wb, est);
  addSheetMasterItemDipakai(wb, est);

  wb.worksheets.forEach((sh) => {
    sh.eachRow((row) =>
      row.eachCell((cell) => (cell.font = cell.font || (FONT.base as any)))
    );
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
