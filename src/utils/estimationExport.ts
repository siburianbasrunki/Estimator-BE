// import {
//   Estimation,
//   EstimationItem,
//   ItemDetail,
//   CustomField,
//   User,
// } from "@prisma/client";
// import PDFDocument from "pdfkit";
// import ExcelJS from "exceljs";
// import dayjs from "dayjs";

// type EstimationWithRelations = Estimation & {
//   author: Pick<User, "id" | "name" | "email">;
//   customFields: CustomField[];
//   items: (EstimationItem & { details: ItemDetail[] })[];
// };

// export function calcTotals(est: EstimationWithRelations) {
//   const subtotal = est.items.reduce((acc, it) => {
//     const sumDetails = it.details.reduce(
//       (a, d) => a + Number(d.hargaTotal || 0),
//       0
//     );
//     return acc + sumDetails;
//   }, 0);
//   const ppnAmount = (Number(est.ppn || 0) / 100) * subtotal;
//   const grandTotal = subtotal + ppnAmount;
//   return { subtotal, ppnAmount, grandTotal };
// }

// export function formatCurrencyIDR(n: number) {
//   return new Intl.NumberFormat("id-ID", {
//     style: "currency",
//     currency: "IDR",
//     maximumFractionDigits: 0,
//   }).format(n || 0);
// }

// export function sanitizeFileName(name: string) {
//   return name.replace(/[^\w\d-_]+/g, "_");
// }

// // Improved design constants
// const MARGIN = 36;
// const CONTENT_WIDTH = 595.28 - MARGIN * 2; // A4 width in pt minus margins

// const COLORS = {
//   primary: "#1E40AF", // blue-800
//   secondary: "#1D4ED8", // blue-700
//   accent: "#2563EB", // blue-600
//   text: "#1F2937", // gray-800
//   subText: "#4B5563", // gray-600
//   lightText: "#6B7280", // gray-500
//   border: "#E5E7EB", // gray-200
//   headerBg: "#111827", // gray-900
//   headerText: "#F9FAFB", // gray-50
//   zebra: "#F9FAFB", // gray-50
//   sectionBg: "#F3F4F6", // gray-100
//   summaryBg: "#F8FAFC", // slate-50
//   summaryBorder: "#E2E8F0", // slate-200
//   success: "#059669", // emerald-600
//   warning: "#D97706", // amber-600
// };

// const FONTS = {
//   title: "Helvetica-Bold",
//   subtitle: "Helvetica-Bold",
//   header: "Helvetica-Bold",
//   body: "Helvetica",
//   light: "Helvetica-Oblique",
// };

// const COLS = [
//   { key: "kode", label: "Kode", width: 70, align: "left" as const },
//   { key: "deskripsi", label: "Deskripsi", width: 230, align: "left" as const },
//   { key: "volume", label: "Vol", width: 50, align: "right" as const },
//   { key: "satuan", label: "Sat", width: 45, align: "center" as const },
//   {
//     key: "hargaSatuan",
//     label: "Harga Satuan",
//     width: 80,
//     align: "right" as const,
//   },
//   {
//     key: "hargaTotal",
//     label: "Total Harga",
//     width: 80,
//     align: "right" as const,
//   },
// ]; // total 555 (leaving some space for margins)

// function drawHr(
//   doc: PDFKit.PDFDocument,
//   y: number,
//   color = COLORS.border,
//   width = CONTENT_WIDTH
// ) {
//   doc
//     .moveTo(MARGIN, y)
//     .lineTo(MARGIN + width, y)
//     .lineWidth(0.5)
//     .strokeColor(color)
//     .stroke();
// }

// function addDocHeader(doc: PDFKit.PDFDocument, est: EstimationWithRelations) {
//   // Company header
//   doc
//     .fillColor(COLORS.primary)
//     .font(FONTS.title)
//     .fontSize(16)
//     .text("ESTIMASI BIAYA PROYEK", MARGIN, 60, {
//       width: CONTENT_WIDTH,
//       align: "center",
//     });

