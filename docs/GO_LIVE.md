# Kagu Saha Go-Live Checklist

**First installation only.** Use this checklist on a new empty database or an explicitly disposable acceptance environment. For an existing active installation, follow [V1.1 upgrade notes](V1_1_UYGULAMA_VE_YAYIN.md) and [CI/operations](CI_VE_OPERASYON.md); never use reset or bootstrap as an update step.

This document is intentionally operational and conservative. Do not reset the database or clear uploads until you have confirmed that test data should not be kept.

## 1. Decide What Happens To Test Data

Choose one path before touching the database:

- Keep test data: do not reset the database; manually archive or ignore test projects/users if they are harmless.
- Start clean: reset the test database and clear test uploads before creating real users and projects.

Preserve existing records by default. A clean start requires an explicit decision that this particular test database and its uploads are disposable.

## 2. Back Up Before Reset

Before any destructive action:

1. Stop the app process.
2. Take a PostgreSQL backup with the hosting/server tool of choice.
3. Copy or archive the current `UPLOAD_DIR` folder if any uploaded test files may be needed later.
4. Confirm the backup can be found and restored.

Do not store real admin passwords in the backup notes, repository, Markdown files, or chat logs.

## 3. Clean Database Path

Only use this path when the database can be safely wiped.

1. Drop and recreate the target `kagu_saha` database, or use the hosting provider's reset flow.
2. Set real production environment variables.
3. Run:

```bash
node --env-file=/etc/kagu-saha/runtime.env node_modules/prisma/build/index.js generate
node --env-file=/etc/kagu-saha/runtime.env node_modules/prisma/build/index.js validate
node --env-file=/etc/kagu-saha/runtime.env node_modules/prisma/build/index.js migrate deploy
npm run build
npm run deploy:preflight -- --mode=bootstrap --env-file=/etc/kagu-saha/bootstrap.env --worker-env-file=/etc/kagu-saha/runtime.env
node --env-file=/etc/kagu-saha/runtime.env --env-file=/etc/kagu-saha/bootstrap.env scripts/admin-bootstrap.mjs
```

The private bootstrap environment must include runtime values plus the first-admin variables. Prepare Node 24.15.0, install all build dependencies with `npm ci`, and use the absolute/shared storage and environment examples in the operations guide. Remove first-admin credentials from routine service configuration after setup.

4. Start the independent media worker and web application with the chosen process manager. Both read the same runtime environment; web uses `MEDIA_WORKER_MODE=external`.
5. Open `/api/health`, then run `deploy:preflight -- --mode=upgrade --env-file=/etc/kagu-saha/runtime.env --worker-env-file=/etc/kagu-saha/runtime.env --check-worker`. A web `ok: true` alone does not verify the worker, database or storage.
6. Login with the real admin account.

## 4. Upload Folder Reset

Only clear `UPLOAD_DIR` when test files should not be kept.

1. Confirm the resolved `UPLOAD_DIR` path from `npm run deploy:preflight`.
2. Stop the app.
3. Back up the folder if needed.
4. Delete only the contents of that exact folder.
5. Recreate the folder if it was removed.
6. Run `npm run deploy:preflight` again and confirm it is writable.

Never delete a computed upload path without first confirming the absolute path.

## 5. Real Admin Bootstrap

Set these values in the server environment, not in source code:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
ADMIN_FULL_NAME
DATABASE_URL
APP_ORIGIN
UPLOAD_DIR
MEDIA_WORKER_MODE
MEDIA_WORKER_HEARTBEAT_FILE
```

Then run:

```bash
node --env-file=/etc/kagu-saha/runtime.env --env-file=/etc/kagu-saha/bootstrap.env scripts/admin-bootstrap.mjs
```

The command may print the admin username. It must not print the password.

## 6. First Real Data Entry

After login:

1. Create real personnel users.
2. Create real customer records.
3. Create real projects.
4. Upload one harmless real test file to confirm file storage.
5. Assign one daily task for today.
6. Have one personnel user complete the field flow.
7. Confirm the project timeline contains task creation, assignment, arrival, note, leave, and file events.
8. Confirm file download works for admin and permitted personnel.

## 7. Final Smoke Test

Run this quick check after the app starts in the target environment:

```bash
node --env-file=/etc/kagu-saha/runtime.env node_modules/prisma/build/index.js validate
npm run deploy:preflight -- --mode=upgrade --env-file=/etc/kagu-saha/runtime.env --worker-env-file=/etc/kagu-saha/runtime.env --check-worker
```

Then verify in the browser:

1. `/api/health`
2. Admin login
3. `/admin`
4. `/admin/projects`
5. `/admin/schedule`
6. Personnel login
7. `/personnel`
8. One task detail page

## 8. Go-Live Stop Conditions

Do not start active use if any of these are true:

- Health check fails.
- Worker heartbeat or successful batch is stale, its process does not restart, or pending jobs stop progressing.
- `deploy:preflight` cannot write to `UPLOAD_DIR`.
- `prisma migrate deploy` fails.
- Admin bootstrap fails.
- Admin cannot create a user, customer, project, or daily task.
- Personnel cannot complete arrival, note save, and leave.
- Timeline does not receive personnel events.
- Uploaded files cannot be opened.

Fix the issue first, then rerun the acceptance and smoke checks.

