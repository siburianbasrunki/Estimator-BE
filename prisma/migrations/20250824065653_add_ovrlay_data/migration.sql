/*
  Warnings:

  - A unique constraint covering the columns `[scope,name]` on the table `hsp_categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[scope,kode]` on the table `hsp_items` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[scope,code]` on the table `master_items` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "hsp_categories_name_key";

-- DropIndex
DROP INDEX "hsp_items_kode_key";

-- DropIndex
DROP INDEX "master_items_code_key";

-- AlterTable
ALTER TABLE "ahsp_components" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ahsp_recipes" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "hsp_categories" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "hsp_items" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'GLOBAL';

-- AlterTable
ALTER TABLE "master_items" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ahsp_components_scope_idx" ON "ahsp_components"("scope");

-- CreateIndex
CREATE INDEX "ahsp_recipes_scope_idx" ON "ahsp_recipes"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "hsp_categories_scope_name_key" ON "hsp_categories"("scope", "name");

-- CreateIndex
CREATE INDEX "hsp_items_hspCategoryId_scope_idx" ON "hsp_items"("hspCategoryId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "hsp_items_scope_kode_key" ON "hsp_items"("scope", "kode");

-- CreateIndex
CREATE INDEX "master_items_scope_type_name_idx" ON "master_items"("scope", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "master_items_scope_code_key" ON "master_items"("scope", "code");
