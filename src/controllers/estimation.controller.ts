import { Request, Response } from "express";
import prisma from "../lib/prisma";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload";
import { CreateEstimationData } from "../model/estimation";
import { sanitizeFileName } from "../utils/exportHelpers";
import { buildEstimationPdf } from "../utils/pdfGenerator";
import { buildEstimationExcel } from "../utils/excelGenerator";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import axios from "axios";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}

const mapJenisToVolumeOp = (jenis: string): "ADD" | "SUB" =>
  jenis?.toLowerCase() === "pengurangan" ? "SUB" : "ADD";

/** =========================
 *  Helpers untuk logo base64
 * ========================= */
function guessExt(urlOrMime?: string): "png" | "jpeg" {
  const s = (urlOrMime || "").toLowerCase();
  if (s.includes("jpeg") || s.includes(".jpeg") || s.includes(".jpg"))
    return "jpeg";
  return "png";
}
function toBase64DataUrl(arrbuf: ArrayBuffer, ext: "png" | "jpeg") {
  const b64 = Buffer.from(arrbuf).toString("base64");
  return `data:image/${ext};base64,${b64}`;
}

/* =========================================================
 * CREATE ESTIMATION (dipersingkat: sama seperti punyamu)
 * =======================================================*/
async function buildHspCodeMap(
  tx: Prisma.TransactionClient,
  userId: string,
  rawCodes: string[]
) {
  const codes = Array.from(
    new Set((rawCodes || []).map((s) => (s || "").trim()).filter(Boolean))
  );
  if (!codes.length) return new Map<string, string>();

  const rows = await tx.hSPItem.findMany({
    where: {
      kode: { in: codes },
      isDeleted: false,
      OR: [{ scope: `u:${userId}` }, { scope: "GLOBAL" }],
    },
    select: { id: true, kode: true, scope: true },
  });

  const m = new Map<string, string>();
  for (const r of rows) {
    const prev = m.get(r.kode);
    if (!prev || r.scope.startsWith("u:")) m.set(r.kode, r.id);
  }
  return m;
}

export const createEstimation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const {
      projectName,
      owner,
      ppn,
      notes,
      customFields,
      estimationItem,
    }: CreateEstimationData = req.body;

    if (!projectName || !owner || ppn === undefined) {
      res.status(400).json({
        error: "Missing required fields: projectName, owner, ppn",
      });
      return;
    }

    let imageUrl: string | null = null;
    let imageId: string | null = null;

    // Upload header image (jika ada) via Cloudinary
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, {
        folder: "estimations",
        format: "webp",
      });
      imageUrl = uploadResult.imageUrl;
      imageId = uploadResult.imageId;
    }

    const { newEstimationId } = await prisma.$transaction(async (tx) => {
      const newEst = await tx.estimation.create({
        data: {
          projectName,
          projectOwner: owner,
          ppn: parseFloat(ppn.toString()),
          notes: notes || "",
          authorId: userId,
          imageUrl: imageUrl ?? undefined,
          imageId: imageId ?? undefined,
        },
        select: { id: true },
      });

      if (customFields && Object.keys(customFields).length > 0) {
        const rows = Object.entries(customFields).map(([label, value]) => ({
          id: randomUUID(),
          label,
          value,
          type: "text",
          estimationId: newEst.id,
        }));
        await tx.customField.createMany({ data: rows });
      }

      if (estimationItem && estimationItem.length > 0) {
        const estItemRows: {
          id: string;
          title: string;
          estimationId: string;
        }[] = [];
        const itemDetailRows: Prisma.ItemDetailCreateManyInput[] = [];
        const volDetailRows: {
          id: string;
          nama: string;
          jenis: "ADD" | "SUB";
          panjang: number;
          lebar: number;
          tinggi: number;
          jumlah: number;
          volume: number;
          extras: Prisma.InputJsonValue;
          itemDetailId: string;
        }[] = [];

        const allCodes: string[] = [];
        for (const section of estimationItem ?? []) {
          for (const detail of section.item ?? []) {
            if (detail.kode) allCodes.push(detail.kode);
          }
        }
        const hspMap = await buildHspCodeMap(tx, userId, allCodes);

        for (const section of estimationItem) {
          const estItemId = randomUUID();
          estItemRows.push({
            id: estItemId,
            title: section.title,
            estimationId: newEst.id,
          });

          for (const detail of section.item ?? []) {
            const itemId = randomUUID();
            const hspId = detail.kode ? hspMap.get(detail.kode) : undefined;
            itemDetailRows.push({
              id: itemId,
              kode: detail.kode ?? "",
              deskripsi: detail.nama ?? "",
              volume: Number(detail.volume ?? 0),
              satuan: detail.satuan ?? "",
              hargaSatuan: Number(detail.harga ?? 0),
              hargaTotal: Number(detail.hargaTotal ?? 0),
              estimationItemId: estItemId,
              hspItemId: hspId,
            });

            for (const d of detail.details ?? []) {
              volDetailRows.push({
                id: randomUUID(),
                nama: d.nama ?? "",
                jenis: mapJenisToVolumeOp(d.jenis),
                panjang: Number(d.panjang ?? 0),
                lebar: Number(d.lebar ?? 0),
                tinggi: Number(d.tinggi ?? 0),
                jumlah: Number(d.jumlah ?? 0),
                volume: Number(d.volume ?? 0),
                extras: Array.isArray(d.extras) ? d.extras : [],
                itemDetailId: itemId,
              });
            }
          }
        }

        if (estItemRows.length)
          await tx.estimationItem.createMany({ data: estItemRows });
        if (itemDetailRows.length)
          await tx.itemDetail.createMany({ data: itemDetailRows });
        if (volDetailRows.length)
          await tx.volumeDetail.createMany({ data: volDetailRows });
      }

      return { newEstimationId: newEst.id };
    });

    const fullEstimation = await prisma.estimation.findUnique({
      where: { id: newEstimationId },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: {
          include: {
            details: { include: { volumeDetails: true } },
          },
        },
      },
    });

    res.status(201).json({
      status: "success",
      message: "Estimation created successfully",
      data: fullEstimation,
    });
  } catch (error) {
    console.error("Create estimation error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to create estimation" });
  }
};

