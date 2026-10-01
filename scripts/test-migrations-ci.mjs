import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const upgradeMigration = "20260930000000_v1_1_media_and_teams";

/** Never accept DATABASE_URL or dotenv as a fallback. Validate before importing a DB client. */
export function guardedCiDatabaseUrl(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || !env.CI_DATABASE_URL) throw new Error("Migration test requires the isolated GitHub Actions service and CI_DATABASE_URL");
  let url;
  try { url = new URL(env.CI_DATABASE_URL); }
  catch { throw new Error("Invalid isolated CI database declaration"); }
  if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "5432" || url.pathname !== "/kagu_saha_ci_v11" ||
      url.username !== "kagu_ci" || url.password !== "ci_only_password" || url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "schema") || url.searchParams.getAll("schema").length !== 1 || url.searchParams.get("schema") !== "public") {
    throw new Error("Refusing a database outside the dedicated loopback CI service");
  }
  return url.href;
}

const fixtureStatements = [
  `INSERT INTO users (id, username, password_hash, full_name, role, is_active, updated_at) VALUES
    ('ci-admin', 'fixture-admin', 'not-a-real-password-hash', 'Fixture Admin', 'ADMIN', true, '2026-09-01'),
    ('ci-person', 'fixture-person', 'not-a-real-password-hash', 'Fixture Person', 'PERSONNEL', false, '2026-09-01'),
    ('ci-observer', 'fixture-observer', 'not-a-real-password-hash', 'Fixture Observer', 'OBSERVER', true, '2026-09-01')`,
  `INSERT INTO customers (id, name, updated_at) VALUES ('ci-customer', 'Fixture Customer', '2026-09-01')`,
  `INSERT INTO projects (id, customer_id, name, is_active, updated_at) VALUES ('ci-project', 'ci-customer', 'Archived Fixture Project', false, '2026-09-01')`,
  `INSERT INTO daily_tasks (id, task_date, project_id, title, status, arrived_at, left_at, duration_minutes, created_by_user_id, updated_at) VALUES
    ('ci-task', '2026-09-01', 'ci-project', 'Completed fixture task', 'COMPLETED', '2026-09-01 06:00:00', '2026-09-01 08:00:00', 120, 'ci-admin', '2026-09-01')`,
  `INSERT INTO daily_task_assignees (id, daily_task_id, user_id) VALUES ('ci-assignment', 'ci-task', 'ci-person'), ('ci-observer-assignment', 'ci-task', 'ci-observer')`,
  `INSERT INTO project_visits (id, project_id, visited_by_user_id, note, visited_at) VALUES ('ci-visit', 'ci-project', 'ci-observer', 'Preserve canonical visit', '2026-09-01 09:00:00')`,
  `INSERT INTO project_files (id, project_id, daily_task_id, uploaded_by_user_id, original_name, mime_type, size_bytes, storage_path, note) VALUES ('ci-file', 'ci-project', 'ci-task', 'ci-person', 'fixture.jpg', 'image/jpeg', 12345, 'projects/fixture/fixture.jpg', 'Preserve source reference')`,
  `INSERT INTO project_timeline_events (id, project_id, user_id, event_type, title, description, created_at) VALUES ('ci-legacy-visit', 'ci-project', 'ci-observer', 'SITE_VISITED', 'Legacy visit', 'Preserve legacy visit', '2026-08-20 09:00:00')`,
  `INSERT INTO heic_conversion_jobs (id, project_id, daily_task_id, uploaded_by_user_id, original_name, target_name, temp_storage_path, target_storage_path, timeline_title, status, attempts, last_error, updated_at) VALUES ('ci-heic', 'ci-project', 'ci-task', 'ci-person', 'fixture.heic', 'fixture.jpg', 'staging/fixture.heic', 'projects/fixture/fixture.jpg', 'Fixture conversion', 'FAILED', 2, 'Synthetic failure', '2026-09-01')`,
  `INSERT INTO image_thumbnail_jobs (id, project_file_id, source_storage_path, thumbnail_storage_path, status, attempts, updated_at) VALUES ('ci-thumbnail', 'ci-file', 'projects/fixture/fixture.jpg', 'projects/fixture/fixture.webp', 'PROCESSING', 1, '2026-09-01')`,
  `INSERT INTO saved_reports (id, report_type, title, start_date, end_date, project_id, created_by_user_id, snapshot) VALUES ('ci-report', 'PERSONNEL', 'Legacy immutable report', '2026-09-01', '2026-09-01', 'ci-project', 'ci-admin', '{"rows":[{"userName":"Historical Person","totalMinutes":120}],"totalTasks":1,"customLegacyField":"keep"}'::jsonb)`,
];

const preservationQueries = [
  `SELECT id, username, full_name, role, is_active FROM users ORDER BY id`,
  `SELECT id, name FROM customers ORDER BY id`,
  `SELECT id, name, is_active FROM projects ORDER BY id`,
  `SELECT id, task_date, title, status, arrived_at, left_at, duration_minutes FROM daily_tasks ORDER BY id`,
  `SELECT id, daily_task_id, user_id FROM daily_task_assignees ORDER BY id`,
  `SELECT id, visited_at, note FROM project_visits ORDER BY id`,
  `SELECT id, event_type, project_visit_id, created_at, description FROM project_timeline_events ORDER BY id`,
  `SELECT id, original_name, size_bytes::text, storage_path, note FROM project_files ORDER BY id`,
  `SELECT id, status, attempts, last_error, temp_storage_path, target_storage_path FROM heic_conversion_jobs ORDER BY id`,
  `SELECT id, status, attempts, source_storage_path, thumbnail_storage_path FROM image_thumbnail_jobs ORDER BY id`,
  `SELECT id, title, start_date, end_date, snapshot::text FROM saved_reports ORDER BY id`,
];

