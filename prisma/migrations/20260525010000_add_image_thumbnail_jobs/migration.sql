-- CreateEnum
CREATE TYPE "ImageThumbnailStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "project_files"
ADD COLUMN "thumbnail_storage_path" TEXT,
ADD COLUMN "thumbnail_mime_type" TEXT,
ADD COLUMN "thumbnail_size_bytes" BIGINT,
ADD COLUMN "thumbnail_created_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "image_thumbnail_jobs" (
    "id" TEXT NOT NULL,
    "project_file_id" TEXT NOT NULL,
    "source_storage_path" TEXT NOT NULL,
    "thumbnail_storage_path" TEXT NOT NULL,
    "status" "ImageThumbnailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "image_thumbnail_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "image_thumbnail_jobs_status_created_at_idx" ON "image_thumbnail_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "image_thumbnail_jobs_project_file_id_idx" ON "image_thumbnail_jobs"("project_file_id");

-- AddForeignKey
ALTER TABLE "image_thumbnail_jobs" ADD CONSTRAINT "image_thumbnail_jobs_project_file_id_fkey" FOREIGN KEY ("project_file_id") REFERENCES "project_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