//   // Project info box
//   const boxY = 90;
//   const boxH = 80;

//   // Box background
//   doc.roundedRect(MARGIN, boxY, CONTENT_WIDTH, boxH, 4).fill(COLORS.sectionBg);

//   // Box content
//   doc.font(FONTS.body).fontSize(10).fillColor(COLORS.text);
//   const leftCol = MARGIN + 20;
//   const rightCol = MARGIN + CONTENT_WIDTH / 2 + 10;

//   doc.text("Nama Proyek:", leftCol, boxY + 15);
//   doc.font(FONTS.subtitle).text(est.projectName, leftCol + 70, boxY + 15);

//   doc.font(FONTS.body).text("Penanggung Jawab:", leftCol, boxY + 35);
//   doc.text(est.projectOwner, leftCol + 70, boxY + 35);

//   doc.text("Status:", leftCol, boxY + 55);
//   doc.text(est.status, leftCol + 70, boxY + 55);

//   doc.text("PPN:", rightCol, boxY + 15);
//   doc.text(`${est.ppn}%`, rightCol + 70, boxY + 15);

//   doc.text("Dibuat:", rightCol, boxY + 35);
//   doc.text(
//     dayjs(est.createdAt).format("DD MMM YYYY HH:mm"),
//     rightCol + 70,
//     boxY + 35
//   );

//   doc.text("Diupdate:", rightCol, boxY + 55);
//   doc.text(
//     dayjs(est.updatedAt).format("DD MMM YYYY HH:mm"),
//     rightCol + 70,
//     boxY + 55
//   );

//   // Notes section if exists
//   if (est.notes) {
//     doc.moveDown(2);
//     doc.font(FONTS.body).fontSize(10).fillColor(COLORS.subText);
//     doc.text("Catatan:", MARGIN, doc.y);
//     doc.text(est.notes, MARGIN + 40, doc.y, {
//       width: CONTENT_WIDTH - 40,
//     });
//   }

//   // Custom fields (if any)
//   if (est.customFields?.length) {
//     doc.moveDown(1.5);
//     doc.font(FONTS.header).fontSize(11).fillColor(COLORS.primary);
//     doc.text("Informasi Tambahan", MARGIN, doc.y);
//     drawHr(doc, doc.y + 2, COLORS.primary, 120);

//     doc.moveDown(0.8);
//     doc.font(FONTS.body).fontSize(9).fillColor(COLORS.text);

//     const chipPadX = 8;
//     const chipPadY = 4;
//     const chipGap = 8;
//     let x = MARGIN;
//     let y = doc.y;
//     const lineHeight = 16;

//     est.customFields.forEach((cf) => {
//       const text = `${cf.label}: ${cf.value}`;
//       const w = doc.widthOfString(text) + chipPadX * 2;

//       if (x + w > MARGIN + CONTENT_WIDTH) {
//         x = MARGIN;
//         y += lineHeight + chipGap;
//       }

//       doc
//         .roundedRect(x, y, w, lineHeight, 4)
//         .fill(COLORS.summaryBg)
//         .strokeColor(COLORS.border)
//         .stroke();

//       doc.fillColor(COLORS.text).text(text, x + chipPadX, y + chipPadY - 2);
//       x += w + chipGap;
//     });

//     doc.y = y + lineHeight + 10;
//   }

//   doc.moveDown(1.5);
// }

// function ensureSpace(
//   doc: PDFKit.PDFDocument,
//   needed: number,
//   onNewPage?: () => void
// ) {
//   const bottom = doc.page.margins?.bottom ?? MARGIN;
//   if (doc.y + needed <= doc.page.height - bottom) return;
//   doc.addPage();
//   if (onNewPage) onNewPage();
// }

// function drawTableHeader(doc: PDFKit.PDFDocument, title: string) {
//   // Section title
//   doc
//     .fillColor(COLORS.primary)
//     .font(FONTS.header)
//     .fontSize(12)
//     .text(title, MARGIN, doc.y, { width: CONTENT_WIDTH, align: "left" });