/* =========================================================
 * GET/LIST/UPDATE/DELETE/STATS (dipersingkat: sama seperti punyamu)
 * =======================================================*/
export const getEstimations = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const { page = 1, limit = 10, search } = req.query;
    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const offset = (pageNumber - 1) * limitNumber;

    const whereCondition: any = { authorId: userId };
    if (search) {
      whereCondition.OR = [
        { projectName: { contains: search as string, mode: "insensitive" } },
        { projectOwner: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const [estimations, total] = await Promise.all([
      prisma.estimation.findMany({
        where: whereCondition,
        include: {
          author: { select: { id: true, name: true, email: true } },
          customFields: true,
          items: { include: { details: { include: { volumeDetails: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limitNumber,
      }),
      prisma.estimation.count({ where: whereCondition }),
    ]);

    res.status(200).json({
      status: "success",
      data: estimations,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    });
  } catch (error) {
    console.error("Get estimations error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to get estimations" });
  }
};

export const getEstimationById = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const estimation = await prisma.estimation.findFirst({
      where: { id, authorId: userId },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: { include: { details: { include: { volumeDetails: true } } } },
      },
    });

    if (!estimation) {
      res.status(404).json({ status: "error", error: "Estimation not found" });
      return;
    }

    res.status(200).json({ status: "success", data: estimation });
  } catch (error) {
    console.error("Get estimation by ID error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to get estimation" });
  }
};

export const updateEstimation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const {
      projectName,
      owner,
      ppn,
      notes,
      customFields,
      estimationItem,
    }: Partial<CreateEstimationData> = req.body;

    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const exists = await prisma.estimation.findFirst({
      where: { id, authorId: userId },
      select: { id: true },
    });
    if (!exists)
      return void res
        .status(404)
        .json({ status: "error", error: "Estimation not found" });

    let imageUrl: string | undefined;
    let imageId: string | undefined;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, {
        folder: "estimations",
        format: "webp",
      });
      imageUrl = uploadResult.imageUrl;
      imageId = uploadResult.imageId;
    }

    const { updatedId } = await prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (projectName !== undefined) updateData.projectName = projectName;
      if (owner !== undefined) updateData.projectOwner = owner;
      if (ppn !== undefined) updateData.ppn = parseFloat(ppn.toString());
      if (notes !== undefined) updateData.notes = notes;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      if (imageId !== undefined) updateData.imageId = imageId;

      if (Object.keys(updateData).length) {
        await tx.estimation.update({ where: { id }, data: updateData });
      }

      if (customFields) {
        await tx.customField.deleteMany({ where: { estimationId: id } });
        const entries = Object.entries(customFields);
        if (entries.length > 0) {
          const rows = entries.map(([label, value]) => ({
            id: randomUUID(),
            label,
            value,
            type: "text",
            estimationId: id,
          }));
          await tx.customField.createMany({ data: rows });
        }
      }

      if (estimationItem) {
        await tx.volumeDetail.deleteMany({
          where: { itemDetail: { estimationItem: { estimationId: id } } },
        });
        await tx.itemDetail.deleteMany({
          where: { estimationItem: { estimationId: id } },
        });
        await tx.estimationItem.deleteMany({ where: { estimationId: id } });

        const estItemRows: {
          id: string;
          title: string;
          estimationId: string;
        }[] = [];
        const itemDetailRows: Prisma.ItemDetailCreateManyInput[] = [];
        const volDetailRows: {
          id: string;
          nama: string;
          jenis: "ADD" | "SUB";
          panjang: number;
          lebar: number;
          tinggi: number;
          jumlah: number;
          volume: number;
          extras: Prisma.InputJsonValue;
          itemDetailId: string;
        }[] = [];

        const allCodes: string[] = [];
        for (const section of estimationItem ?? []) {
          for (const detail of section.item ?? []) {
            if (detail.kode) allCodes.push(detail.kode);
          }
        }
        const hspMap = await buildHspCodeMap(tx, userId, allCodes);

        for (const section of estimationItem) {
          const estItemId = randomUUID();
          estItemRows.push({
            id: estItemId,
            title: section.title,
            estimationId: id,
          });

          for (const detail of section.item ?? []) {
            const itemId = randomUUID();
            const hspId = detail.kode ? hspMap.get(detail.kode) : undefined;
            itemDetailRows.push({
              id: itemId,
              kode: detail.kode ?? "",
              deskripsi: detail.nama ?? "",
              volume: Number(detail.volume ?? 0),
              satuan: detail.satuan ?? "",
              hargaSatuan: Number(detail.harga ?? 0),
              hargaTotal: Number(detail.hargaTotal ?? 0),
              estimationItemId: estItemId,
              hspItemId: hspId,
            });

            for (const d of detail.details ?? []) {
              volDetailRows.push({
                id: randomUUID(),
                nama: d.nama ?? "",
                jenis: mapJenisToVolumeOp(d.jenis),
                panjang: Number(d.panjang ?? 0),
                lebar: Number(d.lebar ?? 0),
                tinggi: Number(d.tinggi ?? 0),
                jumlah: Number(d.jumlah ?? 0),
                volume: Number(d.volume ?? 0),
                extras: Array.isArray(d.extras) ? d.extras : [],
                itemDetailId: itemId,
              });
            }
          }
        }

        if (estItemRows.length)
          await tx.estimationItem.createMany({ data: estItemRows });
        if (itemDetailRows.length)
          await tx.itemDetail.createMany({ data: itemDetailRows });
        if (volDetailRows.length)
          await tx.volumeDetail.createMany({ data: volDetailRows });
      }

      return { updatedId: id };
    });

    const fullEstimation = await prisma.estimation.findUnique({
      where: { id: updatedId },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: { include: { details: { include: { volumeDetails: true } } } },
      },
    });

    res.status(200).json({
      status: "success",
      message: "Estimation updated successfully",
      data: fullEstimation,
    });
  } catch (error) {
    console.error("Update estimation error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to update estimation" });
  }
};

