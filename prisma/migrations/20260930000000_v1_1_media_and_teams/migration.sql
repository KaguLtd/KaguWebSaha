-- CreateEnum
CREATE TYPE "WorkforceKind" AS ENUM ('PERSONNEL', 'CONTRACTOR', 'OBSERVER');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('OPEN', 'PROCESSING', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "daily_task_assignees" ADD COLUMN     "actual_headcount" INTEGER,
ADD COLUMN     "headcount_snapshot" INTEGER,
ADD COLUMN     "team_id" TEXT,
ADD COLUMN     "team_name_snapshot" TEXT,
ADD COLUMN     "workforce_kind_snapshot" "WorkforceKind";

-- AlterTable
ALTER TABLE "project_files" ADD COLUMN     "upload_session_id" TEXT;

-- AlterTable
ALTER TABLE "image_thumbnail_jobs" ADD COLUMN     "last_attempt_at" TIMESTAMP(3),
ADD COLUMN     "locked_by" TEXT,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "heic_conversion_jobs" ADD COLUMN     "last_attempt_at" TIMESTAMP(3),
ADD COLUMN     "locked_by" TEXT,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "upload_session_id" TEXT;

ALTER TABLE "heic_conversion_jobs" ADD COLUMN "staging_cleaned_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "representative_user_id" TEXT NOT NULL,
    "extra_personnel_count" INTEGER NOT NULL,
    "include_representative" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "daily_task_id" TEXT,
    "project_visit_id" TEXT,
    "client_upload_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "offset_bytes" BIGINT NOT NULL DEFAULT 0,
    "temp_storage_path" TEXT NOT NULL,
    "staging_cleaned_at" TIMESTAMP(3),
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'OPEN',
    "project_file_id" TEXT,
    "note" TEXT,
    "locked_by" TEXT,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_representative_user_id_idx" ON "teams"("representative_user_id");

-- CreateIndex
CREATE INDEX "upload_sessions_status_expires_at_idx" ON "upload_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "upload_sessions_project_id_idx" ON "upload_sessions"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_uploaded_by_user_id_client_upload_id_key" ON "upload_sessions"("uploaded_by_user_id", "client_upload_id");

-- CreateIndex
CREATE INDEX "daily_task_assignees_team_id_idx" ON "daily_task_assignees"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_files_upload_session_id_key" ON "project_files"("upload_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "heic_conversion_jobs_upload_session_id_key" ON "heic_conversion_jobs"("upload_session_id");

-- AddForeignKey
ALTER TABLE "daily_task_assignees" ADD CONSTRAINT "daily_task_assignees_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one active crew may use a representative. Archived crews and all
-- historical assignments remain available.
CREATE UNIQUE INDEX "teams_one_active_representative" ON "teams"("representative_user_id") WHERE "is_active" = true;
ALTER TABLE "teams" ADD CONSTRAINT "teams_positive_size" CHECK ("extra_personnel_count" >= 0 AND ("extra_personnel_count" + CASE WHEN "include_representative" THEN 1 ELSE 0 END) BETWEEN 1 AND 500);
ALTER TABLE "daily_task_assignees" ADD CONSTRAINT "assignment_valid_headcount" CHECK (("headcount_snapshot" IS NULL OR "headcount_snapshot" BETWEEN 0 AND 500) AND ("actual_headcount" IS NULL OR "actual_headcount" BETWEEN 0 AND 500));
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_valid_size_offset" CHECK ("size_bytes" > 0 AND "size_bytes" <= 104857600 AND "offset_bytes" >= 0 AND "offset_bytes" <= "size_bytes");

CREATE INDEX "image_thumbnail_jobs_status_next_attempt_at_idx" ON "image_thumbnail_jobs"("status", "next_attempt_at");
CREATE INDEX "heic_conversion_jobs_status_next_attempt_at_idx" ON "heic_conversion_jobs"("status", "next_attempt_at");
CREATE INDEX "heic_cleanup_queue_idx" ON "heic_conversion_jobs"("status", "staging_cleaned_at", "next_attempt_at");
CREATE INDEX "upload_staging_cleanup_idx" ON "upload_sessions"("staging_cleaned_at", "status", "updated_at");
