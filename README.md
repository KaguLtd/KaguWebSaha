# Kagu Saha

Kagu Saha is a small-business field service tracking app for `saha.kagultd.com`.

The product is intentionally simple:

- Project files are the system memory.
- Daily scheduling is the operational brain.
- Personnel screens are fast mobile field entry points.

## Stack

- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Tailwind CSS
- shadcn/ui-style components

## Local Setup

```bash
npm install
npm run prisma:validate
npm run build
```

Create a local `.env` from `.env.example` before running database-backed features.

For local development:

```bash
npm run dev
```

Before deploy or acceptance testing:

```bash
npm run deploy:preflight
```

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

Test or production deployment:

```bash
npx prisma generate
npx prisma validate
npx prisma migrate deploy
npm run admin:bootstrap
npm run build
npm run start
```

## File Storage

Uploaded files are stored under `UPLOAD_DIR`. If `UPLOAD_DIR` is not set, the app uses `./uploads`.

Create the folder before deployment and make sure the Node.js process can write to it.

## Health Check

```text
GET /api/health
```

Expected response:

```json
{"ok":true,"service":"kagu-saha"}
```

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

After acceptance testing passes, use `docs/GO_LIVE.md` before resetting test data or entering real customer/project records.

## Product Guardrails

- No accounting, stock, CRM, or external database integration.
- Tasks are assigned to days, not hours.
- Personnel see only today's tasks assigned to them.
- Project history is append-only timeline data.
- Location is captured only at event moments.
- Offline support covers personnel pending events/media and visit file uploads; first-load offline navigation and execution while a phone is locked are not guaranteed.
- Development-time agents are not production dependencies.