export const deleteEstimation = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const exists = await prisma.estimation.findFirst({
      where: { id, authorId: userId },
    });
    if (!exists)
      return void res
        .status(404)
        .json({ status: "error", error: "Estimation not found" });

    await prisma.$transaction(async (tx) => {
      await tx.volumeDetail.deleteMany({
        where: { itemDetail: { estimationItem: { estimationId: id } } },
      });
      await tx.itemDetail.deleteMany({
        where: { estimationItem: { estimationId: id } },
      });
      await tx.estimationItem.deleteMany({ where: { estimationId: id } });
      await tx.customField.deleteMany({ where: { estimationId: id } });
      await tx.estimation.delete({ where: { id } });
    });

    res
      .status(200)
      .json({ status: "success", message: "Estimation deleted successfully" });
  } catch (error) {
    console.error("Delete estimation error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to delete estimation" });
  }
};

export const getEstimationStats = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

    const total = await prisma.estimation.count({
      where: { authorId: userId },
    });
    res.status(200).json({ status: "success", data: { total } });
  } catch (error) {
    console.error("Get estimation stats error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to get estimation statistics" });
  }
};

/* =========================================================
 * DOWNLOADERS
 * =======================================================*/

export const downloadEstimationExcel = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  let tempLogoPublicId: string | undefined;
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId)
      return void res.status(401).json({ error: "User not authenticated" });

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
                      include: {
                        components: { include: { masterItem: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!estimation) {
      res.status(404).json({ status: "error", error: "Estimation not found" });
      return;
    }

    // Siapkan logo base64 jika ada
    let logo:
      | {
          base64: string;
          extension: "png" | "jpeg";
        }
      | undefined;

    // Prioritas 1: file upload baru (logo sementara)
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) {
      const upload = await uploadToCloudinary(file.path, {
        folder: "estimations/export-logos",
        format: "png",
      });
      tempLogoPublicId = upload.imageId;

      const resp = await axios.get<ArrayBuffer>(upload.imageUrl, {
        responseType: "arraybuffer",
      });
      const ext = guessExt(upload.imageUrl);
      const base64 = toBase64DataUrl(resp.data, ext);
      logo = { base64, extension: ext };
    }
    // Prioritas 2: pakai logo yang tersimpan di estimation.imageUrl (fallback)
    else if (estimation.imageUrl) {
      try {
        const resp = await axios.get<ArrayBuffer>(estimation.imageUrl, {
          responseType: "arraybuffer",
        });
        const ext = guessExt(estimation.imageUrl);
        const base64 = toBase64DataUrl(resp.data, ext);
        logo = { base64, extension: ext };
      } catch {
        // silent: kalau gagal ambil logo fallback, lanjut tanpa logo
      }
    }

    const safeName = sanitizeFileName(estimation.projectName);
    const fileName = `RAB_${safeName}.xlsx`;

    const excelBuffer = await buildEstimationExcel(estimation as any, {
      logo,
      logoSize: { width: 240, height: 80 },
    });

    if (tempLogoPublicId) {
      try {
        await deleteFromCloudinary(tempLogoPublicId);
      } catch (e) {
        console.warn("Failed to cleanup temp logo on Cloudinary:", e);
      }
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(
        fileName
      )}`
    );
    res.status(200).send(excelBuffer);
  } catch (error) {
    console.error("Download Excel error:", error);
    if (tempLogoPublicId) {
      try {
        await deleteFromCloudinary(tempLogoPublicId);
      } catch {}
    }
    res
      .status(500)
      .json({ status: "error", error: "Failed to generate Excel" });
  }
};

export const downloadEstimationPdf = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  let tempLogoPublicId: string | undefined;
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      return void res
        .status(401)
        .json({ status: "error", error: "User not authenticated" });
    }

    const estimation = await prisma.estimation.findFirst({
      where: { id, authorId: userId },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: { include: { details: true } },
      },
    });

    if (!estimation) {
      return void res
        .status(404)
        .json({ status: "error", error: "Estimation not found" });
    }

    // --- Siapkan logo (upload → dataURL) ---
    let logoDataUrl: string | undefined;

    // Prioritas 1: file upload "logo"
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) {
      const up = await uploadToCloudinary(file.path, {
        folder: "estimations/export-logos",
        format: "png",
      });
      tempLogoPublicId = up.imageId;

      const resp = await axios.get<ArrayBuffer>(up.imageUrl, {
        responseType: "arraybuffer",
      });
      const ext = guessExt(up.imageUrl);
      logoDataUrl = toBase64DataUrl(resp.data, ext);
    }
    // Prioritas 2: estimation.imageUrl (fallback)
    else if (estimation.imageUrl) {
      try {
        const resp = await axios.get<ArrayBuffer>(estimation.imageUrl, {
          responseType: "arraybuffer",
        });
        const ext = guessExt(estimation.imageUrl);
        logoDataUrl = toBase64DataUrl(resp.data, ext);
      } catch {
        // fallback gagal → jalan tanpa logo
      }
    }

    const safeName = sanitizeFileName(estimation.projectName);
    const fileName = `RAB_${safeName}.pdf`;

    const pdfBuffer = await buildEstimationPdf(estimation as any, {
      logo: logoDataUrl
        ? { dataUrl: logoDataUrl, width: 110, height: 36 }
        : undefined,
      // isi identitas organisasi di sini jika perlu tampil di kop:
      // org: { name: "...", address: "...", phone: "...", email: "...", website: "..." },
      landscape: true,
      titleOverride: "Rencana Anggaran Biaya",
    });

    if (tempLogoPublicId) {
      try {
        await deleteFromCloudinary(tempLogoPublicId);
      } catch (e) {
        console.warn("Cleanup temp logo failed:", e);
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Download PDF error:", error);
    if (tempLogoPublicId) {
      try {
        await deleteFromCloudinary(tempLogoPublicId);
      } catch {}
    }
    res.status(500).json({ status: "error", error: "Failed to generate PDF" });
  }
};
