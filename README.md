# Kagu Saha

Kagu Saha is a small-business field service tracking app for `saha.kagultd.com`.

The product is intentionally simple:

- Project files are the system memory.
- Daily scheduling is the operational brain.
- Personnel screens are fast mobile field entry points.

For an **existing active installation**, use the [V1.1 upgrade notes](docs/V1_1_UYGULAMA_VE_YAYIN.md) and [CI/operations guide](docs/CI_VE_OPERASYON.md). Keep existing data and uploads; first-admin bootstrap and database reset are not upgrade steps.

## Stack

- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Tailwind CSS
- shadcn/ui-style components

## Local Setup

Use Node.js **24.15.0**, pinned in `.node-version`. Create a local `.env` from `.env.example` before the commands below; Prisma validation needs a `DATABASE_URL` declaration. Keep `MEDIA_WORKER_MODE=fallback` for local development without an independent worker.

```bash
npm ci
npx prisma generate
npm run prisma:validate
npm test
npm run typecheck
npm run lint
npm run build
```

Install development dependencies for validation, migrations and the web/worker build. Do not use `npm ci --omit=dev` before these steps. Production-only pruning, if used, comes after client generation, migration and build; preserve the generated Prisma client and compiled worker.

For local development:

```bash
npm run dev
```

Production configuration check, after building and preparing absolute storage paths:

```bash
npm run deploy:preflight -- --mode=upgrade --env-file=/etc/kagu-saha/runtime.env --worker-env-file=/etc/kagu-saha/runtime.env
```

The default preflight mode is `upgrade`: no bootstrap credentials or DB connection. `--mode=bootstrap` additionally checks first-admin variables. Service environment variables override values loaded from the environment file. See the operations guide for local fallback and worker readiness checks.

## First Admin Bootstrap

The first admin is created from environment variables. The password is never written to source code or documentation.

```bash
npm run admin:bootstrap
```

Required environment variables:

- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_FULL_NAME`

## Database

Initial migration files are under `prisma/migrations`.

Development database:

```bash
npx prisma migrate dev
npm run admin:bootstrap
```

For existing installations, test the additive migration and restore procedure on an isolated copy before the approved production update. Follow the upgrade guide; it starts both web and worker and never repeats bootstrap. For a new, empty installation only, follow [GO_LIVE](docs/GO_LIVE.md).

## File Storage

Uploaded files are stored under `UPLOAD_DIR`. If `UPLOAD_DIR` is not set, the app uses `./uploads`.

In production use the same **absolute, persistent** `UPLOAD_DIR` for web and worker. It must be writable by both service processes and backed up with the database. Worker heartbeat storage is separate and private. Relative paths and `./uploads` remain a local-development convenience.

## Health Check

```text
GET /api/health
```

Expected response:

```json
{"ok":true,"service":"kagu-saha"}
```

This endpoint confirms the web process responds. It does not prove database migrations, writable storage or a working media service. After both services start, run preflight with `--check-worker` and inspect the oldest pending job age; see [CI/operations](docs/CI_VE_OPERASYON.md).

## Smoke Test

See `docs/ACCEPTANCE_TEST.md` for the full manual acceptance checklist.

For V1.1 on an existing active installation, follow [V1.1 release notes](docs/V1_1_UYGULAMA_VE_YAYIN.md). The update requires the additive migration and a supervised media worker; do not reset/seed existing data or repeat first-admin bootstrap as an update step.

```bash
npm test
npm run typecheck
npm run lint
npm run build
# Separate service, same database/storage environment:
npm run worker:media
```

## Go-Live

Use [GO_LIVE](docs/GO_LIVE.md) only for first installation on an empty/disposable database. Active upgrades use the V1.1 release and operations guides above.

## Product Guardrails

- No accounting, stock, CRM, or external database integration.
- Tasks are assigned to days, not hours.
- Personnel see only today's tasks assigned to them.
- Project history is append-only timeline data.
- Location is captured only at event moments.
- Offline support covers personnel pending events/media and visit file uploads; first-load offline navigation and execution while a phone is locked are not guaranteed.
- Development-time agents are not production dependencies.
