// utils/pdf-finalize.ts
import PdfPrinter from "pdfmake";
import { sanitizeImages, hardStripImages, stripAllImages } from "./pdf-sanitize";

type Fonts = {
  [family: string]: {
    normal: string; bold: string; italics: string; bolditalics: string;
  };
};

const defaultFonts: Fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

/** Bersihkan docDefinition agar aman buat pdfmake */
export function finalizeForPdfmake(doc: any, allowImages: boolean): any {
  // 1) normalisasi & drop gambar invalid
  const sanitized = sanitizeImages(doc);
  // 2) kalau tidak izinkan gambar → buang SEMUA gambar
  return allowImages ? hardStripImages(sanitized) : stripAllImages(sanitized);
}

/** Render jadi Buffer dengan guard pembersihan gambar (default font: Helvetica) */
export async function renderPdfBuffer(
  doc: any,
  { allowImages = false, fonts = defaultFonts }: { allowImages?: boolean; fonts?: Fonts }
): Promise<Buffer> {
  const safeDoc = finalizeForPdfmake(doc, allowImages);
  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(safeDoc);
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    pdfDoc.on("data", (d) => chunks.push(d));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
