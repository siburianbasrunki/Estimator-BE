import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { uploadToCloudinary } from "../utils/cloudinaryUpload";
import { CreateEstimationData } from "../model/estimation";
import { sanitizeFileName } from "../utils/exportHelpers";
import { buildEstimationPdf } from "../utils/pdfGenerator";
import { buildEstimationExcel } from "../utils/excelGenerator";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}
const mapJenisToVolumeOp = (jenis: string): "ADD" | "SUB" =>
  jenis?.toLowerCase() === "pengurangan" ? "SUB" : "ADD";

// Create new estimation
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

    // Validasi input
    if (!projectName || !owner || ppn === undefined) {
      res.status(400).json({
        error: "Missing required fields: projectName, owner, ppn",
      });
      return;
    }

    // Upload gambar jika ada
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

    // Buat estimation dalam transaction
    const estimation = await prisma.$transaction(async (tx) => {
      // Buat estimation utama
      const newEstimation = await tx.estimation.create({
        data: {
          projectName,
          projectOwner: owner,
          ppn: parseFloat(ppn.toString()),
          notes: notes || "",
          authorId: userId,
        },
      });

      // Buat custom fields jika ada
      if (customFields && Object.keys(customFields).length > 0) {
        const customFieldsData = Object.entries(customFields).map(
          ([label, value]) => ({
            label,
            value,
            type: "text", // Default type, bisa disesuaikan
            estimationId: newEstimation.id,
          })
        );

        await tx.customField.createMany({
          data: customFieldsData,
        });
      }

      // Buat estimation items dan details
      if (estimationItem && estimationItem.length > 0) {
        for (const section of estimationItem) {
          const estimationItemRecord = await tx.estimationItem.create({
            data: {
              title: section.title,
              estimationId: newEstimation.id,
            },
          });

          if (section.item && section.item.length > 0) {
            for (const detail of section.item) {
              // 1) create ItemDetail
              const itemDetail = await tx.itemDetail.create({
                data: {
                  kode: detail.kode,
                  deskripsi: detail.nama,
                  volume: Number(detail.volume ?? 0),
                  satuan: detail.satuan,
                  hargaSatuan: Number(detail.harga ?? 0),
                  hargaTotal: Number(detail.hargaTotal ?? 0),
                  estimationItemId: estimationItemRecord.id,
                },
              });

              // 2) create VolumeDetail (jika ada)
              if (detail.details && detail.details.length > 0) {
                const vdData = detail.details.map((d) => ({
                  nama: d.nama,
                  jenis: mapJenisToVolumeOp(d.jenis), // "ADD" | "SUB"
                  panjang: Number(d.panjang ?? 0),
                  lebar: Number(d.lebar ?? 0),
                  tinggi: Number(d.tinggi ?? 0),
                  jumlah: Number(d.jumlah ?? 0),
                  volume: Number(d.volume ?? 0),
                  itemDetailId: itemDetail.id,
                }));

                await tx.volumeDetail.createMany({ data: vdData });
              }
            }
          }
        }
      }

      return newEstimation;
    });

    // Ambil data lengkap untuk response
    const fullEstimation = await prisma.estimation.findUnique({
      where: { id: estimation.id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        customFields: true,
        items: {
          include: {
            details: true,
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
    res.status(500).json({
      status: "error",
      error: "Failed to create estimation",
    });
  }
};

// Get all estimations for authenticated user
export const getEstimations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const { page = 1, limit = 10, search } = req.query;
    const pageNumber = parseInt(page as string);
    const limitNumber = parseInt(limit as string);
    const offset = (pageNumber - 1) * limitNumber;

    // Build where condition
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
              details: {
                include: {
                  volumeDetails: true, // <-- breakdown ikut dibawa
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
    res.status(500).json({
      status: "error",
      error: "Failed to get estimations",
    });
  }
};

// Get single estimation by ID
export const getEstimationById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const estimation = await prisma.estimation.findFirst({
      where: { id, authorId: userId },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: {
          include: {
            details: {
              include: {
                volumeDetails: true, // <-- breakdown ikut dibawa
              },
            },
          },
        },
      },
    });

    if (!estimation) {
      res.status(404).json({
        status: "error",
        error: "Estimation not found",
      });
      return;
    }

    res.status(200).json({
      status: "success",
      data: estimation,
    });
  } catch (error) {
    console.error("Get estimation by ID error:", error);
    res.status(500).json({
      status: "error",
      error: "Failed to get estimation",
    });
  }
};

