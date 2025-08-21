-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otp" TEXT,
    "otpExpiry" TIMESTAMP(3),
    "imageUrl" TEXT,
    "imageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimations" (
    "id" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "projectOwner" TEXT NOT NULL,
    "ppn" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "estimations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimation_items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "estimationId" TEXT NOT NULL,

    CONSTRAINT "estimation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_details" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "deskripsi" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "satuan" TEXT NOT NULL,
    "hargaSatuan" DOUBLE PRECISION NOT NULL,
    "hargaTotal" DOUBLE PRECISION NOT NULL,
    "estimationItemId" TEXT NOT NULL,

    CONSTRAINT "item_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "estimationId" TEXT NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hsp_items" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "deskripsi" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "harga" DOUBLE PRECISION NOT NULL,
    "hspCategoryId" TEXT NOT NULL,

    CONSTRAINT "hsp_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hsp_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "hsp_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hsp_items_kode_key" ON "hsp_items"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "hsp_categories_name_key" ON "hsp_categories"("name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimations" ADD CONSTRAINT "estimations_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimation_items" ADD CONSTRAINT "estimation_items_estimationId_fkey" FOREIGN KEY ("estimationId") REFERENCES "estimations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_details" ADD CONSTRAINT "item_details_estimationItemId_fkey" FOREIGN KEY ("estimationItemId") REFERENCES "estimation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_estimationId_fkey" FOREIGN KEY ("estimationId") REFERENCES "estimations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hsp_items" ADD CONSTRAINT "hsp_items_hspCategoryId_fkey" FOREIGN KEY ("hspCategoryId") REFERENCES "hsp_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