export async function runMigrationIntegration(env = process.env) {
  const databaseUrl = guardedCiDatabaseUrl(env);
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  let temporary;
  try {
    const identity = await client.$queryRawUnsafe("SELECT current_database()::text AS database, current_user::text AS username");
    assert.equal(identity[0].database, "kagu_saha_ci_v11"); assert.equal(identity[0].username, "kagu_ci");
    const existing = await client.$queryRawUnsafe("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema = 'public'");
    assert.equal(existing[0].count, 0, "CI service must start empty; this script never resets existing databases");
    temporary = await mkdtemp(path.join(tmpdir(), "kagu-ci-migrations-"));
    const schemaDirectory = path.join(temporary, "prisma");
    const migrationsDirectory = path.join(schemaDirectory, "migrations");
    await mkdir(migrationsDirectory, { recursive: true });
    await cp(path.join(root, "prisma/schema.prisma"), path.join(schemaDirectory, "schema.prisma"));
    await cp(path.join(root, "prisma/migrations/migration_lock.toml"), path.join(migrationsDirectory, "migration_lock.toml"));
    const migrations = (await readdir(path.join(root, "prisma/migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    assert.ok(migrations.includes(upgradeMigration), "V1.1 migration is missing");
    for (const name of migrations.filter((name) => name < upgradeMigration)) await cp(path.join(root, "prisma/migrations", name), path.join(migrationsDirectory, name), { recursive: true });
    function migrate(stage) {
      try {
        execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(schemaDirectory, "schema.prisma")], {
          cwd: temporary, env: { ...env, DATABASE_URL: databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 120_000,
        });
      } catch { throw new Error(`Isolated Prisma migrate deploy failed during ${stage}`); }
      console.log(`Isolated migration stage passed: ${stage}`);
    }
    migrate("legacy baseline");
    for (const statement of fixtureStatements) await client.$executeRawUnsafe(statement);
    const before = await Promise.all(preservationQueries.map((query) => client.$queryRawUnsafe(query)));
    await cp(path.join(root, "prisma/migrations", upgradeMigration), path.join(migrationsDirectory, upgradeMigration), { recursive: true });
    migrate("V1.1 upgrade");
    migrate("idempotent second deploy");
    const after = await Promise.all(preservationQueries.map((query) => client.$queryRawUnsafe(query)));
    assert.deepEqual(after, before, "Historical users/tasks/events/media/SavedReport changed");
    const legacy = await client.dailyTaskAssignee.findMany({ orderBy: { id: "asc" } });
    assert.equal(legacy.length, 2);
    for (const row of legacy) {
      for (const field of ["teamId", "teamNameSnapshot", "headcountSnapshot", "actualHeadcount", "workforceKindSnapshot"]) assert.equal(row[field], null, `Legacy ${field} must remain unknown`);
    }
    const teamData = { name: "Fixture Crew", representativeUserId: "ci-person", extraPersonnelCount: 4, includeRepresentative: true, effectiveFrom: new Date("2026-09-30T00:00:00Z") };
    const team = await client.team.create({ data: teamData });
    await assert.rejects(client.team.create({ data: { ...teamData, name: "Forbidden second active crew" } }), (error) => error.code === "P2002");
    await client.team.create({ data: { ...teamData, name: "Archived crew", isActive: false } });
    const task = await client.dailyTask.create({ data: { taskDate: new Date("2026-10-01T00:00:00Z"), projectId: "ci-project", title: "V1.1 fixture task", createdByUserId: "ci-admin" } });
    const assignment = await client.dailyTaskAssignee.create({ data: { dailyTaskId: task.id, userId: "ci-person", teamId: team.id, teamNameSnapshot: team.name, headcountSnapshot: 5, actualHeadcount: 3, workforceKindSnapshot: "CONTRACTOR" } });
    await client.team.update({ where: { id: team.id }, data: { extraPersonnelCount: 8, name: "Edited crew" } });
    const frozen = await client.dailyTaskAssignee.findUniqueOrThrow({ where: { id: assignment.id } });
    assert.equal(frozen.headcountSnapshot, 5); assert.equal(frozen.actualHeadcount, 3); assert.equal(frozen.teamNameSnapshot, "Fixture Crew");
    await assert.rejects(client.$executeRawUnsafe(`UPDATE daily_task_assignees SET actual_headcount = -1 WHERE id = 'ci-assignment'`), (error) => error.code === "P2010" && error.meta?.code === "23514");
    const index = await client.$queryRawUnsafe("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'teams_one_active_representative'");
    assert.match(index[0]?.indexdef ?? "", /UNIQUE.*WHERE.*is_active/i);
    const history = await client.$queryRawUnsafe("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name");
    assert.deepEqual(history.map((row) => row.migration_name), migrations.filter((name) => name <= upgradeMigration));
    console.log("Migration integration passed: history, immutable legacy records, nullable snapshots, partial uniqueness, constraints and frozen team assignments.");
  } finally {
    await client.$disconnect();
    if (temporary) {
      const temporaryRoot = path.resolve(tmpdir());
      assert.ok(path.resolve(temporary).startsWith(temporaryRoot + path.sep));
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMigrationIntegration().catch((error) => {
    console.error("Isolated migration integration failed. Check the CI-only target, empty service database, migration stage and preservation assertions; production configuration is never used.");
    console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, "[isolated-ci-database]").replaceAll("ci_only_password", "[ci-password]"));
    process.exitCode = 1;
  });
}
