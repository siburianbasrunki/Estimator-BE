// src/utils/pdfAhsp.ts
import dayjs from "dayjs";
import { renderPdfBuffer } from "./pdf-finalize";

// Logo format (konsisten dengan utils/pdfTable.ts)
export type LogoOpt =
  | { dataUrl: string; width?: number; height?: number }
  | {
      base64: string;
      extension: "png" | "jpeg";
      width?: number;
      height?: number;
    }
  | string
  | undefined;

type AHSPComponentGroup = "LABOR" | "MATERIAL" | "EQUIPMENT";

export type MasterLike = {
  id: string;
  code: string;
  name: string;
  unit: string;
  price?: number | null;
  notes?: string | null;
};

export type ComponentLike = {
  group: AHSPComponentGroup;
  nameSnapshot?: string | null;
  unitSnapshot?: string | null;
  unitPriceSnapshot?: number | null;
  priceOverride?: number | null;
  effectiveUnitPrice?: number | null;
  coefficient?: number | null;
  subtotal?: number | null;
  masterItem?: MasterLike | null;
};

export type RecipeLike = {
  components?: ComponentLike[];
  subtotalABC?: number | null;
  overheadPercent?: number | null;
  overheadAmount?: number | null;
  finalUnitPrice?: number | null;
};

export type HSPLike = {
  id: string;
  kode?: string | null;
  deskripsi?: string | null;
  satuan?: string | null;
  ahsp?: RecipeLike | null;
};

export type BuildAhspPdfInput = {
  title: string;        // "AHSP Dipakai"
  subtitle?: string;    // project • owner
  blocks: Array<{ hsp: HSPLike }>;
  logo?: LogoOpt;
  pageSize?: "A4" | "A3" | "LEGAL";
  landscape?: boolean;
  condense?: boolean;
};

const COLORS = {
  headerBlue: "#0284C7",
  lightBlue: "#E0F2FE",
  zebra: "#F8FAFC",
  border: "#94A3B8",
};

function isDataImageUrl(s: string | undefined | null): s is string {
  return typeof s === "string" && /^data:image\/(png|jpe?g);base64,/i.test(s);
}
function normalizeLogo(
  logo?: LogoOpt
): { dataUrl: string; width?: number; height?: number } | undefined {
  if (!logo) return undefined;
  if (typeof logo === "string") {
    if (isDataImageUrl(logo)) return { dataUrl: logo };
    return undefined;
  }
  if ("dataUrl" in (logo as any) && typeof (logo as any).dataUrl === "string") {
    const lu = (logo as any).dataUrl as string;
    if (isDataImageUrl(lu)) {
      return {
        dataUrl: lu,
        width: (logo as any).width,
        height: (logo as any).height,
      };
    }
    return undefined;
  }
  if ("base64" in (logo as any) && "extension" in (logo as any)) {
    const base64 = (logo as any).base64 as string;
    const ext = (logo as any).extension as "png" | "jpeg";
    const prefix = `data:image/${ext};base64,`;
    const dataUrl = `${prefix}${base64.replace(/^data:image\/[a-z+]+;base64,/, "")}`;
    if (isDataImageUrl(dataUrl)) {
      return {
        dataUrl,
        width: (logo as any).width,
        height: (logo as any).height,
      };
    }
  }
  return undefined;
}

const N = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function eff(c: ComponentLike) {
  return N(
    c.effectiveUnitPrice ?? c.priceOverride ?? c.unitPriceSnapshot ?? c.masterItem?.price,
    0
  );
}
function sub(c: ComponentLike) {
  return N(c.subtotal, N(c.coefficient, 1) * eff(c));
}

