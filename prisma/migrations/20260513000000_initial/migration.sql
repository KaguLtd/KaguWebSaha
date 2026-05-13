-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PERSONNEL');

-- CreateEnum
CREATE TYPE "DailyTaskStatus" AS ENUM ('PLANNED', 'ON_SITE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TaskEventType" AS ENUM ('TASK_CREATED', 'TASK_UPDATED', 'PERSON_ASSIGNED', 'ARRIVED_SITE', 'LEFT_SITE', 'NOTE_ADDED', 'FILE_ADDED');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('PROJECT_CREATED', 'TASK_CREATED', 'TASK_UPDATED', 'PERSON_ASSIGNED', 'ARRIVED_SITE', 'LEFT_SITE', 'NOTE_ADDED', 'FILE_ADDED');

-- CreateEnum
CREATE TYPE "OfflinePendingType" AS ENUM ('ARRIVED_SITE', 'LEFT_SITE', 'NOTE', 'FILE', 'PHOTO');

-- CreateEnum
CREATE TYPE "OfflinePendingStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_latitude" DECIMAL(10,7),
    "last_longitude" DECIMAL(10,7),
    "last_location_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "google_maps_url" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_notes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_tasks" (
    "id" TEXT NOT NULL,
    "task_date" DATE NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "manager_note" TEXT,
    "status" "DailyTaskStatus" NOT NULL DEFAULT 'PLANNED',
    "arrived_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_task_assignees" (
    "id" TEXT NOT NULL,
    "daily_task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "daily_task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" TEXT NOT NULL,
    "daily_task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "TaskEventType" NOT NULL,
    "note" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_timeline_events" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "daily_task_id" TEXT,
    "user_id" TEXT,
    "event_type" "TimelineEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_files" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "daily_task_id" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_pending_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "OfflinePendingType" NOT NULL,
    "status" "OfflinePendingStatus" NOT NULL DEFAULT 'PENDING',
    "client_item_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "offline_pending_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "projects_customer_id_idx" ON "projects"("customer_id");

-- CreateIndex
CREATE INDEX "projects_name_idx" ON "projects"("name");

-- CreateIndex
CREATE INDEX "project_notes_project_id_created_at_idx" ON "project_notes"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_notes_user_id_idx" ON "project_notes"("user_id");

-- CreateIndex
CREATE INDEX "daily_tasks_task_date_status_idx" ON "daily_tasks"("task_date", "status");

-- CreateIndex
CREATE INDEX "daily_tasks_project_id_idx" ON "daily_tasks"("project_id");

-- CreateIndex
CREATE INDEX "daily_tasks_created_by_user_id_idx" ON "daily_tasks"("created_by_user_id");

-- CreateIndex
CREATE INDEX "daily_task_assignees_user_id_idx" ON "daily_task_assignees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_task_assignees_daily_task_id_user_id_key" ON "daily_task_assignees"("daily_task_id", "user_id");

-- CreateIndex
CREATE INDEX "task_events_daily_task_id_created_at_idx" ON "task_events"("daily_task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_events_project_id_created_at_idx" ON "task_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "task_events_user_id_idx" ON "task_events"("user_id");

-- CreateIndex
CREATE INDEX "project_timeline_events_project_id_created_at_idx" ON "project_timeline_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_timeline_events_daily_task_id_idx" ON "project_timeline_events"("daily_task_id");

-- CreateIndex
CREATE INDEX "project_timeline_events_user_id_idx" ON "project_timeline_events"("user_id");

-- CreateIndex
CREATE INDEX "project_timeline_events_file_id_idx" ON "project_timeline_events"("file_id");

-- CreateIndex
CREATE INDEX "project_files_project_id_created_at_idx" ON "project_files"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_files_daily_task_id_idx" ON "project_files"("daily_task_id");

-- CreateIndex
CREATE INDEX "project_files_uploaded_by_user_id_idx" ON "project_files"("uploaded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "offline_pending_items_client_item_id_key" ON "offline_pending_items"("client_item_id");

-- CreateIndex
CREATE INDEX "offline_pending_items_user_id_status_idx" ON "offline_pending_items"("user_id", "status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_assignees" ADD CONSTRAINT "daily_task_assignees_daily_task_id_fkey" FOREIGN KEY ("daily_task_id") REFERENCES "daily_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_assignees" ADD CONSTRAINT "daily_task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_daily_task_id_fkey" FOREIGN KEY ("daily_task_id") REFERENCES "daily_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timeline_events" ADD CONSTRAINT "project_timeline_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timeline_events" ADD CONSTRAINT "project_timeline_events_daily_task_id_fkey" FOREIGN KEY ("daily_task_id") REFERENCES "daily_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timeline_events" ADD CONSTRAINT "project_timeline_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_timeline_events" ADD CONSTRAINT "project_timeline_events_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "project_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_daily_task_id_fkey" FOREIGN KEY ("daily_task_id") REFERENCES "daily_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_pending_items" ADD CONSTRAINT "offline_pending_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

