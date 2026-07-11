ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT;

CREATE TABLE IF NOT EXISTS "saved_reports" (
  "id" TEXT NOT NULL,
  "report_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "project_id" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "saved_reports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "saved_reports_created_at_idx" ON "saved_reports"("created_at");
CREATE INDEX IF NOT EXISTS "saved_reports_project_id_idx" ON "saved_reports"("project_id");
CREATE INDEX IF NOT EXISTS "saved_reports_created_by_user_id_idx" ON "saved_reports"("created_by_user_id");
