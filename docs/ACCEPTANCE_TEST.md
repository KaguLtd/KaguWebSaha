# Kagu Saha Manual Acceptance Test

Use this checklist after a database is connected and migrations are applied.

## Preparation

1. Set environment variables from `.env.example`.
2. Run `npm run deploy:preflight`.
3. Run `npx prisma migrate deploy` or `npx prisma migrate dev`.
4. Run `npm run admin:bootstrap`.
5. Start the app with `npm run dev` or `npm run start`.

## Admin Flow

1. Open `/login`.
2. Login with the bootstrapped admin.
3. Open `/admin/users`.
4. Create one active personnel user.
5. Open `/admin/projects/new`.
6. Create one customer.
7. Create one project linked to that customer.
8. Add a project description and one small test file.
9. Confirm the project detail page opens.
10. Confirm the timeline shows `Proje olusturuldu`.
11. Confirm the uploaded file appears in project files and timeline.
12. Open `/admin/schedule`.
13. Select today.
14. Select the project.
15. Assign the personnel user.
16. Add a manager note and save.
17. Confirm the task appears on the calendar and dashboard.

## Personnel Flow

1. Logout from admin.
2. Login as the personnel user.
3. Confirm only today's assigned task appears.
4. Open the task.
5. Press `Sahaya Ulastim`.
6. Allow or deny location; both paths must continue.
7. Confirm the task changes to `ON_SITE`.
8. Press `Sahadan Ayrildim`.
9. Try to submit without a note; browser validation must block it.
10. Add a note and optional file, then submit.
11. Confirm the task changes to `COMPLETED`.
12. Confirm the completed task remains visible but muted on `/personnel`.

## Timeline Verification

1. Login as admin.
2. Open the project detail page.
3. Confirm timeline entries exist for task creation, personnel assignment, arrival, note, leave, and file upload.
4. Confirm files can be opened by admin.
5. Login as personnel and confirm they can open files only for today's assigned project.

## Location Verification

1. Login as personnel.
2. Open `/personnel/settings`.
3. Run the location test.
4. Trigger arrival or leave with location permission enabled.
5. Login as admin.
6. Open `/admin/users`.
7. Confirm the personnel row shows last location time and a Google Maps link.

## Offline Verification

1. Login as personnel.
2. Open today's task.
3. Disable browser network.
4. Press `Sahaya Ulastim` or complete an available offline action.
5. Confirm a pending-record message appears.
6. Re-enable network.
7. Open `/personnel/settings`.
8. Press `Bekleyen kayitlari gonder` if automatic sync has not already run.
9. Confirm pending count clears.
10. Login as admin and confirm the project timeline received the synced event.

## Reset Before Real Use

1. Clear test database data if test data should not become live data.
2. Clear `UPLOAD_DIR` test files.
3. Re-run migrations on the clean database.
4. Re-run `npm run admin:bootstrap` with real admin environment variables.
5. Create real personnel users, customers, and projects.