// Update estimation
export const updateEstimation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
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

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    // Pastikan estimation milik user
    const existingEstimation = await prisma.estimation.findFirst({
      where: { id, authorId: userId },
    });

    if (!existingEstimation) {
      res.status(404).json({
        status: "error",
        error: "Estimation not found",
      });
      return;
    }

    // (opsional) upload image baru bila ada
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

    // Transaction
    const updatedEstimation = await prisma.$transaction(async (tx) => {
      // 1) Update estimation utama
      const updateData: any = {};
      if (projectName !== undefined) updateData.projectName = projectName;
      if (owner !== undefined) updateData.projectOwner = owner;
      if (ppn !== undefined) updateData.ppn = parseFloat(ppn.toString());
      if (notes !== undefined) updateData.notes = notes;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
      if (imageId !== undefined) updateData.imageId = imageId;

      await tx.estimation.update({
        where: { id },
        data: updateData,
      });

      // 2) Replace custom fields (jika dikirim)
      if (customFields) {
        await tx.customField.deleteMany({ where: { estimationId: id } });

        if (Object.keys(customFields).length > 0) {
          const customFieldsData = Object.entries(customFields).map(
            ([label, value]) => ({
              label,
              value,
              type: "text",
              estimationId: id,
            })
          );
          await tx.customField.createMany({ data: customFieldsData });
        }
      }

      // 3) Replace items + details + volumeDetails (jika dikirim)
      if (estimationItem) {
        // hapus breakdown (VolumeDetail) -> ItemDetail -> EstimationItem
        await tx.volumeDetail.deleteMany({
          where: {
            itemDetail: {
              estimationItem: {
                estimationId: id,
              },
            },
          },
        });

        await tx.itemDetail.deleteMany({
          where: {
            estimationItem: {
              estimationId: id,
            },
          },
        });

        await tx.estimationItem.deleteMany({
          where: { estimationId: id },
        });

        // tulis ulang
        for (const section of estimationItem) {
          const estimationItemRecord = await tx.estimationItem.create({
            data: {
              title: section.title,
              estimationId: id,
            },
          });

          if (section.item && section.item.length > 0) {
            for (const detail of section.item) {
              // ItemDetail
              const itemDetail = await tx.itemDetail.create({
                data: {
                  kode: detail.kode,
                  deskripsi: detail.nama,
                  volume: Number(detail.volume ?? 0),
                  satuan: detail.satuan,
                  hargaSatuan: Number(detail.harga ?? 0),
                  hargaTotal: Number(detail.hargaTotal ?? 0),
                  estimationItemId: estimationItemRecord.id,
                },
              });

              // VolumeDetail (breakdown) jika ada
              if (detail.details && detail.details.length > 0) {
                const vdData = detail.details.map((d) => ({
                  nama: d.nama,
                  jenis: mapJenisToVolumeOp(d.jenis), // "ADD" | "SUB"
                  panjang: Number(d.panjang ?? 0),
                  lebar: Number(d.lebar ?? 0),
                  tinggi: Number(d.tinggi ?? 0),
                  jumlah: Number(d.jumlah ?? 0),
                  volume: Number(d.volume ?? 0), // p*l*t*jumlah (positif)
                  itemDetailId: itemDetail.id,
                }));

                await tx.volumeDetail.createMany({ data: vdData });
              }
            }
          }
        }
      }

      // return minimal entity for query berikutnya
      return { id };
    });

    // Ambil data lengkap untuk response (include sampai breakdown)
    const fullEstimation = await prisma.estimation.findUnique({
      where: { id: updatedEstimation.id },
      include: {
        author: { select: { id: true, name: true, email: true } },
        customFields: true,
        items: {
          include: {
            details: {
              include: {
                volumeDetails: true, // <— breakdown ikut dibawa
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
    res.status(500).json({
      status: "error",
      error: "Failed to update estimation",
    });
  }
};

// Delete estimation
export const deleteEstimation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    // Check if estimation exists and belongs to user
    const existingEstimation = await prisma.estimation.findFirst({
      where: {
        id,
        authorId: userId,
      },
    });

    if (!existingEstimation) {
      res.status(404).json({
        status: "error",
        error: "Estimation not found",
      });
      return;
    }

    // Delete estimation dalam transaction
    await prisma.$transaction(async (tx) => {
      // Delete item details
      await tx.itemDetail.deleteMany({
        where: {
          estimationItem: {
            estimationId: id,
          },
        },
      });

      // Delete estimation items
      await tx.estimationItem.deleteMany({
        where: { estimationId: id },
      });

      // Delete custom fields
      await tx.customField.deleteMany({
        where: { estimationId: id },
      });

      // Delete estimation
      await tx.estimation.delete({
        where: { id },
      });
    });

    res.status(200).json({
      status: "success",
      message: "Estimation deleted successfully",
    });
  } catch (error) {
    console.error("Delete estimation error:", error);
    res.status(500).json({
      status: "error",
      error: "Failed to delete estimation",
    });
  }
};

// Get estimation statistics for user
export const getEstimationStats = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const total = await prisma.estimation.count({
      where: { authorId: userId },
    });

    res.status(200).json({
      status: "success",
      data: {
        total,
      },
    });
  } catch (error) {
    console.error("Get estimation stats error:", error);
    res.status(500).json({
      status: "error",
      error: "Failed to get estimation statistics",
    });
  }
};

export const downloadEstimationPdf = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
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
      res.status(404).json({ status: "error", error: "Estimation not found" });
      return;
    }

    const fileName = `${sanitizeFileName(estimation.projectName)}_estimation.pdf`;
    const pdfBuffer = await buildEstimationPdf(estimation as any);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Download PDF error:", error);
    res.status(500).json({ status: "error", error: "Failed to generate PDF" });
  }
};

export const downloadEstimationExcel = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

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

    // >>> Perubahan di sini: nama file "RAB_<Nama Estimation>.xlsx"
    const safeName = sanitizeFileName(estimation.projectName);
    const fileName = `RAB_${safeName}.xlsx`;

    const excelBuffer = await buildEstimationExcel(estimation as any);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    // aman untuk spasi/UTF-8
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    res.status(200).send(excelBuffer);
  } catch (error) {
    console.error("Download Excel error:", error);
    res
      .status(500)
      .json({ status: "error", error: "Failed to generate Excel" });
  }
};
