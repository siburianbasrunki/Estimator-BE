// utils/pdfGenerator.ts
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
import { renderPdfBuffer } from "./pdf-finalize";

// =========================
// Types with deep include
// =========================
export type EstimationDetailWithMore = ItemDetail & {
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

export type EstimationWithRelations = Estimation & {
  author: Pick<User, "id" | "name" | "email">;
  customFields: CustomField[];
  items: (EstimationItem & { details: EstimationDetailWithMore[] })[];
};

// =========================
// Helpers & styles
// =========================
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
  for (const [v, s] of map) while (x >= v) ((r += s), (x -= v));
  return r;
};
const N = (v: any, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

// Layout grid tegas untuk semua tabel (dengan zebra by default)
const gridLayout = {
  defaultBorder: true,
  hLineWidth: (i: number, node: any) =>
    i === 0 || i === node.table.body.length ? 1.2 : 0.6,
  vLineWidth: (i: number, node: any) =>
    i === 0 || i === node.table.widths.length ? 1.2 : 0.6,
  hLineColor: () => "#94A3B8",
  vLineColor: () => "#94A3B8",
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 6,
  paddingBottom: () => 6,
  fillColor: (rowIndex: number, node: any) => {
    const headerRows = node.table.headerRows || 0;
    if (rowIndex < headerRows) return undefined;
    return rowIndex % 2 === 0 ? "#F8FAFC" : undefined;
  },
};
// Layout tanpa zebra
const gridLayoutNoZebra = { ...gridLayout, fillColor: undefined };

export type BuildPdfOptions = {
  logo?: { dataUrl: string; width?: number; height?: number };
  org?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  landscape?: boolean;
  titleOverride?: string;
  includeAhsp?: boolean;
  includeVolume?: boolean;
};

export async function buildEstimationPdf(
  est: EstimationWithRelations,
  opts?: BuildPdfOptions
): Promise<Buffer> {
  const landscape = opts?.landscape ?? true;
  const title = opts?.titleOverride ?? "Rencana Anggaran Biaya";
  const includeAhsp = opts?.includeAhsp ?? true;
  const includeVolume = opts?.includeVolume ?? true;

  // =========================
  // Header (logo + org info)
  // =========================
  const headerNode = {
    margin: [36, 20, 36, 10],
    stack: [
      {
        table: {
          widths: [100, "*", 220],
          body: [
            [
              opts?.logo?.dataUrl
                ? {
                    image: opts.logo.dataUrl,
                    fit: [100, 40],
                    alignment: "left",
                  }
                : { text: "" },
              {
                text: title,
                bold: true,
                fontSize: 22,
                alignment: "center",
                margin: [0, 4, 0, 0],
              },
              {
                stack: [
                  { text: opts?.org?.name ?? "", bold: true, fontSize: 12 },
                  { text: opts?.org?.address ?? "", fontSize: 9 },
                  { text: opts?.org?.phone ?? "", fontSize: 9 },
                  { text: opts?.org?.email ?? "", fontSize: 9 },
                  { text: opts?.org?.website ?? "", fontSize: 9 },
                ].filter((x) => (x as any).text),
                alignment: "right",
              },
            ],
          ],
        },
        layout: "noBorders" as const,
      },
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: 760, y2: 0, lineWidth: 1 }],
        margin: [0, 10, 0, 0],
      },
    ],
  };

  // =========================
  // Info proyek
  // =========================
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

  // =========================
  // Tabel RAB
  // =========================
  const rabBody: any[] = [
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
    rabBody.push([
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
      rabBody.push([
        { text: String(no++), alignment: "center" },
        d.deskripsi || "-",
        d.satuan || "-",
        String(d.volume || 0),
        { text: idr(Number(d.hargaSatuan || 0)), alignment: "right" },
        { text: idr(jumlah), alignment: "right" },
      ]);
    });
    rabBody.push([
      { text: "", colSpan: 4 },
      {},
      {},
      {},
      { text: `Jumlah ${roman(sIdx + 1)}`, bold: true, alignment: "right" },
      { text: idr(subtotal), bold: true, alignment: "right" },
    ]);
  });

  const { subtotal, ppnAmount, grandTotal } = calcTotals(est as any);

  // =========================
  // AHSP Section (opsional)
  // =========================
  const ahspBlocks: any[] = [];
  const uniqHsp = new Map<
    string,
    HSPItem & {
      ahsp?:
        | (AHSPRecipe & {
            components: (AHSPComponent & { masterItem: MasterItem })[];
          })
        | null;
    }
  >();
  for (const it of est.items) {
    for (const d of it.details || []) {
      if (d.hspItem && !uniqHsp.has(d.hspItem.id))
        uniqHsp.set(d.hspItem.id, d.hspItem as any);
    }
  }
  const blocks = [...uniqHsp.values()].sort((a, b) =>
    (a.kode || "").localeCompare(b.kode || "")
  );

  let idx = 1;
  for (const h of blocks) {
    const kode = h.kode || "";
    const desk = h.deskripsi || "-";
    const sat = h.satuan || "-";
    const recipe = h.ahsp || null;

    const compsAll = (recipe?.components || []).filter(
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
      compsAll.filter((c) => c.group === g).reduce((acc, c) => acc + sub(c), 0);

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

    ahspBlocks.push({
      table: {
        headerRows: 1,
        widths: [25, 90, "*", 60, 110],
        body: [
          [
            { text: "No", style: "th" },
            { text: "Kode", style: "th" },
            { text: "Deskripsi", style: "th" },
            { text: "Satuan", style: "th" },
            { text: "Harga Satuan (Rp.)", style: "th" },
          ],
          [
            { text: String(idx++), bold: true, alignment: "center" },
            { text: kode },
            { text: desk },
            { text: sat, alignment: "center" },
            { text: idr(finalUnitPrice), alignment: "right", bold: true },
          ],
        ],
      },
      layout: gridLayoutNoZebra,
      margin: [0, 14, 0, 6],
    });

    const breakdownBody: any[] = [
      [
        { text: "No", style: "th" },
        { text: "Uraian", style: "th" },
        { text: "Kode", style: "th" },
        { text: "Satuan", style: "th" },
        { text: "Koefisien", style: "th" },
        { text: "Harga Satuan (Rp.)", style: "th" },
        { text: "Jumlah Harga (Rp.)", style: "th" },
      ],
    ];
    const GROUPS: Array<{
      key: AHSPComponentGroup;
      label: string;
      letter: string;
      subtotalLabel: string;
    }> = [
      {
        key: "LABOR",
        label: "TENAGA",
        letter: "A",
        subtotalLabel: "JUMLAH TENAGA KERJA",
      },
      {
        key: "MATERIAL",
        label: "BAHAN",
        letter: "B",
        subtotalLabel: "JUMLAH HARGA BAHAN",
      },
      {
        key: "EQUIPMENT",
        label: "PERALATAN",
        letter: "C",
        subtotalLabel: "JUMLAH HARGA ALAT",
      },
    ];

    for (const G of GROUPS) {
      breakdownBody.push([
        {
          text: G.letter,
          bold: true,
          alignment: "center",
          fillColor: "#E0F2FE",
        },
        { text: G.label, bold: true, colSpan: 6, fillColor: "#E0F2FE" },
        {},
        {},
        {},
        {},
        {},
      ]);
      const comps = compsAll.filter((c) => c.group === G.key);
      for (const c of comps) {
        breakdownBody.push([
          { text: "" },
          { text: c.nameSnapshot || c.masterItem?.name || "-" },
          { text: c.masterItem?.code || "" },
          {
            text: c.unitSnapshot || c.masterItem?.unit || "",
            alignment: "center",
          },
          { text: String(N(c.coefficient, 1)), alignment: "right" },
          { text: idr(eff(c)), alignment: "right" },
          {
            text: idr(N(c.subtotal, N(c.coefficient, 1) * eff(c))),
            alignment: "right",
          },
        ]);
      }
      const sum = comps.reduce(
        (acc, c) => acc + N(c.subtotal, N(c.coefficient, 1) * eff(c)),
        0
      );
      breakdownBody.push([
        { text: "" },
        { text: G.subtotalLabel, colSpan: 5, alignment: "right", bold: true },
        {},
        {},
        {},
        {},
        {
          text: sum ? idr(sum) : "-",
          alignment: sum ? "right" : "center",
          bold: true,
        },
      ]);
    }

    breakdownBody.push([
      { text: "D", bold: true, alignment: "center" },
      { text: "Jumlah (A+B+C)", colSpan: 5, alignment: "right", bold: true },
      {},
      {},
      {},
      {},
      {
        text: subtotalABC ? idr(subtotalABC) : "-",
        alignment: subtotalABC ? "right" : "center",
        bold: true,
      },
    ]);
    breakdownBody.push([
      { text: "E", bold: true, alignment: "center" },
      {
        text: `Overhead & Profit ${ohPct}%`,
        colSpan: 5,
        alignment: "right",
        bold: true,
      },
      {},
      {},
      {},
      {},
      {
        text: overheadAmount ? idr(overheadAmount) : "-",
        alignment: overheadAmount ? "right" : "center",
        bold: true,
      },
    ]);
    breakdownBody.push([
      { text: "F", bold: true, alignment: "center" },
      {
        text: "Harga Satuan Pekerjaan (D+E)",
        colSpan: 5,
        alignment: "right",
        bold: true,
      },
      {},
      {},
      {},
      {},
      {
        text: finalUnitPrice ? idr(finalUnitPrice) : "-",
        alignment: finalUnitPrice ? "right" : "center",
        bold: true,
      },
    ]);

    ahspBlocks.push({
      table: {
        headerRows: 1,
        widths: [25, "*", 90, 55, 65, 100, 110],
        body: breakdownBody,
      },
      layout: gridLayout,
      margin: [0, 4, 0, 16],
    });
  }

  // =========================
  // Volume Section (opsional)
  // =========================
  const volumeRows: any[] = [
    [
      { text: "Item Pekerjaan", style: "th" },
      { text: "Breakdown Volume Dipakai", style: "th" },
    ],
  ];
  for (const sec of est.items) {
    for (const d of sec.details || []) {
      const vols = d.volumeDetails || [];
      if (!vols.length) continue;
      const job = d.deskripsi || d.hspItem?.deskripsi || "-";
      const sat = d.satuan || d.hspItem?.satuan || "-";
      const lines = vols.map((v) => {
        const sign = v.jenis === "SUB" ? "-" : "+";
        const P = N(v.panjang),
          L = N(v.lebar),
          T = N(v.tinggi),
          J = N(v.jumlah),
          V = N(v.volume);
        const nm = v.nama || "-";
        return `${sign} ${nm}: ${P}×${L}×${T}×${J} = ${V} ${sat}`;
      });
      volumeRows.push([{ text: job }, { text: lines.join("\n") }]);
    }
  }

  // =========================
  // Assemble document
  // =========================
  const contentNodes: any[] = [
    infoTable,
    {
      table: {
        headerRows: 2,
        widths: [25, "*", 50, 50, 80, 90],
        body: rabBody,
      },
      layout: gridLayout,
    },
    {
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
    },
  ];

  if (includeAhsp) {
    contentNodes.push(
      {
        text: "AHSP",
        bold: true,
        fontSize: 16,
        margin: [0, 16, 0, 6],
        pageBreak: "before",
      },
      ...ahspBlocks
    );
  }
  if (includeVolume) {
    contentNodes.push(
      {
        text: "Volume",
        bold: true,
        fontSize: 16,
        margin: [0, 16, 0, 6],
        pageBreak: "before",
      },
      {
        table: { headerRows: 1, widths: ["35%", "65%"], body: volumeRows },
        layout: gridLayout,
      }
    );
  }

  const docDefinition: any = {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [36, 100, 36, 48],
    header: (currentPage: number) => (currentPage === 1 ? headerNode : {}),
    footer: (current: number, total: number) => ({
      columns: [
        { text: dayjs().format("DD MMM YYYY HH:mm"), fontSize: 8 },
        { text: `Hal. ${current}/${total}`, alignment: "right", fontSize: 8 },
      ],
      margin: [36, 0, 36, 20],
    }),
    content: contentNodes,
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

  // ⬇️ Render via pdf-finalize
  const allowImages = Boolean(opts?.logo?.dataUrl); // hanya izinkan gambar kalau ada logo yang valid
  return await renderPdfBuffer(docDefinition, { allowImages });
}
