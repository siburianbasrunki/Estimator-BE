// src/utils/pdfGenerator.ts
import PdfPrinter from "pdfmake";
import dayjs from "dayjs";
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
const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

// Printer pakai built-in Helvetica
const fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};
const printer = new PdfPrinter(fonts);

// Layout grid tegas untuk semua tabel
const gridLayout = {
  defaultBorder: true,
  // Garis horizontal: tebal di tepi, sedang di tengah
  hLineWidth: (i: number, node: any) =>
    i === 0 || i === node.table.body.length ? 1.2 : 0.6,
  // Garis vertikal: tebal di tepi, sedang di tengah
  vLineWidth: (i: number, node: any) =>
    i === 0 || i === node.table.widths.length ? 1.2 : 0.6,
  hLineColor: () => "#94A3B8", // slate-400
  vLineColor: () => "#94A3B8",
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 6,
  paddingBottom: () => 6,
  // Zebra-striping untuk tabel RAB (abaikan 2 baris header)
  fillColor: (rowIndex: number, node: any) => {
    if (node.table.headerRows && rowIndex < node.table.headerRows)
      return undefined;
    return rowIndex % 2 === 0 ? "#F8FAFC" : undefined; // slate-50
  },
};

// Layout grid tanpa zebra (untuk Info & Ringkasan)
const gridLayoutNoZebra = {
  ...gridLayout,
  fillColor: undefined,
};

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
        ? {
            image: opts.logo.dataUrl,
            width: opts.logo.width ?? 90,
            height: opts.logo.height ?? 30,
          }
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
  const infoRows: [string, any][] = [
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
    layout: gridLayoutNoZebra,
    margin: [0, 10, 0, 10],
  };

  // Tabel RAB
  const body: any[] = [
    [
      { text: "No", style: "th", rowSpan: 2 },
      { text: "Uraian Pekerjaan", style: "th", rowSpan: 2 },
      { text: "Satuan", style: "th", rowSpan: 2 },
      { text: "Volume", style: "th", rowSpan: 2 },
      { text: "Harga (Rp)", style: "th", colSpan: 2 },
      {},
    ],
    [
      "",
      "",
      "",
      "",
      { text: "Satuan (Rp)", style: "th" },
      { text: "Jumlah (Rp)", style: "th" },
    ],
  ];

  est.items.forEach((section, sIdx) => {
    body.push([
      {
        text: `${roman(sIdx + 1)} ${section.title.toUpperCase()}`,
        colSpan: 6,
        bold: true,
        fillColor: "#E0F2FE",
      },
      {},
      {},
      {},
      {},
      {},
    ]);
    let no = 1;
    let subtotal = 0;
    (section.details || []).forEach((d) => {
      const jumlah =
        Number(d.hargaTotal ?? Number(d.volume) * Number(d.hargaSatuan)) || 0;
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
      { text: "", colSpan: 4 },
      {},
      {},
      {},
      { text: `Jumlah ${roman(sIdx + 1)}`, bold: true, alignment: "right" },
      { text: idr(subtotal), bold: true, alignment: "right" },
    ]);
  });

  const { subtotal, ppnAmount, grandTotal } = calcTotals(est as any);

  const ringkasan = {
    table: {
      widths: ["60%", "40%"],
      body: [
        [
          {
            text: "Ringkasan Biaya",
            colSpan: 2,
            bold: true,
            fillColor: "#E0F2FE",
          },
          {},
        ],
        ["Subtotal", { text: idr(subtotal), alignment: "right" }],
        [`PPN (${est.ppn}%)`, { text: idr(ppnAmount), alignment: "right" }],
        [
          { text: "Grand Total", bold: true },
          { text: idr(grandTotal), bold: true, alignment: "right" },
        ],
      ],
      headerRows: 1,
    },
    layout: gridLayoutNoZebra,
    margin: [0, 10, 0, 0],
  };

  const docDefinition: any = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [36, 100, 36, 48], // ruang atas cukup untuk header page 1

    header: (currentPage: number, pageCount: number) => {
      if (currentPage !== 1) return {}; // header hanya di halaman 1

      // Elemen logo: scaled contain
      const logoEl = opts?.logo?.dataUrl
        ? {
            image: opts.logo.dataUrl,
            fit: [100, 40], // ⟵ contain ke max 100x40, proporsional
            alignment: "left",
          }
        : {
            text: "", // ⟵ tanpa logo, tetap sediakan kolom kiri
            width: 100,
          };

      // Org info kanan (opsional)
      const orgRight = {
        stack: [
          { text: opts?.org?.name ?? "", bold: true, fontSize: 12 },
          { text: opts?.org?.address ?? "", fontSize: 9 },
          { text: opts?.org?.phone ?? "", fontSize: 9 },
          { text: opts?.org?.email ?? "", fontSize: 9 },
          { text: opts?.org?.website ?? "", fontSize: 9 },
        ].filter((x) => x.text), // buang yang kosong biar rapih
        alignment: "right",
      };

      return {
        margin: [36, 20, 36, 10],
        stack: [
          {
            table: {
              widths: [100, "*", 220], // kiri logo fix 100, tengah fleksibel, kanan fix 220
              body: [
                [
                  logoEl,
                  {
                    text: title,
                    bold: true,
                    fontSize: 22, // ⟵ judul dibesarkan
                    alignment: "center", // ⟵ di tengah kolom tengah (yang lebar)
                    margin: [0, 4, 0, 0],
                  },
                  orgRight,
                ],
              ],
            },
            layout: "noBorders",
          },
          {
            canvas: [
              { type: "line", x1: 0, y1: 0, x2: 760, y2: 0, lineWidth: 1 },
            ],
            margin: [0, 10, 0, 0],
          },
        ],
      };
    },

    footer: (current: number, total: number) => ({
      columns: [
        { text: dayjs().format("DD MMM YYYY HH:mm"), fontSize: 8 },
        { text: `Hal. ${current}/${total}`, alignment: "right", fontSize: 8 },
      ],
      margin: [36, 0, 36, 20],
    }),

    content: [
      infoTable,
      {
        table: { headerRows: 2, widths: [25, "*", 50, 50, 80, 90], body },
        layout: gridLayout,
      },
      ringkasan,
    ],
    styles: {
      th: {
        bold: true,
        color: "white",
        fillColor: "#0284C7",
        alignment: "center",
      },
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
