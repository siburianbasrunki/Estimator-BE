import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import {
  Estimation,
  EstimationItem,
  ItemDetail,
  CustomField,
  User,
} from "@prisma/client";

type EstimationWithRelations = Estimation & {
  author: Pick<User, "id" | "name" | "email">;
  customFields: CustomField[];
  items: (EstimationItem & { details: ItemDetail[] })[];
};

const MARGIN = 32; // lebih rapat
const PAGE_WIDTH = 595.28; // A4 width pt
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  headerFrom: "#0B1220",
  headerTo: "#0F172A",
  headerText: "#F8FAFC",
  primary: "#0F52BA", // cerah, modern
  accent: "#1D4ED8",
  text: "#111827",
  subText: "#374151",
  border: "#E5E7EB",
  grid: "#EEF2F7",
  zebra: "#FAFBFF",
  sectionBg: "#F3F4F6",
  chipBg: "#EEF2FF",
  chipBorder: "#C7D2FE",
};

const FONTS = {
  title: "Helvetica-Bold",
  header: "Helvetica-Bold",
  body: "Helvetica",
};

const COLS = [
  { key: "no", label: "No", width: 30, align: "center" as const },
  {
    key: "uraian",
    label: "Uraian Pekerjaan",
    width: 278,
    align: "left" as const,
  },
  { key: "satuan", label: "Satuan", width: 52, align: "center" as const },
  { key: "volume", label: "Volume", width: 62, align: "right" as const },
  {
    key: "hargaSatuan",
    label: "Satuan (Rp)",
    width: 86,
    align: "right" as const,
  },
  { key: "jumlah", label: "Jumlah (Rp)", width: 86, align: "right" as const },
] as const;

const COL_GAP = 6;

const fmtIDR = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function cellX(colIndex: number): number {
  let x = MARGIN;
  for (let i = 0; i < colIndex; i++) x += COLS[i].width + COL_GAP;
  return x;
}

function drawGridRect(doc: PDFKit.PDFDocument, y: number, h: number) {
  // grid borders vertikal tipis
  let x = MARGIN;
  doc
    .lineWidth(0.5)
    .strokeColor(COLORS.grid)
    .moveTo(MARGIN, y + h)
    .lineTo(MARGIN + CONTENT_WIDTH, y + h)
    .stroke();

  for (let i = 0; i < COLS.length - 1; i++) {
    x += COLS[i].width + COL_GAP;
    doc
      .moveTo(x - COL_GAP / 2, y)
      .lineTo(x - COL_GAP / 2, y + h)
      .stroke();
  }
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  needed: number,
  redraw?: () => void
) {
  const bottom = doc.page.margins.bottom ?? MARGIN;
  const available = doc.page.height - bottom - doc.y;
  if (available < needed) {
    doc.addPage();
    if (redraw) redraw();
  }
}

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

// ===== Header dokumen =====
function drawDocHeader(doc: PDFKit.PDFDocument, est: EstimationWithRelations) {
  // gradien sederhana (dua strip)
  doc.rect(0, 0, doc.page.width, 70).fillColor(COLORS.headerFrom).fill();
  doc.rect(0, 35, doc.page.width, 35).fillColor(COLORS.headerTo).fill();

  doc
    .fillColor(COLORS.headerText)
    .font(FONTS.title)
    .fontSize(18)
    .text(est.projectName, MARGIN, 16, { width: CONTENT_WIDTH });

  doc
    .font(FONTS.body)
    .fontSize(10)
    .fillColor("#D1D5DB")
    .text(
      `Owner: ${est.projectOwner}   •   Status: ${est.status}   •   PPN: ${est.ppn}%`,
      MARGIN,
      42,
      { width: CONTENT_WIDTH }
    )
    .text(
      `Dibuat: ${dayjs(est.createdAt).format("DD MMM YYYY HH:mm")}   •   Diupdate: ${dayjs(
        est.updatedAt
      ).format("DD MMM YYYY HH:mm")}`,
      MARGIN,
      56,
      { width: CONTENT_WIDTH }
    );

  doc.y = 82;
}

// ===== Header tabel (2 baris) =====
function drawTableHeader(doc: PDFKit.PDFDocument) {
  const topY = doc.y;
  const h1 = 20;
  const h2 = 20;

  ensureSpace(doc, h1 + h2 + 4);

  // Baris 1
  doc
    .roundedRect(MARGIN, topY, CONTENT_WIDTH, h1, 6)
    .fillAndStroke(COLORS.accent, COLORS.accent);

  const labels1 = [
    "No",
    "Uraian Pekerjaan",
    "Satuan",
    "Volume",
    "Harga (Rp)",
    "",
  ];
  COLS.forEach((c, i) => {
    const x = cellX(i) + 6;
    const w = c.width - 12;
    doc
      .fillColor("#FFFFFF")
      .font(FONTS.header)
      .fontSize(10)
      .text(labels1[i], x, topY + 5, { width: w, align: "center" });
  });

  // Baris 2
  const y2 = topY + h1 - 2; // sedikit overlap agar terlihat menyatu
  doc
    .roundedRect(MARGIN, y2, CONTENT_WIDTH, h2, 6)
    .fillAndStroke(COLORS.accent, COLORS.accent);

  const labels2 = ["", "", "", "", "Satuan (Rp)", "Jumlah (Rp)"];
  COLS.forEach((c, i) => {
    if (!labels2[i]) return;
    const x = cellX(i) + 6;
    const w = c.width - 12;
    doc
      .fillColor("#FFFFFF")
      .font(FONTS.header)
      .fontSize(10)
      .text(labels2[i], x, y2 + 5, { width: w, align: "center" });
  });

  doc.y = y2 + h2 + 4;
}

