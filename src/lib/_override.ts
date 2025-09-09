export type WithFlags = { isDeleted?: boolean; isDisabled?: boolean };

export type SourceMeta = {
  source: "USER" | "ADMIN";
  hasUserOverride: boolean;
  userActive: boolean;
};

export function pickEffective<T extends WithFlags>(
  user: T | null | undefined,
  admin: T | null | undefined
): { chosen: T | null; meta: SourceMeta } {
  const uExists = !!user && !user.isDeleted;
  const uActive = !!user && !user.isDeleted && !user.isDisabled;
  const aOk = !!admin && !admin.isDeleted;

  if (uActive) {
    return {
      chosen: user!,
      meta: { source: "USER", hasUserOverride: uExists, userActive: true },
    };
  }
  if (aOk) {
    return {
      chosen: admin!,
      meta: { source: "ADMIN", hasUserOverride: uExists, userActive: false },
    };
  }
  return {
    chosen: null,
    meta: { source: "ADMIN", hasUserOverride: uExists, userActive: false },
  };
}
