// src/controllers/estimation.pdfSingles.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import axios from "axios";
import { sanitizeFileName } from "../utils/exportHelpers";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  forcePngDelivery,
} from "../utils/cloudinaryUpload";
import { buildTablePdf } from "../utils/pdfSingle";
import { buildAhspPdf } from "../utils/pdfAhsp";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

function toBase64DataUrl(arrbuf: ArrayBuffer, ext: "png" | "jpeg") {
  const b64 = Buffer.from(arrbuf).toString("base64");
  return `data:image/${ext};base64,${b64}`;
}
function isSupportedImageContentType(ct?: string) {
  if (!ct) return false;
  const s = ct.toLowerCase();
  return (
    s.includes("image/png") ||
    s.includes("image/jpeg") ||
    s.includes("image/jpg")
  );
}

async function resolveLogoDataUrl(
  req: Request,
  estimationImageUrl?: string
): Promise<{ dataUrl: string; width?: number; height?: number } | undefined> {
  // Prioritas 1: upload "logo"
  const file = (req as any).file as Express.Multer.File | undefined;
  let tempPublicId: string | undefined;
  try {
    if (file) {
      // Paksa upload sebagai PNG agar selalu kompatibel
      const up = await uploadToCloudinary(file.path, {
        folder: "estimations/export-logos",
        format: "png",
      });
      const fetchUrl = forcePngDelivery(up.imageUrl); // pastikan PNG delivery
      const resp = await axios.get<ArrayBuffer>(fetchUrl, {
        responseType: "arraybuffer",
      });

      const ct = resp.headers?.["content-type"];
      if (!isSupportedImageContentType(ct)) return undefined;

      return {
        dataUrl: toBase64DataUrl(resp.data, "png"),
        width: 110,
        height: 36,
      };
    } else if (estimationImageUrl) {
      // estimationImageUrl mungkin WEBP → paksa Cloudinary output PNG
      const fetchUrl = forcePngDelivery(estimationImageUrl);
      const resp = await axios.get<ArrayBuffer>(fetchUrl, {
        responseType: "arraybuffer",
      });

      const ct = resp.headers?.["content-type"];
      if (!isSupportedImageContentType(ct)) {
        // kalau bukan png/jpeg, jangan paksa → lebih baik tidak pakai logo
        return undefined;
      }

      return {
        dataUrl: toBase64DataUrl(resp.data, "png"),
        width: 110,
        height: 36,
      };
    }
    return undefined;
  } finally {
    if (tempPublicId) {
      try {
        await deleteFromCloudinary(tempPublicId);
      } catch {}
    }
  }
}