// ===== Judul bagian =====
function drawSectionTitle(
  doc: PDFKit.PDFDocument,
  index: number,
  title: string
) {
  const h = 22;
  ensureSpace(doc, h + 8, () => drawTableHeader(doc));

  // pill light
  doc
    .roundedRect(MARGIN, doc.y, CONTENT_WIDTH, h, 8)
    .fillAndStroke(COLORS.sectionBg, COLORS.border);

  doc
    .font(FONTS.header)
    .fontSize(11)
    .fillColor(COLORS.primary)
    .text(`${roman(index)}  ${title.toUpperCase()}`, MARGIN + 10, doc.y + 5);

  doc.y += h + 4;
}

// ===== Baris item =====
function drawItemRow(
  doc: PDFKit.PDFDocument,
  rowIdx: number,
  data: {
    no: number;
    uraian: string;
    satuan: string;
    volume: number | string;
    hargaSatuan: number;
    jumlah: number;
  }
) {
  const padY = 6;
  const padX = 6;

  const uraianIdx = 1;
  const uraianW = COLS[uraianIdx].width - padX * 2;
  const uraianH = doc.heightOfString(String(data.uraian ?? ""), {
    width: uraianW,
  });

  const baseH = 18; // lebih ringkas
  const rowH = Math.max(baseH, uraianH + padY * 2);

  ensureSpace(doc, rowH + 6, () => drawTableHeader(doc));

  if (rowIdx % 2 === 1) {
    doc.rect(MARGIN, doc.y, CONTENT_WIDTH, rowH).fillColor(COLORS.zebra).fill();
  }

  drawGridRect(doc, doc.y, rowH);

  COLS.forEach((c, i) => {
    const x = cellX(i) + padX;
    const w = c.width - padX * 2;
    let txt = "";

    switch (c.key) {
      case "no":
        txt = String(data.no ?? "");
        break;
      case "uraian":
        txt = String(data.uraian ?? "");
        break;
      case "satuan":
        txt = String(data.satuan ?? "");
        break;
      case "volume":
        txt =
          data.volume !== undefined && data.volume !== null
            ? String(data.volume)
            : "";
        break;
      case "hargaSatuan":
        txt = fmtIDR(data.hargaSatuan ?? 0);
        break;
      case "jumlah":
        txt = fmtIDR(data.jumlah ?? 0);
        break;
    }

    doc
      .font(FONTS.body)
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(txt, x, doc.y + padY, { width: w, align: c.align });
  });

  doc.y += rowH;
}

// ===== Subtotal per bagian =====
function drawSectionSubtotal(
  doc: PDFKit.PDFDocument,
  romanIdx: string,
  subtotal: number
) {
  const h = 26;
  ensureSpace(doc, h + 6, () => drawTableHeader(doc));

  // label kanan
  const label = `Jumlah ${romanIdx}`;
  const labelW = 170;

  doc
    .font(FONTS.header)
    .fontSize(10)
    .fillColor(COLORS.subText)
    .text(label, MARGIN + CONTENT_WIDTH - (labelW + 96), doc.y + 6, {
      width: labelW,
      align: "right",
    });

  // badge nilai
  doc
    .roundedRect(MARGIN + CONTENT_WIDTH - 96, doc.y + 3, 96, 20, 7)
    .fillAndStroke(COLORS.chipBg, COLORS.chipBorder);

  doc
    .font(FONTS.header)
    .fontSize(10.5)
    .fillColor(COLORS.primary)
    .text(fmtIDR(subtotal), MARGIN + CONTENT_WIDTH - 96 + 8, doc.y + 6, {
      width: 96 - 16,
      align: "right",
    });

  doc.y += h;
}

// ====== MAIN ======
export async function buildEstimationPdf(
  est: EstimationWithRelations
): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: MARGIN,
    size: "A4",
    bufferPages: true,
    info: {
      Title: `RAB ${est.projectName}`,
      Author: est.author?.name || "Estimation App",
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  );

  // Header
  drawDocHeader(doc, est);

  // Header tabel global
  drawTableHeader(doc);

  // Render tiap section
  est.items.forEach((section, sIdx) => {
    drawSectionTitle(doc, sIdx + 1, section.title || `Bagian ${sIdx + 1}`);

    let no = 1;
    let subtotal = 0;

    (section.details || []).forEach((d, idx) => {
      const volume = d.volume ?? "";
      const hargaSatuan = d.hargaSatuan ?? 0;
      const jumlah =
        d.hargaTotal ?? Number(d.volume || 0) * Number(d.hargaSatuan || 0);

      drawItemRow(doc, idx, {
        no: no++,
        uraian: d.deskripsi || "",
        satuan: d.satuan || "",
        volume,
        hargaSatuan,
        jumlah,
      });

      subtotal += Number(jumlah || 0);
    });

    drawSectionSubtotal(doc, roman(sIdx + 1), subtotal);
  });

  // Nomor halaman
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font(FONTS.body)
      .fontSize(8)
      .fillColor("#6B7280")
      .text(`Hal ${i + 1} dari ${range.count}`, 0, doc.page.height - 22, {
        width: doc.page.width,
        align: "center",
      });
  }

  doc.end();
  return done;
}
