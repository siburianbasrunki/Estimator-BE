-- AlterTable
ALTER TABLE "item_details" ADD COLUMN     "jobGroupId" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentDetailId" TEXT;

-- CreateTable
CREATE TABLE "estimation_job_groups" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "estimationItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimation_job_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimation_job_groups_estimationItemId_order_idx" ON "estimation_job_groups"("estimationItemId", "order");

-- CreateIndex
CREATE INDEX "item_details_estimationItemId_jobGroupId_parentDetailId_ord_idx" ON "item_details"("estimationItemId", "jobGroupId", "parentDetailId", "order");

-- AddForeignKey
ALTER TABLE "estimation_job_groups" ADD CONSTRAINT "estimation_job_groups_estimationItemId_fkey" FOREIGN KEY ("estimationItemId") REFERENCES "estimation_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_details" ADD CONSTRAINT "item_details_jobGroupId_fkey" FOREIGN KEY ("jobGroupId") REFERENCES "estimation_job_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_details" ADD CONSTRAINT "item_details_parentDetailId_fkey" FOREIGN KEY ("parentDetailId") REFERENCES "item_details"("id") ON DELETE SET NULL ON UPDATE CASCADE;