// ========== Common loader ==========
async function loadEstimation(userId: string, id: string) {
  const estimation = await prisma.estimation.findFirst({
    where: { id, authorId: userId },
    include: {
      author: { select: { id: true, name: true, email: true } },
      customFields: true,
      items: {
        include: {
          details: {
            include: {
              volumeDetails: true,
              hspItem: {
                include: {
                  category: true,
                  ahsp: {
                    include: { components: { include: { masterItem: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return estimation;
}

// ========== 1) Volume ==========
export const downloadVolumePdf = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const est = await loadEstimation(userId, id);
    if (!est)
      return void res.status(404).json({ error: "Estimation not found" });

    // 1) Kumpulkan semua nama extras unik (urut stabil)
    const extrasOrder: string[] = [];
    const seen = new Set<string>();
    for (const sec of est.items) {
      for (const d of sec.details) {
        for (const v of d.volumeDetails || []) {
          const arr = Array.isArray(v.extras) ? (v.extras as any[]) : [];
          for (const e of arr) {
            const name = (e?.name ?? "").toString().trim();
            if (name && !seen.has(name)) {
              seen.add(name);
              extrasOrder.push(name);
            }
          }
        }
      }
    }

    // 2) Siapkan header & widths dinamis
    const baseHeaders = [
      "Nama Volume",
      "Jenis",
      "P",
      "L",
      "T",
      "Jumlah",
      "Volume",
      "Signed Vol",
      "Satuan",
    ];
    const baseWidths = [120, 40, 35, 35, 35, 45, 55, 60, 45];

    const extraHeaders = extrasOrder.map((n) => `Extra: ${n}`);
    const extraWidths = extrasOrder.map(() => 70); // lebar moderat

    const headers = [...baseHeaders, ...extraHeaders];
    const widths = [...baseWidths, ...extraWidths];

    // 3) Helper render extras per baris
    function renderExtras(values: any[] | undefined) {
      const arr = Array.isArray(values) ? values : [];
      const map = new Map<string, any>();
      for (const e of arr) {
        const name = (e?.name ?? "").toString().trim();
        if (name) map.set(name, e?.value);
      }
      return extrasOrder.map((nm) => {
        const v = map.get(nm);
        const n = Number(v);
        return Number.isFinite(n) ? n : (v ?? "");
      });
    }

    // 4) Build rows (termasuk fallback bila tak ada detail)
    const rows: Array<string | number>[] = [];
    for (const sec of est.items) {
      for (const d of sec.details) {
        const sat = d.satuan || d.hspItem?.satuan || "-";
        const vols = d.volumeDetails || [];

        if (vols.length === 0) {
          const vol = Number(d.volume || 0);
          rows.push([
            "–", // Nama Volume
            "+", // Jenis
            0,
            0,
            0,
            0, // P, L, T, Jumlah
            vol, // Volume
            vol, // Signed Vol
            sat, // Satuan
            ...extrasOrder.map(() => ""), // kosongkan extras
          ]);
          continue;
        }

        for (const v of vols) {
          const sign = v.jenis === "SUB" ? -1 : 1;
          rows.push([
            v.nama || "-",
            v.jenis === "SUB" ? "-" : "+",
            Number(v.panjang || 0),
            Number(v.lebar || 0),
            Number(v.tinggi || 0),
            Number(v.jumlah || 0),
            Number(v.volume || 0),
            sign * Number(v.volume || 0),
            sat,
            ...renderExtras(v.extras as any[]),
          ]);
        }
      }
    }

    const logo = await resolveLogoDataUrl(req, est.imageUrl);
    const pdf = await buildTablePdf({
      title: "Volume Detail",
      subtitle: `${est.projectName} • ${est.projectOwner}`,
      columns: { headers, widths },
      rows,
      logo,
      landscape: true,
      fitToPage: true, // auto-scale bila lebar melebihi halaman
      condense: true, // font & padding sedikit dipadatkan
      pageSize: "A4", // naik ke A3 otomatis jika fitToPage perlu
    });

    const fileName = `Volume_${sanitizeFileName(est.projectName)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdf);
  } catch (e) {
    console.error("downloadVolumePdf error:", e);
    res.status(500).json({ error: "Failed to generate Volume PDF" });
  }
};

// ========== 2) Job Item Dipakai ==========
export const downloadJobItemPdf = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const est = await loadEstimation(userId, id);
    if (!est)
      return void res.status(404).json({ error: "Estimation not found" });

    const uniq = new Map<string, { desk: string; sat: string; hs: number }>();
    for (const it of est.items) {
      for (const d of it.details) {
        const kode = d.hspItem?.kode || d.kode || "";
        const desk = d.hspItem?.deskripsi || d.deskripsi || "-";
        const sat = d.hspItem?.satuan || d.satuan || "-";
        const hs = Number(d.hargaSatuan || 0);
        const key = kode ? `K:${kode}` : `D:${desk}|S:${sat}`;
        if (!uniq.has(key)) uniq.set(key, { desk, sat, hs });
      }
    }
    const rows = [...uniq.values()].map((r) => [r.desk, r.sat, r.hs]);

    const logo = await resolveLogoDataUrl(req, est.imageUrl);
    const pdf = await buildTablePdf({
      title: "Job Item Dipakai",
      subtitle: `${est.projectName} • ${est.projectOwner}`,
      columns: {
        headers: ["Nama Pekerjaan", "Satuan", "Harga Satuan (Rp)"],
        widths: [420, 70, 120],
      },
      rows,
      logo,
      landscape: true,
    });

    const fileName = `JobItem_${sanitizeFileName(est.projectName)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdf);
  } catch (e) {
    console.error("downloadJobItemPdf error:", e);
    res.status(500).json({ error: "Failed to generate Job Item PDF" });
  }
};

// ========== 3) Kategori Dipakai ==========
export const downloadKategoriPdf = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const est = await loadEstimation(userId, id);
    if (!est)
      return void res.status(404).json({ error: "Estimation not found" });

    const totalsByCat = new Map<string, number>();
    for (const section of est.items) {
      for (const d of section.details) {
        const catName =
          section.title?.trim() ||
          d.hspItem?.category?.name?.trim() ||
          "Lainnya";
        const jumlah =
          (typeof d.hargaTotal === "number" ? d.hargaTotal : undefined) ??
          Number(d.volume || 0) * Number(d.hargaSatuan || 0);
        totalsByCat.set(
          catName,
          (totalsByCat.get(catName) || 0) + Number(jumlah || 0)
        );
      }
    }
    const rows = [...totalsByCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, total]) => [name, total]);

    const logo = await resolveLogoDataUrl(req, est.imageUrl);
    const pdf = await buildTablePdf({
      title: "Kategori Dipakai",
      subtitle: `${est.projectName} • ${est.projectOwner}`,
      columns: {
        headers: ["Kategori", "Total (Rp)"],
        widths: [460, 150],
      },
      rows,
      logo,
      landscape: true,
    });

    const fileName = `Kategori_${sanitizeFileName(est.projectName)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdf);
  } catch (e) {
    console.error("downloadKategoriPdf error:", e);
    res.status(500).json({ error: "Failed to generate Kategori PDF" });
  }
};

// ========== 4) AHSP Dipakai ==========
export const downloadAHSPPdf = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const est = await loadEstimation(userId, id);
    if (!est)
      return void res.status(404).json({ error: "Estimation not found" });

    // Kumpulkan AHSP unik (urutan by kode seperti Excel)
    const uniqHsp = new Map<string, { hsp: any }>();
    for (const sec of est.items) {
      for (const d of sec.details) {
        const h = d.hspItem;
        if (!h) continue;
        if (!uniqHsp.has(h.id)) uniqHsp.set(h.id, { hsp: h });
      }
    }
    const blocks = [...uniqHsp.values()].sort((a, b) =>
      (a.hsp.kode || "").localeCompare(b.hsp.kode || "")
    );

    const logo = await resolveLogoDataUrl(req, est.imageUrl);

    const pdf = await buildAhspPdf({
      title: "AHSP Dipakai",
      subtitle: `${est.projectName} • ${est.projectOwner}`,
      blocks: blocks as any,
      logo,
      pageSize: "LEGAL",
      landscape: true,
      condense: true,
    });

    const fileName = `AHSP_${sanitizeFileName(est.projectName)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdf);
  } catch (e) {
    console.error("downloadAHSPPdf error:", e);
    res.status(500).json({ error: "Failed to generate AHSP PDF" });
  }
};

// ========== 5) Master Item Dipakai ==========
export const downloadMasterItemPdf = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const est = await loadEstimation(userId, id);
    if (!est)
      return void res.status(404).json({ error: "Estimation not found" });

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
    const N = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

    for (const sec of est.items) {
      for (const d of sec.details) {
        const h = d.hspItem;
        if (!h || !h.ahsp) continue;
        const hspCode = h.kode || "";
        for (const c of h.ahsp.components || []) {
          const m = c.masterItem;
          if (!m) continue;
          const idm = m.id;
          const eff = N(c.effectiveUnitPrice ?? c.priceOverride ?? m.price, 0);
          const sub = N(c.subtotal, N(c.coefficient, 1) * eff);
          if (!agg.has(idm)) {
            agg.set(idm, {
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
          const a = agg.get(idm)!;
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

    const logo = await resolveLogoDataUrl(req, est.imageUrl);
    const pdf = await buildTablePdf({
      title: "Master Item Dipakai",
      subtitle: `${est.projectName} • ${est.projectOwner}`,
      columns: {
        headers: [
          "Kode",
          "Nama",
          "Satuan",
          "Tipe",
          "Harga (Master)",
          "Dipakai di HSP (unik)",
          "Total Subtotal AHSP",
          "Catatan",
        ],
        widths: [70, 200, 55, 60, 90, 90, 110, 120],
      },
      rows,
      logo,
      landscape: true,
      condense: true,
      fitToPage: true,
      pageSize: "LEGAL",
    });

    const fileName = `MasterItem_${sanitizeFileName(est.projectName)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdf);
  } catch (e) {
    console.error("downloadMasterItemPdf error:", e);
    res.status(500).json({ error: "Failed to generate Master Item PDF" });
  }
};
