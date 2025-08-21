-- CreateEnum
CREATE TYPE "VolumeOp" AS ENUM ('ADD', 'SUB');

-- CreateTable
CREATE TABLE "volume_details" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "jenis" "VolumeOp" NOT NULL,
    "panjang" DOUBLE PRECISION NOT NULL,
    "lebar" DOUBLE PRECISION NOT NULL,
    "tinggi" DOUBLE PRECISION NOT NULL,
    "jumlah" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "itemDetailId" TEXT NOT NULL,

    CONSTRAINT "volume_details_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "volume_details" ADD CONSTRAINT "volume_details_itemDetailId_fkey" FOREIGN KEY ("itemDetailId") REFERENCES "item_details"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
