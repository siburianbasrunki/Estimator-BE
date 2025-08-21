-- CreateEnum
CREATE TYPE "MasterItemType" AS ENUM ('LABOR', 'MATERIAL', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AHSPComponentGroup" AS ENUM ('LABOR', 'MATERIAL', 'EQUIPMENT', 'OTHER');

-- AlterTable
ALTER TABLE "hsp_items" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "item_details" ADD COLUMN     "hspItemId" TEXT;

-- CreateTable
CREATE TABLE "master_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "type" "MasterItemType" NOT NULL,
    "hourlyRate" DOUBLE PRECISION,
    "dailyRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_recipes" (
    "id" TEXT NOT NULL,
    "hspItemId" TEXT NOT NULL,
    "overheadPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "subtotalABC" DOUBLE PRECISION,
    "overheadAmount" DOUBLE PRECISION,
    "finalUnitPrice" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ahsp_components" (
    "id" TEXT NOT NULL,
    "ahspId" TEXT NOT NULL,
    "group" "AHSPComponentGroup" NOT NULL,
    "masterItemId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitSnapshot" TEXT NOT NULL,
    "unitPriceSnapshot" DOUBLE PRECISION NOT NULL,
    "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "priceOverride" DOUBLE PRECISION,
    "effectiveUnitPrice" DOUBLE PRECISION,
    "subtotal" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_items_code_key" ON "master_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ahsp_recipes_hspItemId_key" ON "ahsp_recipes"("hspItemId");

-- CreateIndex
CREATE INDEX "ahsp_components_ahspId_group_order_idx" ON "ahsp_components"("ahspId", "group", "order");

-- AddForeignKey
ALTER TABLE "item_details" ADD CONSTRAINT "item_details_hspItemId_fkey" FOREIGN KEY ("hspItemId") REFERENCES "hsp_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_recipes" ADD CONSTRAINT "ahsp_recipes_hspItemId_fkey" FOREIGN KEY ("hspItemId") REFERENCES "hsp_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_components" ADD CONSTRAINT "ahsp_components_ahspId_fkey" FOREIGN KEY ("ahspId") REFERENCES "ahsp_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ahsp_components" ADD CONSTRAINT "ahsp_components_masterItemId_fkey" FOREIGN KEY ("masterItemId") REFERENCES "master_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