//   drawHr(doc, doc.y + 2, COLORS.primary, 100);
//   doc.moveDown(0.8);

//   const headerHeight = 22;
//   ensureSpace(doc, headerHeight + 6);

//   // Header background
//   doc.save();
//   doc.rect(MARGIN, doc.y, CONTENT_WIDTH, headerHeight).fill(COLORS.headerBg);
//   doc.restore();

//   // Header text
//   doc.fillColor(COLORS.headerText).font(FONTS.header).fontSize(9);
//   let x = MARGIN;
//   COLS.forEach((c) => {
//     doc.text(c.label, x + 6, doc.y + 6, {
//       width: c.width - 12,
//       align: c.align,
//       lineBreak: false,
//     });
//     x += c.width;
//   });

//   doc.y += headerHeight;
// }

// function drawRow(
//   doc: PDFKit.PDFDocument,
//   data: Record<string, any>,
//   rowIdx: number
// ) {
//   const padX = 6;
//   const padY = 4;
//   const lineH = 12;

//   // Compute row height based on the tallest cell (wrap for deskripsi)
//   const heights: number[] = COLS.map((c) => {
//     const value =
//       c.key === "hargaSatuan" || c.key === "hargaTotal"
//         ? formatCurrencyIDR(Number(data[c.key] || 0))
//         : (data[c.key] ?? "-").toString();
//     const textW = c.width - padX * 2;
//     const textH = doc.heightOfString(value, { width: textW });
//     return Math.max(textH + padY * 2, lineH + padY * 2);
//   });
//   const rowH = Math.max(...heights);

//   // Page break handling
//   ensureSpace(doc, rowH + 6, () => {
//     drawTableHeader(doc, ""); // Repeat header on new page
//   });

//   // Zebra striping
//   if (rowIdx % 2 === 1) {
//     doc
//       .save()
//       .rect(MARGIN, doc.y, CONTENT_WIDTH, rowH)
//       .fill(COLORS.zebra)
//       .restore();
//   }

//   // Cell contents
//   doc.font(FONTS.body).fontSize(9).fillColor(COLORS.text);
//   let x = MARGIN;
//   COLS.forEach((c) => {
//     const value =
//       c.key === "hargaSatuan" || c.key === "hargaTotal"
//         ? formatCurrencyIDR(Number(data[c.key] || 0))
//         : (data[c.key] ?? "-").toString();

//     const options = {
//       width: c.width - padX * 2,
//       align: c.align,
//       lineBreak: false,
//     };

//     let tx = x + padX;
//     if (c.align === "right") tx = x + c.width - padX - options.width;
//     if (c.align === "center") tx = x + (c.width - options.width) / 2;

//     doc.text(value, tx, doc.y + padY, options);
//     x += c.width;
//   });

//   // Bottom border
//   drawHr(doc, doc.y + rowH);
//   doc.y += rowH;
// }

// function drawSectionSubtotal(
//   doc: PDFKit.PDFDocument,
//   title: string,
//   value: number
// ) {
//   ensureSpace(doc, 26);

//   const label = `Subtotal ${title}`;
//   const text = formatCurrencyIDR(value);
//   const boxW = 200;
//   const boxH = 20;
//   const x = MARGIN + CONTENT_WIDTH - boxW;
//   const y = doc.y + 4;

//   doc
//     .roundedRect(x, y, boxW, boxH, 4)
//     .fill(COLORS.summaryBg)
//     .strokeColor(COLORS.border)
//     .stroke();

//   doc
//     .font(FONTS.body)
//     .fontSize(9)
//     .fillColor(COLORS.subText)
//     .text(label, x + 10, y + 6, { width: boxW - 20, align: "left" });

//   doc
//     .font(FONTS.header)
//     .fontSize(10)
//     .fillColor(COLORS.primary)
//     .text(text, x + 10, y + 6, { width: boxW - 20, align: "right" });

