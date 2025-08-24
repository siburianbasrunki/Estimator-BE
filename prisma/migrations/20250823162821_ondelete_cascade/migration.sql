-- DropForeignKey
ALTER TABLE "hsp_items" DROP CONSTRAINT "hsp_items_hspCategoryId_fkey";

-- DropForeignKey
ALTER TABLE "item_details" DROP CONSTRAINT "item_details_hspItemId_fkey";

-- AddForeignKey
ALTER TABLE "item_details" ADD CONSTRAINT "item_details_hspItemId_fkey" FOREIGN KEY ("hspItemId") REFERENCES "hsp_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hsp_items" ADD CONSTRAINT "hsp_items_hspCategoryId_fkey" FOREIGN KEY ("hspCategoryId") REFERENCES "hsp_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
