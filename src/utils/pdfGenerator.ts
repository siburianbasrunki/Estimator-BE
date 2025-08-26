// src/utils/pdfGenerator.ts
import PdfPrinter from "pdfmake";
import dayjs from "dayjs";
import path from "path";
import type {
  Estimation,
  EstimationItem,
  ItemDetail,
  CustomField,
  User,
} from "@prisma/client";
import { calcTotals } from "./exportHelpers";

type EstimationWithRelations = Estimation & {
  author: Pick<User, "id" | "name" | "email">;
  customFields: CustomField[];
  items: (EstimationItem & { details: ItemDetail[] })[];
};

type LogoOpt = { dataUrl: string; width?: number; height?: number };
type OrgOpt = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
};

export type BuildPdfOptions = {
  logo?: LogoOpt;
  org?: OrgOpt;
  landscape?: boolean;
  titleOverride?: string;
};

// Helper
const roman = (n: number) => {
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let r = "", x = Math.max(1, Math.floor(n));
  for (const [v, s] of map) while (x >= v) { r += s; x -= v; }
  return r;
};
const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(Number(n || 0));

// Printer pakai built-in Helvetica
const fonts = { Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } };
const printer = new PdfPrinter(fonts);

export async function buildEstimationPdf(
  est: EstimationWithRelations,
  opts?: BuildPdfOptions
): Promise<Buffer> {
  const landscape = opts?.landscape ?? true;
  const title = opts?.titleOverride ?? "Rencana Anggaran Biaya";

  // Kop header
  const kop = {
    columns: [
      opts?.logo?.dataUrl
        ? { image: opts.logo.dataUrl, width: opts.logo.width ?? 90, height: opts.logo.height ?? 30 }
        : { text: "" },
      {
        stack: [
          { text: opts?.org?.name ?? "", bold: true, fontSize: 12 },
          { text: opts?.org?.address ?? "", fontSize: 9 },
          { text: opts?.org?.phone ?? "", fontSize: 9 },
          { text: opts?.org?.email ?? "", fontSize: 9 },
          { text: opts?.org?.website ?? "", fontSize: 9 },
        ],
        alignment: "right",
      },
    ],
  };

  // Info proyek
  const infoRows = [
    ["Nama Proyek", est.projectName],
    ["Pemilik Proyek", est.projectOwner],
    ["PPN", `${est.ppn}%`],
    ["Status", est.status],
    ["Dibuat", dayjs(est.createdAt).format("DD MMM YYYY HH:mm")],
    ["Diupdate", dayjs(est.updatedAt).format("DD MMM YYYY HH:mm")],
    ["Catatan", est.notes || "-"],
  ];

  const infoTable = {
    table: {
      widths: ["30%", "70%"],
      body: infoRows.map(([a, b]) => [{ text: a, bold: true }, String(b)]),
    },
    margin: [0, 10, 0, 10],
  };

  // Tabel RAB
  const body: any[] = [
    [
      { text: "No", style: "th", rowSpan: 2 },
      { text: "Uraian Pekerjaan", style: "th", rowSpan: 2 },
      { text: "Satuan", style: "th", rowSpan: 2 },
      { text: "Volume", style: "th", rowSpan: 2 },
      { text: "Harga (Rp)", style: "th", colSpan: 2 }, {},
    ],
    ["", "", "", "", { text: "Satuan (Rp)", style: "th" }, { text: "Jumlah (Rp)", style: "th" }],
  ];

  est.items.forEach((section, sIdx) => {
    body.push([{ text: `${roman(sIdx + 1)} ${section.title.toUpperCase()}`, colSpan: 6, bold: true, fillColor: "#E0F2FE" }, {}, {}, {}, {}, {}]);
    let no = 1; let subtotal = 0;
    (section.details || []).forEach((d) => {
      const jumlah = Number(d.hargaTotal ?? (Number(d.volume) * Number(d.hargaSatuan))) || 0;
      subtotal += jumlah;
      body.push([
        { text: String(no++), alignment: "center" },
        d.deskripsi || "-",
        d.satuan || "-",
        String(d.volume || 0),
        { text: idr(Number(d.hargaSatuan || 0)), alignment: "right" },
        { text: idr(jumlah), alignment: "right" },
      ]);
    });
    body.push([
      { text: "", colSpan: 4 }, {}, {}, {},
      { text: `Jumlah ${roman(sIdx + 1)}`, bold: true, alignment: "right" },
      { text: idr(subtotal), bold: true, alignment: "right" },
    ]);
  });

  const { subtotal, ppnAmount, grandTotal } = calcTotals(est as any);

  const ringkasan = {
    table: {
      widths: ["60%", "40%"],
      body: [
        [{ text: "Ringkasan Biaya", colSpan: 2, bold: true, fillColor: "#E0F2FE" }, {}],
        ["Subtotal", { text: idr(subtotal), alignment: "right" }],
        [`PPN (${est.ppn}%)`, { text: idr(ppnAmount), alignment: "right" }],
        [{ text: "Grand Total", bold: true }, { text: idr(grandTotal), bold: true, alignment: "right" }],
      ],
    },
    margin: [0, 10, 0, 0],
  };

  const docDefinition: any = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [36, 80, 36, 48],
    header: [kop, { canvas: [{ type: "line", x1: 0, y1: 0, x2: 760, y2: 0, lineWidth: 1 }] }, { text: title, alignment: "center", bold: true, margin: [0, 8] }],
    footer: (current: number, total: number) =>
      ({ columns: [{ text: dayjs().format("DD MMM YYYY HH:mm"), fontSize: 8 }, { text: `Hal. ${current}/${total}`, alignment: "right", fontSize: 8 }], margin: [36, 0, 36, 20] }),
    content: [
      infoTable,
      { table: { headerRows: 2, widths: [25, "*", 50, 50, 80, 90], body }, layout: "lightHorizontalLines" },
      ringkasan,
    ],
    styles: {
      th: { bold: true, color: "white", fillColor: "#0284C7", alignment: "center" },
    },
    defaultStyle: { font: "Helvetica", fontSize: 9 },
  };

  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    pdfDoc.on("data", (d) => chunks.push(d));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
