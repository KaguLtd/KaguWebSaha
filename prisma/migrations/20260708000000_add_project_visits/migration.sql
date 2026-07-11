CREATE TABLE "project_visits" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "visited_by_user_id" TEXT NOT NULL,
    "note" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_visits_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "project_timeline_events" ADD COLUMN "project_visit_id" TEXT;
ALTER TABLE "project_files" ADD COLUMN "project_visit_id" TEXT;
ALTER TABLE "heic_conversion_jobs" ADD COLUMN "project_visit_id" TEXT;

CREATE INDEX "project_visits_project_id_visited_at_idx" ON "project_visits"("project_id", "visited_at");
CREATE INDEX "project_visits_visited_by_user_id_visited_at_idx" ON "project_visits"("visited_by_user_id", "visited_at");
CREATE INDEX "project_timeline_events_project_visit_id_idx" ON "project_timeline_events"("project_visit_id");
CREATE INDEX "project_files_project_visit_id_idx" ON "project_files"("project_visit_id");
CREATE INDEX "heic_conversion_jobs_project_visit_id_idx" ON "heic_conversion_jobs"("project_visit_id");

ALTER TABLE "project_visits" ADD CONSTRAINT "project_visits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_visits" ADD CONSTRAINT "project_visits_visited_by_user_id_fkey" FOREIGN KEY ("visited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_timeline_events" ADD CONSTRAINT "project_timeline_events_project_visit_id_fkey" FOREIGN KEY ("project_visit_id") REFERENCES "project_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_visit_id_fkey" FOREIGN KEY ("project_visit_id") REFERENCES "project_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
