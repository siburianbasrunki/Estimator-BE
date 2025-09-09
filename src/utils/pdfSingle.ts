// utils/pdfTable.ts
import dayjs from "dayjs";
import { renderPdfBuffer } from "./pdf-finalize";

type ColumnWidth = number | string;
export type TableRow = Array<string | number>;

// Terima berbagai bentuk logo, tapi kita hanya pakai dataUrl valid untuk pdfmake
export type LogoOpt =
  | { dataUrl: string; width?: number; height?: number }
  | {
      base64: string;
      extension: "png" | "jpeg";
      width?: number;
      height?: number;
    }
  | string // boleh langsung string "data:image/..;base64,...."
  | undefined;

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
  for (const w of widths) if (typeof w === "number") sum += w;
  return sum;
}
function scaleWidths(widths: ColumnWidth[], scale: number): ColumnWidth[] {
  return widths.map((w) =>
    typeof w === "number" ? Math.max(20, w * scale) : w
  );
}

/** ===== Helpers logo ===== */
function isDataImageUrl(s: string | undefined | null): s is string {
  return typeof s === "string" && /^data:image\/(png|jpe?g);base64,/i.test(s);
}
function normalizeLogo(
  logo?: LogoOpt
): { dataUrl: string; width?: number; height?: number } | undefined {
  if (!logo) return undefined;

  if (typeof logo === "string") {
    if (isDataImageUrl(logo)) return { dataUrl: logo };
    return undefined; // url http(s) ditolak pdfmake
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

export async function buildTablePdf(opts: BuildTablePdfOpts): Promise<Buffer> {
  // ====== defaults & compute fit ======
  const basePageSize = opts.pageSize ?? "A4";
  const landscape = opts.landscape ?? true;
  const margins: [number, number, number, number] = [24, 24, 24, 24];

  let pageSize: "A4" | "A3" | "LEGAL" = basePageSize;
  let finalWidths: ColumnWidth[] = [...opts.columns.widths];

  if (opts.fitToPage) {
    let contentW = getContentWidth(pageSize, landscape, margins);
    let numericSum = sumNumericWidths(finalWidths);

    if (numericSum > 0 && numericSum > contentW) {
      pageSize = "A3";
      contentW = getContentWidth(pageSize, landscape, margins);
      numericSum = sumNumericWidths(finalWidths);
      if (numericSum > contentW) {
        const scale = contentW / numericSum;
        finalWidths = scaleWidths(finalWidths, scale);
      }
    }
  }

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

  const contentWidth = getContentWidth(pageSize, landscape, margins);
  const safeLogo = normalizeLogo(opts.logo);

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

  const tableNode = {
    table: {
      headerRows: 1,
      widths: finalWidths,
      body: tableBody,
      dontBreakRows: true,
      keepWithHeaderRows: 1,
    },
    layout: gridLayout,
  };

  const doc: any = {
    pageSize,
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: margins,
    content: [
      headerTitle,
      headerLine,
      {
        columns: [
          { width: "*", text: "" },
          { width: "auto", ...tableNode },
          { width: "*", text: "" },
        ],
        columnGap: 0,
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

  // Render via pdf-finalize
  const allowImages = Boolean(safeLogo?.dataUrl); // hanya boleh gambar kalau ada logo valid
  return await renderPdfBuffer(doc, { allowImages });
}
