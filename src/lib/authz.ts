export type Role = "USER" | "ADMIN";

export function normalizeRole(r: unknown): Role | undefined {
  if (!r) return undefined;
  const s = String(r).trim().toUpperCase();
  return s === "ADMIN" || s === "USER" ? (s as Role) : undefined;
}