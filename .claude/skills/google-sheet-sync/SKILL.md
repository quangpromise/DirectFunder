---
name: google-sheet-sync
description: Build/extend 2-way (or 1-way) Google Sheets sync features in this repo — new synced tabs, Service Account setup, Apps Script webhooks, and the production-migration discipline that goes with any schema change. Use whenever the user asks to sync a table/tab with a Google Sheet, add a "Send to Sheet" button, or debug why Sheet sync "isn't working".
---

# Google Sheet Sync (Direct Funder)

This repo has TWO independent Google Sheets integration patterns already built. Don't
invent a third — extend one of these.

## Pattern A: OAuth2 per-user (personal "Send to Sheet")

Used by the original Cases-page "Send to Sheet" button (`sendToGoogleSheet` feature).
Each user connects their own Google account (`User.googleRefreshToken`); writes go out
under that person's identity. See `src/lib/google-sheets.ts`,
`src/app/api/cases/[id]/send-to-sheet/route.ts`, `src/components/send-to-sheet-button.tsx`.

Use this pattern when: the write only needs to happen when ONE specific user clicks a
button, and it's fine to require that user to have connected their own Google account.

## Pattern B: Service Account, shared, 2-way ("CPA Review" tab)

The bigger, reusable pattern — a whole tab/table in the app kept in sync with a shared
Google Sheet, regardless of who edits which side. This is what "CPA Review" (added
2026-08-14) uses, and what most future "sync tab X with Sheet" requests should copy.

**Architecture:**
- **App → Sheet (push)**: a Google **Service Account** (`src/lib/google-service-account.ts`,
  env `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) writes on behalf
  of the app itself — not tied to any individual user's OAuth. Required because ANY user
  editing the table needs the write to happen, not just whoever connected Google.
- **Sheet → App (pull)**: a Google Apps Script `onEdit(e)` trigger installed IN the target
  Sheet POSTs changed cells to a public webhook route
  (`src/app/api/cpa-review-sheet/webhook/route.ts`), authenticated by a random secret
  generated at connect-time (NOT a session cookie — Apps Script can't hold one).
- **Row matching**: a stable business key (SSN, here) maps app rows to Sheet rows. Cache
  the resolved row number in `AppConfig.<feature>SheetConfig.rowIndex` so repeat writes
  don't need to re-scan the whole sheet.
- **Conflict resolution — "App always wins"**: webhook writes are dropped if the app's row
  was updated more recently than a short grace window (~5s) before the webhook arrives —
  see `APP_WINS_GRACE_MS` in the webhook route. Prevents an app-initiated push from being
  immediately "corrected" by the `onEdit` it just triggered.
- **Per-month/per-period scoping** (if relevant): if the real Sheet is split one-tab-per-month,
  don't build one giant synced table — scope both the DB rows (`month` column) and the
  Sheet config (`Record<"YYYY-MM", SheetConfig>`) by period, and let each period connect
  its own Sheet independently. See `src/lib/cpa-review-month.ts` /
  `getCpaReviewSheetConfigMap`/`saveCpaReviewSheetConfigMap` in `cpa-review-sheet-sync.ts`.
- **Column mapping is fixed, not admin-configurable**, when mirroring a real spreadsheet's
  exact layout (must match a spreadsheet a human already uses) — see
  `CPA_REVIEW_SHEET_COLUMN_MAP` in `cpa-review-sheet-columns.ts`. If instead the app owns
  the sheet layout, columns can be admin-configurable like `google-sheet-config-dialog.tsx`.

**Key files to read before extending this:**
- `src/lib/google-service-account.ts` — Service Account client (`isServiceAccountConfigured()`
  guards every call so missing env vars no-op instead of crashing).
- `src/lib/cpa-review-sheet-sync.ts` — push logic, config map, `nextAppend*SortOrder` helper.
- `src/lib/cpa-review-sheet-columns.ts` — column index ↔ app field mapping, value coercion
  both directions.
- `src/app/api/cpa-review-sheet/webhook/route.ts` — pull logic, secret auth, App-wins.
- `src/app/api/config/cpa-review-sheet/route.ts` — connect/scan/generate-Apps-Script flow.
- `.claude/rules/deployment-database-sync.md` mục 4.22 — full narrative + production
  checklist template to copy for the next synced feature.

**Building a new synced tab (checklist):**
1. New Prisma model for the table if it's independent of existing data (don't bolt onto
   `Case` unless the user explicitly wants it tied to a Case row).
2. `AppConfig.<feature>SheetConfig Json?` (or `Record<period, Config>` if period-scoped).
3. Fixed or admin-configurable column map — decide based on whether a real spreadsheet
   layout must be matched exactly.
4. Push: call the push function via `after()` in every route that creates/edits/deletes a
   row of this table (see `POST /api/cpa-review`, `PATCH /api/cpa-review/[id]`) — never
   block the response on the Sheets API call.
5. Pull: one webhook route, secret-authenticated, "App wins" grace window, auto-create a
   new local row on unmatched business key IF that matches the feature's intent (CPA Review
   does; not every feature should).
6. Env vars degrade gracefully — every Service-Account-touching function must short-circuit
   via `isServiceAccountConfigured()`/try-catch so a missing key never 500s the main request.

## THE gotcha that actually matters (read this even if skimming)

**Every schema change (new Prisma model/column) MUST be followed by
`prisma migrate deploy` against the PRODUCTION database — before or immediately after
pushing to `main`.** Vercel's build only runs `prisma generate` (via `postinstall`), never
`prisma migrate deploy`. If you skip this, the deployed code's Prisma Client expects
columns/tables that don't exist in the live DB yet, and **every route that touches the
changed model 500s** — including, confusingly, unrelated ones like login, because
`login()` in `src/store/app-store.ts` does `Promise.all([...api.listCases(), ...])`
right after authenticating, so ANY one of those failing makes the whole login look like
"wrong password" even though the credentials were fine. This exact bug happened
2026-08-14→15 (6 migrations sat unapplied on production while CPA Review shipped).

**Rule of thumb**: after `npx prisma migrate dev --name X` locally, before/immediately
after `git push`, run:
```bash
DATABASE_URL="<prod-pooled-connection-string>" npx prisma migrate deploy
```
Check `.claude/rules/deployment-database-sync.md` mục 4.8 for the parallel gotcha about
`AppConfig.columns`/`featurePermissions` needing a merge script (different mechanism,
same root cause: prod DB state silently drifting from what the deployed code expects).

Also remember: if the feature adds a non-empty-array default to `DEFAULT_FEATURE_PERMISSIONS`
(e.g. `viewCpaReview: ["accounting"]`), that needs an explicit merge script against prod
`AppConfig.featurePermissions` too — empty-array (`[]`) defaults don't, since `hasFeature()`
falls back to `?? []` at runtime. See mục 4.8/4.21 for the distinction.
