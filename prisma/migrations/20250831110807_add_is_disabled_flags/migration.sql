-- AlterTable
ALTER TABLE "hsp_items" ADD COLUMN     "isDisabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "master_items" ADD COLUMN     "isDisabled" BOOLEAN NOT NULL DEFAULT false;
