export const scopeOf = (userId?: string) => (userId ? `u:${userId}` : "GLOBAL");

/**
 * Merge prioritas user > global berdasarkan key unik (kode/name)
 * `keyFn` harus mengembalikan kunci string yang sama untuk dua scope.
 */
export function mergeUserOverGlobal<T>(
  userRows: T[],
  globalRows: T[],
  keyFn: (row: T) => string
): T[] {
  const map = new Map<string, T>();
  for (const g of globalRows) map.set(keyFn(g), g);
  for (const u of userRows) map.set(keyFn(u), u); // overwrite global
  return Array.from(map.values());
}