export async function buildAhspPdf(opts: BuildAhspPdfInput): Promise<Buffer> {
  const pageSize = opts.pageSize ?? "LEGAL";
  const landscape = opts.landscape ?? true;
  const margins: [number, number, number, number] = [24, 24, 24, 24];
  const baseFont = opts.condense ? 8 : 9;
  const safeLogo = normalizeLogo(opts.logo);

  // Header
  const headerTitle = {
    table: {
      widths: [100, "*", 220],
      body: [
        [
          safeLogo
            ? { image: safeLogo.dataUrl, fit: [100, 40], alignment: "left" }
            : { text: "" },
          {
            stack: [
              {
                text: opts.title,
                bold: true,
                fontSize: Math.max(baseFont + 10, 18),
                alignment: "center",
              },
              ...(opts.subtitle
                ? [
                    {
                      text: opts.subtitle,
                      fontSize: baseFont + 1,
                      alignment: "center",
                      margin: [0, 4, 0, 0],
                    },
                  ]
                : []),
            ],
          },
          {
            text: dayjs().format("DD MMM YYYY HH:mm"),
            fontSize: baseFont,
            alignment: "right",
          },
        ],
      ],
    },
    layout: "noBorders" as const,
    margin: [36, 20, 36, 10],
  };

  const headerLine = {
    canvas: [
      {
        type: "line",
        x1: margins[0],
        y1: 0,
        x2: 842, // cukup panjang; pdfmake auto fit
        y2: 0,
        lineWidth: 1,
        lineColor: COLORS.border,
      },
    ],
    margin: [0, 6, 0, 12],
  };

  // Styles
  const styles = {
    tblHeader: { color: "white", bold: true, fontSize: baseFont },
    zebra: { fillColor: COLORS.zebra },
    light: { fillColor: COLORS.lightBlue, bold: true },
    right: { alignment: "right" as const },
    center: { alignment: "center" as const },
    left: { alignment: "left" as const },
    small: { fontSize: baseFont },
    bold: { bold: true },
  };

  // Tabel “header breakdown”
  const breakdownHeaderRow = [
    { text: "No", style: "tblHeader", alignment: "center" },
    { text: "Uraian", style: "tblHeader", alignment: "center" },
    { text: "Kode", style: "tblHeader", alignment: "center" },
    { text: "Satuan", style: "tblHeader", alignment: "center" },
    { text: "Koefisien", style: "tblHeader", alignment: "center" },
    { text: "Harga Satuan (Rp.)", style: "tblHeader", alignment: "center" },
    { text: "Jumlah Harga (Rp.)", style: "tblHeader", alignment: "center" },
  ];

  const groups: Array<{ key: AHSPComponentGroup; letter: "A" | "B" | "C"; title: string; subLabel: string; }> = [
    { key: "LABOR", letter: "A", title: "TENAGA",    subLabel: "JUMLAH TENAGA KERJA" },
    { key: "MATERIAL", letter: "B", title: "BAHAN",  subLabel: "JUMLAH HARGA BAHAN" },
    { key: "EQUIPMENT", letter: "C", title: "PERALATAN", subLabel: "JUMLAH HARGA ALAT" },
  ];

  const content: any[] = [headerTitle, headerLine];

  // Untuk setiap HSP (blok)
  let hspIdx = 1;
  for (const { hsp } of opts.blocks) {
    const kode = hsp.kode || "";
    const desk = hsp.deskripsi || "-";
    const sat = hsp.satuan || "-";
    const recipe = hsp.ahsp || null;

    const comps = (recipe?.components || []).filter(
      (c) => c.group === "LABOR" || c.group === "MATERIAL" || c.group === "EQUIPMENT"
    );

    const sumGroup = (g: AHSPComponentGroup) =>
      comps.filter((c) => c.group === g).reduce((acc, c) => acc + sub(c), 0);

    const subtotalA = sumGroup("LABOR");
    const subtotalB = sumGroup("MATERIAL");
    const subtotalC = sumGroup("EQUIPMENT");
    const subtotalABC = N(recipe?.subtotalABC, subtotalA + subtotalB + subtotalC);

    const ohPct = N(recipe?.overheadPercent, 10);
    const overheadAmount = N(recipe?.overheadAmount, Math.round((ohPct / 100) * subtotalABC));
    const finalUnitPrice = N(recipe?.finalUnitPrice, subtotalABC + overheadAmount);

    // Ringkasan baris (No | Deskripsi | Kode | Satuan | "Harga Satuan (Rp.)" | nilai)
    content.push({
      table: {
        widths: [30, "*", 80, 50, 140, 100],
        body: [
          [
            { text: String(hspIdx++), style: ["bold", "center"], fillColor: COLORS.lightBlue },
            { text: desk, style: ["bold", "left"], fillColor: COLORS.lightBlue },
            { text: kode, style: ["bold", "center"], fillColor: COLORS.lightBlue },
            { text: sat, style: ["bold", "center"], fillColor: COLORS.lightBlue },
            { text: "Harga Satuan (Rp.)", style: ["bold", "center"], fillColor: COLORS.lightBlue },
            { text: finalUnitPrice ? finalUnitPrice.toLocaleString("id-ID") : "-", style: ["bold", "right"], fillColor: COLORS.lightBlue },
          ],
        ],
      },
      layout: {
        hLineColor: () => COLORS.border,
        vLineColor: () => COLORS.border,
      },
      margin: [0, 6, 0, 4],
      dontBreakRows: true,
      keepWithHeaderRows: 1,
    });

    // Header breakdown
    content.push({
      table: {
        headerRows: 1,
        widths: [30, "*", 70, 55, 60, 100, 110],
        body: [
          // header
          breakdownHeaderRow.map((c) => ({
            ...c,
            fillColor: COLORS.headerBlue,
            fontSize: baseFont,
          })),
        ],
      },
      layout: {
        hLineColor: () => COLORS.border,
        vLineColor: () => COLORS.border,
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 6,
        paddingBottom: () => 6,
      },
    });

    // Per grup A/B/C
    for (const g of groups) {
      // Baris judul grup
      content.push({
        table: {
          widths: [30, "*", 70, 55, 60, 100, 110],
          body: [
            [
              { text: g.letter, alignment: "center", bold: true, fillColor: COLORS.lightBlue },
              { text: g.title, bold: true, fillColor: COLORS.lightBlue, colSpan: 6, alignment: "left" },
              {}, {}, {}, {}, {},
            ],
          ],
        },
        layout: {
          hLineColor: () => COLORS.border,
          vLineColor: () => COLORS.border,
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
      });

      const rows: any[] = [];
      const compsG = comps.filter((c) => c.group === g.key);
      let zebra = false;
      for (const c of compsG) {
        zebra = !zebra;
        rows.push([
          { text: "", alignment: "center", fillColor: zebra ? COLORS.zebra : undefined },
          { text: c.nameSnapshot || c.masterItem?.name || "-", alignment: "left", fillColor: zebra ? COLORS.zebra : undefined },
          { text: c.masterItem?.code || "", alignment: "center", fillColor: zebra ? COLORS.zebra : undefined },
          { text: c.unitSnapshot || c.masterItem?.unit || "", alignment: "center", fillColor: zebra ? COLORS.zebra : undefined },
          { text: N(c.coefficient, 1).toLocaleString("id-ID"), alignment: "right", fillColor: zebra ? COLORS.zebra : undefined },
          { text: eff(c).toLocaleString("id-ID"), alignment: "right", fillColor: zebra ? COLORS.zebra : undefined },
          { text: sub(c).toLocaleString("id-ID"), alignment: "right", fillColor: zebra ? COLORS.zebra : undefined },
        ]);
      }

      // Tambahkan rincian jika ada
      if (rows.length) {
        content.push({
          table: {
            widths: [30, "*", 70, 55, 60, 100, 110],
            body: rows,
          },
          layout: {
            hLineColor: () => COLORS.border,
            vLineColor: () => COLORS.border,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
        });
      }

      // Subtotal per grup
      const sum = compsG.reduce((acc, c) => acc + sub(c), 0);
      content.push({
        table: {
          widths: [30, "*", 70, 55, 60, 100, 110],
          body: [
            [
              { text: "", border: [true, true, false, true] },
              { text: "", border: [false, true, false, true] },
              { text: g.subLabel, colSpan: 3, alignment: "right", bold: true, border: [false, true, false, true] },
              {},
              {},
              { text: "", border: [false, true, false, true] },
              { text: sum ? sum.toLocaleString("id-ID") : "-", alignment: sum ? "right" : "center", bold: true, border: [false, true, true, true] },
            ],
          ],
        },
        layout: {
          hLineColor: () => COLORS.border,
          vLineColor: () => COLORS.border,
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 4],
      });
    }

    // D, E, F
    const rowsDEF = [
      { label: "Jumlah (A+B+C)", value: subtotalABC },
      { label: `Overhead & Profit ${ohPct}%`, value: overheadAmount },
      { label: "Harga Satuan Pekerjaan ", value: finalUnitPrice },
    ];

    content.push({
      table: {
        widths: [30, "*", 70, 55, 60, 100, 110],
        body: rowsDEF.map(({ label, value }) => [
          { text: "", border: [true, true, false, true] },
          { text: "", border: [false, true, false, true] },
          { text: label, colSpan: 3, alignment: "right", bold: true, border: [false, true, false, true] },
          {},
          {},
          { text: "", border: [false, true, false, true] },
          { text: value ? value.toLocaleString("id-ID") : "-", alignment: value ? "right" : "center", bold: true, border: [false, true, true, true] },
        ]),
      },
      layout: {
        hLineColor: () => COLORS.border,
        vLineColor: () => COLORS.border,
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: () => 6,
        paddingBottom: () => 6,
      },
      margin: [0, 0, 0, 10],
      dontBreakRows: true,
      keepWithHeaderRows: 1,
    });

    // Spasi antar blok
    content.push({ text: "", margin: [0, 4] });
  }

  const doc: any = {
    pageSize,
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: margins,
    content,
    defaultStyle: { font: "Helvetica", fontSize: baseFont },
    footer: (current: number, total: number) => ({
      columns: [
        { text: "", fontSize: baseFont - 1 },
        { text: `Hal. ${current}/${total}`, alignment: "right", fontSize: baseFont - 1 },
      ],
      margin: [24, 0, 24, 10],
    }),
  };

  const allowImages = Boolean(safeLogo?.dataUrl);
  return await renderPdfBuffer(doc, { allowImages });
}
