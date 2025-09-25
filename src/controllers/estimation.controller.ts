// src/controllers/estimation.controller.ts
import { Request, Response } from "express";
import prisma from "../lib/prisma";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  forcePngDelivery,
} from "../utils/cloudinaryUpload";
import { sanitizeFileName } from "../utils/exportHelpers";
import {
  buildEstimationPdf,
  EstimationWithRelations,
} from "../utils/pdfGenerator";
import { buildEstimationExcel } from "../utils/excelGenerator";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import axios from "axios";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}

function parseMaybeJson<T = any>(v: unknown): T {
  if (v == null) return v as T;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {}
  }
  return v as T;
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
 * Helpers HSP & Flatten item
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

type ItemInput = {
  kode?: string;
  nama?: string;
  satuan?: string;
  harga?: number;
  volume?: number;
  hargaTotal?: number;
  details?: Array<{
    nama?: string;
    jenis?: string; // "penjumlahan" | "pengurangan"
    panjang?: number;
    lebar?: number;
    tinggi?: number;
    jumlah?: number;
    volume?: number;
    extras?: any[];
  }>;
  children?: ItemInput[]; // NEW: sub-items (a., b., c.)
};

type SectionInput =
  | {
      title: string; // kategori
      item: ItemInput[]; // format lama
      groups?: never;
    }
  | {
      title: string; // kategori
      groups: Array<{ title: string; items: ItemInput[] }>; // format baru
      item?: never;
    };

function collectCodesFromItems(items?: ItemInput[], acc: string[] = []) {
  for (const it of items ?? []) {
    if (it?.kode) acc.push(it.kode);
    if (it?.children?.length) collectCodesFromItems(it.children, acc);
  }
  return acc;
}

function flattenItemsWithOrder(
  items: ItemInput[],
  opts: { estimationItemId: string; jobGroupId?: string }
) {
  const rows: Array<{
    row: Prisma.ItemDetailCreateManyInput;
    children?: ItemInput[];
    details?: ItemInput["details"];
  }> = [];

  let localOrder = 0;
  for (const it of items ?? []) {
    localOrder += 1;
    const id = randomUUID();
    rows.push({
      row: {
        id,
        estimationItemId: opts.estimationItemId,
        jobGroupId: opts.jobGroupId ?? null,
        parentDetailId: null,
        order: localOrder,
        kode: it.kode ?? "",
        deskripsi: it.nama ?? "",
        volume: Number(it.volume ?? 0),
        satuan: it.satuan ?? "",
        hargaSatuan: Number(it.harga ?? 0),
        hargaTotal: Number(it.hargaTotal ?? 0),
        hspItemId: undefined, // diisi setelah map kode -> HSP id
      },
      children: it.children,
      details: it.details,
    });
  }
  return rows;
}

