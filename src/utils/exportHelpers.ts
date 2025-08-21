import {
  CustomField,
  Estimation,
  EstimationItem,
  ItemDetail,
  User,
} from "@prisma/client";

type EstimationWithRelations = Estimation & {
  author: Pick<User, "id" | "name" | "email">;
  customFields: CustomField[];
  items: (EstimationItem & { details: ItemDetail[] })[];
};

export function calcTotals(est: EstimationWithRelations) {
  const subtotal = est.items.reduce((acc, it) => {
    const sumDetails = it.details.reduce(
      (a, d) => a + Number(d.hargaTotal || 0),
      0
    );
    return acc + sumDetails;
  }, 0);
  const ppnAmount = (Number(est.ppn || 0) / 100) * subtotal;
  const grandTotal = subtotal + ppnAmount;
  return { subtotal, ppnAmount, grandTotal };
}

export function formatCurrencyIDR(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^\w\d-_]+/g, "_");
}
