-- CreateEnum
CREATE TYPE "HeicConversionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "heic_conversion_jobs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "daily_task_id" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "temp_storage_path" TEXT NOT NULL,
    "target_storage_path" TEXT NOT NULL,
    "note" TEXT,
    "timeline_title" TEXT NOT NULL,
    "status" "HeicConversionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "heic_conversion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "heic_conversion_jobs_status_created_at_idx" ON "heic_conversion_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "heic_conversion_jobs_project_id_idx" ON "heic_conversion_jobs"("project_id");

-- CreateIndex
CREATE INDEX "heic_conversion_jobs_daily_task_id_idx" ON "heic_conversion_jobs"("daily_task_id");

-- CreateIndex
CREATE INDEX "heic_conversion_jobs_uploaded_by_user_id_idx" ON "heic_conversion_jobs"("uploaded_by_user_id");