async function insertItemsWithChildrenAndVolume(
  tx: Prisma.TransactionClient,
  flat: ReturnType<typeof flattenItemsWithOrder>,
  hspMap: Map<string, string>
) {
  // 1) isi hspItemId parents
  for (const f of flat) {
    if (f.row.kode) {
      const hspId = hspMap.get(f.row.kode);
      if (hspId) (f.row as any).hspItemId = hspId;
    }
  }

  // 2) insert parent items
  if (flat.length)
    await tx.itemDetail.createMany({ data: flat.map((f) => f.row) });

  // 3) volumeDetails untuk parent
  const volRowsParent: Prisma.VolumeDetailCreateManyInput[] = [];
  for (const f of flat) {
    for (const d of f.details ?? []) {
      volRowsParent.push({
        id: randomUUID(),
        nama: d?.nama ?? "",
        jenis: mapJenisToVolumeOp(d?.jenis || "penjumlahan"),
        panjang: Number(d?.panjang ?? 0),
        lebar: Number(d?.lebar ?? 0),
        tinggi: Number(d?.tinggi ?? 0),
        jumlah: Number(d?.jumlah ?? 0),
        volume: Number(d?.volume ?? 0),
        extras: Array.isArray(d?.extras) ? d.extras : [],
        itemDetailId: f.row.id,
      });
    }
  }
  if (volRowsParent.length)
    await tx.volumeDetail.createMany({ data: volRowsParent });

  // 4) children (1 level; extendable jika mau nested >1)
  for (const f of flat) {
    if (!f.children?.length) continue;

    let childOrder = 0;
    const childRows: Prisma.ItemDetailCreateManyInput[] = [];
    const volRowsChild: Prisma.VolumeDetailCreateManyInput[] = [];

    for (const ch of f.children) {
      childOrder += 1;
      const cid = randomUUID();
      childRows.push({
        id: cid,
        estimationItemId: f.row.estimationItemId,
        jobGroupId: f.row.jobGroupId ?? null,
        parentDetailId: f.row.id,
        order: childOrder,
        kode: ch.kode ?? "",
        deskripsi: ch.nama ?? "",
        volume: Number(ch.volume ?? 0),
        satuan: ch.satuan ?? "",
        hargaSatuan: Number(ch.harga ?? 0),
        hargaTotal: Number(ch.hargaTotal ?? 0),
        hspItemId: ch.kode ? (hspMap.get(ch.kode) ?? undefined) : undefined,
      });

      for (const d of ch.details ?? []) {
        volRowsChild.push({
          id: randomUUID(),
          nama: d?.nama ?? "",
          jenis: mapJenisToVolumeOp(d?.jenis || "penjumlahan"),
          panjang: Number(d?.panjang ?? 0),
          lebar: Number(d?.lebar ?? 0),
          tinggi: Number(d?.tinggi ?? 0),
          jumlah: Number(d?.jumlah ?? 0),
          volume: Number(d?.volume ?? 0),
          extras: Array.isArray(d?.extras) ? d.extras : [],
          itemDetailId: cid,
        });
      }
    }

    if (childRows.length) await tx.itemDetail.createMany({ data: childRows });
    if (volRowsChild.length)
      await tx.volumeDetail.createMany({ data: volRowsChild });
  }
}

