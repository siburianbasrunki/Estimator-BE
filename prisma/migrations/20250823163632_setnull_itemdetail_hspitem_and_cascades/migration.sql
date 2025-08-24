-- DropForeignKey
ALTER TABLE "item_details" DROP CONSTRAINT "item_details_hspItemId_fkey";

-- AddForeignKey
ALTER TABLE "item_details" ADD CONSTRAINT "item_details_hspItemId_fkey" FOREIGN KEY ("hspItemId") REFERENCES "hsp_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
