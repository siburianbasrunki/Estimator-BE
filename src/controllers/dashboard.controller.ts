import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function addMonths(date: Date, n: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}
function fmtYM(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}
function labelIDShort(d: Date) {
  return new Intl.DateTimeFormat("id-ID", { month: "short" }).format(d);
}

/**
 * GET /api/dashboard/estimation-monthly?months=7
 * Akumulasi total (subtotal + PPN) per bulan (berdasarkan createdAt, timezone Asia/Jakarta)
 * hanya untuk estimations milik user login (req.userId)
 */
export const getEstimationMonthly = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    const months = Math.max(
      1,
      Math.min(24, parseInt(String(req.query.months || "7"), 10))
    );
    const now = new Date();
    const start = startOfMonth(addMonths(now, -(months - 1))); // awal bulan N bulan lalu

    // NOTE:
    // - timezone('Asia/Jakarta', e."createdAt") untuk grouping sesuai WIB
    // - subtotal per estimation = SUM(COALESCE(hargaTotal, volume*hargaSatuan))
    // - total estimation = subtotal * (1 + ppn/100)
    // - total per bulan = SUM(total estimation) di bulan itu
    type Row = { ym: Date; total: number };

    const rows: Row[] = await prisma.$queryRaw<Row[]>(Prisma.sql`
  WITH est AS (
    SELECT
      e.id,
      e.ppn,
      date_trunc('month', timezone('Asia/Jakarta', e."createdAt")) AS ym,
      SUM(COALESCE(d."hargaTotal", d.volume * d."hargaSatuan")) AS subtotal
    FROM "estimations" e
    JOIN "estimation_items" ei ON ei."estimationId" = e.id
    JOIN "item_details" d ON d."estimationItemId" = ei.id
    WHERE e."authorId" = ${userId}
      AND e."createdAt" >= ${start}
    GROUP BY e.id, e.ppn, ym
  )
  SELECT
    ym,
    SUM(subtotal * (1 + ppn / 100.0)) AS total
  FROM est
  GROUP BY ym
  ORDER BY ym ASC;
`);

    // Build buckets YYYY-MM -> total
    const map = new Map<string, number>();
    for (const r of rows) {
      // r.ym adalah timestamp awal bulan dalam WIB, treat as UTC date object for keying
      const key = fmtYM(r.ym);
      map.set(key, Number(r.total || 0));
    }

    // Compose labels & series berurutan dari start..now per bulan
    const labels: string[] = [];
    const series: number[] = [];
    for (let i = 0; i < months; i++) {
      const d = addMonths(start, i);
      labels.push(labelIDShort(d)); // "Jan", "Feb", ...
      series.push(map.get(fmtYM(d)) ?? 0);
    }

    res.json({
      status: "success",
      data: {
        labels,
        series,
        from: start.toISOString(),
        to: now.toISOString(),
      },
    });
  } catch (err) {
    console.error("getEstimationMonthly error:", err);
    res
      .status(500)
      .json({ status: "error", error: "Failed to load monthly stats" });
  }
};