/* =========================================================
 * CREATE ESTIMATION (mendukung groups + children)
 * =======================================================*/
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

    // Ambil field primitive langsung dari req.body
    const { projectName, owner, ppn, notes } = req.body as any;

    // ⬇️ PARSE field kompleks yg mungkin string dari multipart
    const customFields = parseMaybeJson<Record<string, string>>(
      req.body?.customFields
    );
    const estimationItem = parseMaybeJson<SectionInput[]>(
      req.body?.estimationItem
    );

    if (!projectName || !owner || ppn === undefined) {
      res
        .status(400)
        .json({ error: "Missing required fields: projectName, owner, ppn" });
      return;
    }

    let imageUrl: string | null = null;
    let imageId: string | null = null;

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

      // customFields (object)
      if (
        customFields &&
        typeof customFields === "object" &&
        Object.keys(customFields).length > 0
      ) {
        const rows = Object.entries(customFields).map(([label, value]) => ({
          id: randomUUID(),
          label,
          value,
          type: "text",
          estimationId: newEst.id,
        }));
        await tx.customField.createMany({ data: rows });
      }

      // estimationItem (array) — dukung 2 format + children
      if (Array.isArray(estimationItem) && estimationItem.length > 0) {
        // kumpulkan semua kode untuk build map HSP sekali
        const codes: string[] = [];
        for (const section of estimationItem) {
          if ("item" in section && Array.isArray(section.item)) {
            collectCodesFromItems(section.item, codes);
          }
          if ("groups" in section && Array.isArray(section.groups)) {
            for (const g of section.groups)
              collectCodesFromItems(g.items, codes);
          }
        }
        const hspMap = await buildHspCodeMap(tx, userId, codes);

        for (const section of estimationItem) {
          const estItemId = randomUUID();
          await tx.estimationItem.create({
            data: {
              id: estItemId,
              title: String(section?.title ?? ""),
              estimationId: newEst.id,
            },
          });

          // (A) format baru dgn groups
          if (
            "groups" in section &&
            Array.isArray(section.groups) &&
            section.groups.length
          ) {
            let groupOrder = 0;
            for (const g of section.groups) {
              groupOrder += 1;
              const gid = randomUUID();
              await tx.estimationJobGroup.create({
                data: {
                  id: gid,
                  title: String(g.title ?? ""),
                  order: groupOrder,
                  estimationItemId: estItemId,
                },
              });

              const flat = flattenItemsWithOrder(g.items ?? [], {
                estimationItemId: estItemId,
                jobGroupId: gid,
              });
              await insertItemsWithChildrenAndVolume(tx, flat, hspMap);
            }
          }

          // (B) format lama tanpa groups (langsung item)
          if (
            "item" in section &&
            Array.isArray(section.item) &&
            section.item.length
          ) {
            const flat = flattenItemsWithOrder(section.item, {
              estimationItemId: estItemId,
            });
            await insertItemsWithChildrenAndVolume(tx, flat, hspMap);
          }
        }
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
            groups: {
              orderBy: { order: "asc" },
              include: {
                details: {
                  where: { parentDetailId: null },
                  orderBy: { order: "asc" },
                  include: {
                    children: { orderBy: { order: "asc" } },
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
            // top-level items tanpa group
            details: {
              where: { jobGroupId: null, parentDetailId: null },
              orderBy: { order: "asc" },
              include: {
                children: { orderBy: { order: "asc" } },
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
 * LIST / GET BY ID (include struktur baru)
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
          items: {
            include: {
              groups: {
                orderBy: { order: "asc" },
                include: {
                  details: {
                    where: { parentDetailId: null },
                    orderBy: { order: "asc" },
                    include: {
                      children: { orderBy: { order: "asc" } },
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
              details: {
                where: { jobGroupId: null, parentDetailId: null },
                orderBy: { order: "asc" },
                include: {
                  children: { orderBy: { order: "asc" } },
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
        items: {
          include: {
            groups: {
              orderBy: { order: "asc" },
              include: {
                details: {
                  where: { parentDetailId: null },
                  orderBy: { order: "asc" },
                  include: {
                    children: { orderBy: { order: "asc" } },
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
            details: {
              where: { jobGroupId: null, parentDetailId: null },
              orderBy: { order: "asc" },
              include: {
                children: { orderBy: { order: "asc" } },
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

    res.status(200).json({ status: "success", data: estimation });
  } catch (error) {
    console.error("Get estimation by ID error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to get estimation" });
  }
};

/* =========================================================
 * UPDATE ESTIMATION (hapus & tulis ulang; dukung groups + children)
 * =======================================================*/
export const updateEstimation = async (
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
      select: { id: true },
    });
    if (!exists)
      return void res
        .status(404)
        .json({ status: "error", error: "Estimation not found" });

    // Ambil primitive
    const { projectName, owner, ppn, notes } = req.body as any;

    // ⬇️ PARSE field kompleks (bisa string dari multipart)
    const customFields = parseMaybeJson<Record<string, string>>(
      req.body?.customFields
    );
    const estimationItem = parseMaybeJson<SectionInput[]>(
      req.body?.estimationItem
    );

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

      // customFields (object)
      if (customFields) {
        await tx.customField.deleteMany({ where: { estimationId: id } });
        const entries = Object.entries(customFields || {});
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

      // estimationItem (array) — rewrite total
      if (Array.isArray(estimationItem)) {
        // Hapus berurutan (volume -> item -> group -> section)
        await tx.volumeDetail.deleteMany({
          where: { itemDetail: { estimationItem: { estimationId: id } } },
        });
        await tx.itemDetail.deleteMany({
          where: { estimationItem: { estimationId: id } },
        });
        await tx.estimationJobGroup.deleteMany({
          where: { estimationItem: { estimationId: id } },
        });
        await tx.estimationItem.deleteMany({ where: { estimationId: id } });

        // Kumpulkan kode utk HSP map
        const codes: string[] = [];
        for (const section of estimationItem ?? []) {
          if ("item" in section && Array.isArray(section.item)) {
            collectCodesFromItems(section.item, codes);
          }
          if ("groups" in section && Array.isArray(section.groups)) {
            for (const g of section.groups)
              collectCodesFromItems(g.items, codes);
          }
        }
        const hspMap = await buildHspCodeMap(tx, userId, codes);

        // Tulis ulang
        for (const section of estimationItem) {
          const estItemId = randomUUID();
          await tx.estimationItem.create({
            data: {
              id: estItemId,
              title: String(section?.title ?? ""),
              estimationId: id,
            },
          });

          if (
            "groups" in section &&
            Array.isArray(section.groups) &&
            section.groups.length
          ) {
            let groupOrder = 0;
            for (const g of section.groups) {
              groupOrder += 1;
              const gid = randomUUID();
              await tx.estimationJobGroup.create({
                data: {
                  id: gid,
                  title: String(g.title ?? ""),
                  order: groupOrder,
                  estimationItemId: estItemId,
                },
              });

              const flat = flattenItemsWithOrder(g.items ?? [], {
                estimationItemId: estItemId,
                jobGroupId: gid,
              });
              await insertItemsWithChildrenAndVolume(tx, flat, hspMap);
            }
          }

          if (
            "item" in section &&
            Array.isArray(section.item) &&
            section.item.length
          ) {
            const flat = flattenItemsWithOrder(section.item, {
              estimationItemId: estItemId,
            });
            await insertItemsWithChildrenAndVolume(tx, flat, hspMap);
          }
        }
      }

      return { updatedId: id };
    });

    const fullEstimation = await prisma.estimation.findUnique({
      where: { id: updatedId },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: {
          include: {
            groups: {
              orderBy: { order: "asc" },
              include: {
                details: {
                  where: { parentDetailId: null },
                  orderBy: { order: "asc" },
                  include: {
                    children: { orderBy: { order: "asc" } },
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
            details: {
              where: { jobGroupId: null, parentDetailId: null },
              orderBy: { order: "asc" },
              include: {
                children: { orderBy: { order: "asc" } },
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

/* =========================================================
 * DELETE / STATS (tidak berubah)
 * =======================================================*/
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
        where: {
          estimationItem: { estimationId: id },
          parentDetailId: { not: null },
        },
      });
      await tx.itemDetail.deleteMany({
        where: {
          estimationItem: { estimationId: id },
          parentDetailId: null,
        },
      });

      await tx.estimationJobGroup.deleteMany({
        where: { estimationItem: { estimationId: id } },
      });

      await tx.customField.deleteMany({ where: { estimationId: id } });

      await tx.estimationItem.deleteMany({ where: { estimationId: id } });

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
 * DOWNLOADERS (include struktur baru)
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
            groups: {
              orderBy: { order: "asc" },
              include: {
                details: {
                  where: { parentDetailId: null },
                  orderBy: { order: "asc" },
                  include: {
                    children: { orderBy: { order: "asc" } },
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
            details: {
              where: { jobGroupId: null, parentDetailId: null },
              orderBy: { order: "asc" },
              include: {
                children: { orderBy: { order: "asc" } },
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
        // silent
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
        items: {
          include: {
            groups: {
              orderBy: { order: "asc" },
              include: {
                details: {
                  where: { parentDetailId: null },
                  orderBy: { order: "asc" },
                  include: {
                    children: { orderBy: { order: "asc" } },
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
            details: {
              where: { jobGroupId: null, parentDetailId: null },
              orderBy: { order: "asc" },
              include: {
                children: { orderBy: { order: "asc" } },
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
      return void res
        .status(404)
        .json({ status: "error", error: "Estimation not found" });
    }

    // siapkan logo jadi dataURL PNG (opsional)
    let logoDataUrl: string | undefined;
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
      const b64 = Buffer.from(resp.data).toString("base64");
      logoDataUrl = `data:image/png;base64,${b64}`;
    } else if (estimation.imageUrl) {
      try {
        const pngUrl = forcePngDelivery(estimation.imageUrl);
        const resp = await axios.get<ArrayBuffer>(pngUrl, {
          responseType: "arraybuffer",
        });
        const b64 = Buffer.from(resp.data).toString("base64");
        logoDataUrl = `data:image/png;base64,${b64}`;
      } catch {
        /* jalan tanpa logo */
      }
    }

    const safeName = sanitizeFileName(estimation.projectName);
    const fileName = `RAB_${safeName}.pdf`;

    const pdfBuffer = await buildEstimationPdf(
      estimation as unknown as EstimationWithRelations,
      {
        logo: logoDataUrl
          ? { dataUrl: logoDataUrl, width: 110, height: 36 }
          : undefined,
        landscape: true,
        titleOverride: "Rencana Anggaran Biaya",
        includeAhsp: false,
        includeVolume: false,
      }
    );

    if (tempLogoPublicId) {
      try {
        await deleteFromCloudinary(tempLogoPublicId);
      } catch {}
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    res.status(200).send(pdfBuffer);
  } catch (error) {
    if (tempLogoPublicId) {
      try {
        await deleteFromCloudinary(tempLogoPublicId);
      } catch {}
    }
    console.error("Download PDF error:", error);
    res.status(500).json({ status: "error", error: "Failed to generate PDF" });
  }
};
