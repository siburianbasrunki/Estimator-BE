import prisma from "../lib/prisma";

async function getEffectiveMasterPriceForScope(
  scope: string,               
  masterCode: string,         
  fallback: number             
): Promise<number> {
  const override = await prisma.masterItem.findUnique({
    where: { scope_code_unique: { scope, code: masterCode } },
    select: { price: true, isDeleted: true, isDisabled: true },
  }).catch(() => null);

  if (override && !override.isDeleted && !override.isDisabled) {
    return override.price ?? fallback;
  }
  return fallback;
}

export async function recomputeRecipesByMasterCode(masterCode: string) {
  const comps = await prisma.aHSPComponent.findMany({
    where: { masterItem: { code: masterCode } },
    select: { ahspId: true },
  });

  const ahspIds = Array.from(new Set(comps.map(c => c.ahspId)));
  if (ahspIds.length === 0) return;

  const recipes = await prisma.aHSPRecipe.findMany({
    where: { id: { in: ahspIds } },
    include: {
      components: {
        include: { masterItem: { select: { id: true, code: true, price: true } } },
        orderBy: [{ group: "asc" }, { order: "asc" }],
      },
      hspItem: true, 
    },
  });

  for (const recipe of recipes) {
    let A = 0, B = 0, C = 0;
    const compUpdates: any[] = [];

    for (const comp of recipe.components) {
      const fallback = comp.masterItem?.price ?? 0;
      const baseFromMaster = await getEffectiveMasterPriceForScope(
        recipe.hspItem.scope,      
        comp.masterItem?.code ?? "", 
        fallback
      );
      const effectiveUnitPrice = comp.priceOverride ?? baseFromMaster;
      const subtotal = (comp.coefficient ?? 1) * effectiveUnitPrice;

      compUpdates.push(
        prisma.aHSPComponent.update({
          where: { id: comp.id },
          data: { effectiveUnitPrice, subtotal },
        })
      );

      if (comp.group === "LABOR") A += subtotal;
      if (comp.group === "MATERIAL") B += subtotal;
      if (comp.group === "EQUIPMENT") C += subtotal;
    }

    const D = A + B + C;
    const E = D * (recipe.overheadPercent / 100);
    const F = D + E;

    await prisma.$transaction([
      ...compUpdates,
      prisma.aHSPRecipe.update({
        where: { id: recipe.id },
        data: { subtotalABC: D, overheadAmount: E, finalUnitPrice: F },
      }),
      prisma.hSPItem.update({
        where: { id: recipe.hspItem.id },
        data: { harga: F },
      }),
    ]);
  }
}