//   doc.y = y + boxH + 10;
// }

// function drawSummaryBox(doc: PDFKit.PDFDocument, est: EstimationWithRelations) {
//   const { subtotal, ppnAmount, grandTotal } = calcTotals(est);

//   ensureSpace(doc, 100);

//   const boxW = 280;
//   const boxH = 90;
//   const x = MARGIN + CONTENT_WIDTH - boxW;
//   const y = doc.y + 10;

//   // Box styling
//   doc
//     .roundedRect(x, y, boxW, boxH, 6)
//     .fill(COLORS.summaryBg)
//     .strokeColor(COLORS.summaryBorder)
//     .lineWidth(1)
//     .stroke();

//   // Summary content
//   const row = (label: string, val: string, isBold = false) => {
//     doc
//       .font(isBold ? FONTS.header : FONTS.body)
//       .fontSize(10)
//       .fillColor(isBold ? COLORS.primary : COLORS.text)
//       .text(label, x + 15, doc.y, { width: boxW - 30, align: "left" });

//     doc
//       .font(isBold ? FONTS.header : FONTS.body)
//       .fontSize(10)
//       .fillColor(isBold ? COLORS.primary : COLORS.text)
//       .text(val, x + 15, doc.y, { width: boxW - 30, align: "right" });

//     doc.y += 18;
//   };

//   doc.y = y + 15;
//   row("Subtotal", formatCurrencyIDR(subtotal));
//   row(`PPN (${est.ppn}%)`, formatCurrencyIDR(ppnAmount));

//   // Divider
//   doc
//     .moveTo(x + 15, doc.y + 4)
//     .lineTo(x + boxW - 15, doc.y + 4)
//     .strokeColor(COLORS.border)
//     .lineWidth(0.5)
//     .stroke();
//   doc.y += 10;

//   row("TOTAL", formatCurrencyIDR(grandTotal), true);

//   doc.y = y + boxH + 20;
// }

// export async function buildEstimationPdf(
//   est: EstimationWithRelations
// ): Promise<Buffer> {
//   const doc = new PDFDocument({
//     margin: MARGIN,
//     size: "A4",
//     bufferPages: true,
//     info: {
//       Title: `Estimasi ${est.projectName}`,
//       Author: est.author?.name || "Estimation App",
//       CreationDate: new Date(),
//     },
//   });

//   const chunks: Buffer[] = [];
//   doc.on("data", (c) => chunks.push(c));
//   const done = new Promise<Buffer>((resolve) =>
//     doc.on("end", () => resolve(Buffer.concat(chunks)))
//   );
//   const fonts = {
//     title: "Helvetica-Bold",
//     header: "Helvetica-Bold",
//     body: "Helvetica",
//     light: "Helvetica",
//   };
//   // Header
//   addDocHeader(doc, est);

//   // Sections
//   est.items.forEach((it, sectionIdx) => {
//     // Section title + header
//     doc.font(fonts.header).fontSize(12);
//     drawTableHeader(doc, `${sectionIdx + 1}. ${it.title}`);

//     if (!it.details.length) {
//       ensureSpace(doc, 20);
//       doc
//         .font(FONTS.body)
//         .fontSize(9)
//         .fillColor(COLORS.lightText)
//         .text("Tidak ada item", MARGIN, doc.y + 8, {
//           width: CONTENT_WIDTH,
//           align: "center",
//         });
//       doc.moveDown(1);
//       return;
//     }

//     it.details.forEach((d, idx) => {
//       const rowData = {
//         kode: d.kode,
//         deskripsi: d.deskripsi,
//         volume: d.volume,
//         satuan: d.satuan,
//         hargaSatuan: d.hargaSatuan,
//         hargaTotal: d.hargaTotal,
//       };

//       drawRow(doc, rowData, idx);
//     });

