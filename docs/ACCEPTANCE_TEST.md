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
6. Click `Cari Ac`, create one customer, and confirm the drawer closes.
7. Click `Proje Ac`, create one project linked to that customer, and confirm the drawer closes.
8. Add a project description, Google Maps link if available, and one small test file.
9. Click `Proje Duzenle`, update static project info, add one new file, and save.
10. Confirm the project list refreshes.
11. Open the project detail page and confirm the timeline shows `Proje olusturuldu`, `Proje bilgileri guncellendi`, and file events.
12. Open `/admin/schedule`.
13. Click today on the calendar to open the assignment drawer.
14. Select the project.
15. Assign the personnel user.
16. Add a manager note and save; confirm the drawer closes.
17. Confirm the task appears on the selected calendar day and dashboard for the same day.
18. Click the project name on the calendar to open the edit drawer.
19. If the task is still `PLANNED`, edit assigned personnel and save.
20. After the task is `ON_SITE` or `COMPLETED`, confirm personnel assignment is locked and note/file additions still work.

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
7. Return to any personnel page or bring the personnel tab back to the foreground.
8. Confirm automatic sync runs and the pending count/message clears.
9. Open `/personnel/settings` and confirm there is a `Bugunku Islere Don` link.
10. Login as admin and confirm the project timeline received the synced event.

## Regression Notes

1. Daily task dates are submitted as `YYYY-MM-DD` and should remain on that exact date in calendar, dashboard, and personnel views.
2. Offline personnel actions should work in browsers without `crypto.randomUUID`; client IDs fall back automatically.
3. Cari, project, and daily task create buttons should show a pending state and ignore double submit while saving.
4. Project and schedule admin flows should open in drawers instead of always-visible side-by-side forms.

## Reset Before Real Use

1. Clear test database data if test data should not become live data.
2. Clear `UPLOAD_DIR` test files.
3. Re-run migrations on the clean database.
4. Re-run `npm run admin:bootstrap` with real admin environment variables.
5. Create real personnel users, customers, and projects.
