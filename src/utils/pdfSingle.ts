// src/utils/pdfSingles.ts
import PdfPrinter from "pdfmake";
import dayjs from "dayjs";

type ColumnWidth = number | string;
export type TableRow = Array<string | number>;
export type LogoOpt = { dataUrl: string; width?: number; height?: number };

export type BuildTablePdfOpts = {
  title: string;
  subtitle?: string;
  columns: { headers: string[]; widths: ColumnWidth[] };
  rows: TableRow[];
  logo?: LogoOpt;
  landscape?: boolean;
  fitToPage?: boolean;
  condense?: boolean;
  pageSize?: "A4" | "A3" | "LEGAL";
};

const fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};
const printer = new PdfPrinter(fonts);

// PDF points default (portrait)
const PAGE = {
  A4: { w: 595.28, h: 841.89 },
  A3: { w: 841.89, h: 1190.55 },
  LEGAL: { w: 612, h: 1008 },
} as const;

function getContentWidth(
  pageSize: keyof typeof PAGE,
  landscape: boolean,
  margins: [number, number, number, number]
) {
  const size = PAGE[pageSize];
  const pageW = landscape ? size.h : size.w;
  const contentW = pageW - (margins[0] + margins[2]);
  return contentW;
}

function sumNumericWidths(widths: ColumnWidth[]) {
  let sum = 0;
  for (const w of widths) {
    if (typeof w === "number") sum += w;
  }
  return sum;
}

function scaleWidths(widths: ColumnWidth[], scale: number): ColumnWidth[] {
  return widths.map((w) =>
    typeof w === "number" ? Math.max(20, w * scale) : w
  );
}

export async function buildTablePdf(opts: BuildTablePdfOpts): Promise<Buffer> {
  // ====== defaults & compute fit ======
  const basePageSize = opts.pageSize ?? "A4";
  const landscape = opts.landscape ?? true;
  const margins: [number, number, number, number] = [24, 24, 24, 24];

  // kita akan menentukan pageSize & widths final di sini
  let pageSize: "A4" | "A3" | "LEGAL" = basePageSize;

  // siapkan widths kerja (copy)
  let finalWidths: ColumnWidth[] = [...opts.columns.widths];

  if (opts.fitToPage) {
    // 1) coba A4
    let contentW = getContentWidth(pageSize, landscape, margins);
    let numericSum = sumNumericWidths(finalWidths);

    if (numericSum > 0 && numericSum > contentW) {
      // 2) coba A3 kalau masih overflow
      pageSize = "A3";
      contentW = getContentWidth(pageSize, landscape, margins);
      numericSum = sumNumericWidths(finalWidths);
      if (numericSum > contentW) {
        // 3) scale down supaya pas
        const scale = contentW / numericSum;
        finalWidths = scaleWidths(finalWidths, scale);
      }
    }
  }

  // condense: kecilkan font & padding agar lebih padat
  const baseFont = opts.condense ? 8 : 9;
  const pad = opts.condense ? 4 : 6;

  const gridLayout = {
    defaultBorder: true,
    hLineWidth: (i: number, node: any) =>
      i === 0 || i === node.table.body.length ? 1.2 : 0.6,
    vLineWidth: (i: number, node: any) =>
      i === 0 || i === node.table.widths.length ? 1.2 : 0.6,
    hLineColor: () => "#94A3B8",
    vLineColor: () => "#94A3B8",
    paddingLeft: () => pad,
    paddingRight: () => pad,
    paddingTop: () => pad,
    paddingBottom: () => pad,
    fillColor: (rowIndex: number, node: any) =>
      rowIndex === 0 ? "#0284C7" : rowIndex % 2 === 0 ? "#F8FAFC" : undefined,
  };

  // content width untuk headerLine (garis)
  const contentWidth = getContentWidth(pageSize, landscape, margins);

  const headerTitle = {
    table: {
      widths: [100, "*", 220],
      body: [
        [
          opts.logo
            ? { image: opts.logo.dataUrl, fit: [100, 40], alignment: "left" }
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
            stack: [
              {
                text: dayjs().format("DD MMM YYYY HH:mm"),
                fontSize: baseFont,
                alignment: "right",
              },
            ],
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
        x2: margins[0] + contentWidth,
        y2: 0,
        lineWidth: 1,
      },
    ],
    margin: [0, 6, 0, 12],
  };

  const headerRow = opts.columns.headers.map((h) => ({
    text: h,
    color: "white",
    bold: true,
    fontSize: baseFont,
    alignment: "center" as const,
    noWrap: false,
  }));

  const tableBody: any[] = [
    headerRow,
    ...opts.rows.map((r) =>
      r.map((v, i) => ({
        text: String(v ?? ""),
        fontSize: baseFont,
        noWrap: false,
        alignment:
          i === r.length - 1 || typeof v === "number"
            ? ("right" as const)
            : ("left" as const),
      }))
    ),
  ];

  // Definisi tabel (auto-width), nanti kita center-kan via columns
  const tableNode = {
    table: {
      headerRows: 1,
      widths: finalWidths,
      body: tableBody,
      dontBreakRows: true, // cegah baris terpotong
      keepWithHeaderRows: 1,
    },
    layout: gridLayout,
    // Hapus alignment di sini; kita center lewat columns wrapper
  };

  const doc: any = {
    pageSize,
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: margins,
    content: [
      headerTitle,
      headerLine,
      // ==== WRAPPER UNTUK CENTER ====
      {
        columns: [
          { width: "*", text: "" },
          { width: "auto", ...tableNode },
          { width: "*", text: "" },
        ],
        columnGap: 0, // biar simetris rapat
      },
    ],
    defaultStyle: { font: "Helvetica", fontSize: baseFont },
    footer: (current: number, total: number) => ({
      columns: [
        { text: "", fontSize: baseFont - 1 },
        {
          text: `Hal. ${current}/${total}`,
          alignment: "right",
          fontSize: baseFont - 1,
        },
      ],
      margin: [24, 0, 24, 10],
    }),
  };

  const pdfDoc = printer.createPdfKitDocument(doc);
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    pdfDoc.on("data", (d) => chunks.push(d));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