//     const sectionSubtotal = it.details.reduce(
//       (a, d) => a + Number(d.hargaTotal || 0),
//       0
//     );
//     drawSectionSubtotal(doc, it.title, sectionSubtotal);

//     // Section spacing
//     doc.moveDown(0.8);
//   });

//   // Summary box
//   drawSummaryBox(doc, est);

//   // Footer
//   doc.moveDown(1);
//   drawHr(doc, doc.y);
//   doc
//     .font(FONTS.light)
//     .fontSize(8)
//     .fillColor(COLORS.lightText)
//     .text(
//       `Dokumen ini digenerate pada ${dayjs().format("DD MMM YYYY HH:mm")} • Estimation App`,
//       MARGIN,
//       doc.y + 6,
//       { width: CONTENT_WIDTH, align: "center" }
//     );

//   doc.end();
//   return done;
// }

// /** ---------- EXCEL ---------- */
// export async function buildEstimationExcel(
//   est: EstimationWithRelations
// ): Promise<Buffer> {
//   const wb = new ExcelJS.Workbook();
//   wb.creator = "Estimation App";
//   wb.created = new Date();

//   // Sheet 1 - Ringkasan
//   const s1 = wb.addWorksheet("Ringkasan");
//   s1.columns = [
//     { header: "Field", key: "field", width: 28 },
//     { header: "Value", key: "value", width: 60 },
//   ];

//   s1.addRows([
//     { field: "Nama Proyek", value: est.projectName },
//     { field: "Penanggung Jawab", value: est.projectOwner },
//     { field: "PPN", value: `${est.ppn}%` },
//     { field: "Status", value: est.status },
//     {
//       field: "Dibuat",
//       value: dayjs(est.createdAt).format("DD MMM YYYY HH:mm"),
//     },
//     {
//       field: "Diupdate",
//       value: dayjs(est.updatedAt).format("DD MMM YYYY HH:mm"),
//     },
//     { field: "Catatan", value: est.notes || "-" },
//   ]);

//   if (est.customFields?.length) {
//     s1.addRow({ field: "", value: "" });
//     s1.addRow({ field: "Custom Fields", value: "" });
//     est.customFields.forEach((cf) =>
//       s1.addRow({ field: cf.label, value: cf.value })
//     );
//   }

//   const { subtotal, ppnAmount, grandTotal } = calcTotals(est);
//   s1.addRow({ field: "", value: "" });
//   s1.addRow({ field: "Subtotal", value: subtotal });
//   s1.addRow({ field: `PPN (${est.ppn}%)`, value: ppnAmount });
//   s1.addRow({ field: "Grand Total", value: grandTotal });

//   // Sheet 2 - Detail Item
//   const s2 = wb.addWorksheet("Detail");
//   s2.columns = [
//     { header: "Judul Pekerjaan", key: "judul", width: 36 },
//     { header: "Kode", key: "kode", width: 16 },
//     { header: "Deskripsi", key: "deskripsi", width: 60 },
//     { header: "Volume", key: "volume", width: 12 },
//     { header: "Satuan", key: "satuan", width: 10 },
//     { header: "Harga Satuan", key: "hargaSatuan", width: 18 },
//     { header: "Total", key: "total", width: 18 },
//   ];

//   est.items.forEach((it) => {
//     if (it.details.length === 0) {
//       s2.addRow({ judul: it.title });
//       return;
//     }
//     it.details.forEach((d) => {
//       s2.addRow({
//         judul: it.title,
//         kode: d.kode,
//         deskripsi: d.deskripsi,
//         volume: d.volume,
//         satuan: d.satuan,
//         hargaSatuan: Number(d.hargaSatuan || 0),
//         total: Number(d.hargaTotal || 0),
//       });
//     });
//   });

//   // Bold header style
//   [s1, s2].forEach((sheet) => {
//     sheet.getRow(1).font = { bold: true };
//   });

//   const buf = await wb.xlsx.writeBuffer();
//   return Buffer.from(buf);
// }
