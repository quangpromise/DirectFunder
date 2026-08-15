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
7. **Before handing off, reuse the 3 fixes below** (grid size, `onEdit` trigger type, error
   surfacing) up front — they were each found the hard way on CPA Review's first real
   production connection and will bite any new synced tab identically if skipped.

## Apps Script gotchas — copy these into any new `buildAppsScript()` generator

These 2 bugs are near-guaranteed to recur on a NEW synced tab if the generator is written
fresh instead of copied from `buildAppsScript()` in
`src/app/api/config/cpa-review-sheet/route.ts`. Both were hit for real on CPA Review's
first production Sheet connection (2026-08-15) — see mục 4.22 addendum in
`deployment-database-sync.md` for the full incident writeup.

**1. New/small Sheet tabs reject ranges beyond their declared grid size.** A brand-new tab
defaults to 1000 rows × 26 cols (Z). Any `values.get`/`values.batchGet`/`spreadsheets.get`
range beyond that — e.g. scanning column AH or row 3000 for a wide/tall layout — fails
outright with `"Range (...) exceeds grid limits"` (NOT the same as querying an in-bounds
but empty range, which just returns nothing). **Fix**: before the first scan/write, call
something like `ensureSheetGridSize()` (`cpa-review-sheet-sync.ts`) — read
`sheets.properties(sheetId,gridProperties)`, and if `rowCount`/`columnCount` are below what
the column map needs, `batchUpdate` an `updateSheetProperties` request to grow them (ONLY
grow, never shrink — growing just appends empty rows/cols, doesn't touch existing data).
Call this on both the initial "connect" scan and on "resync".

**2. A function literally named `onEdit` can NEVER call `UrlFetchApp` (or any
authorization-requiring service).** Apps Script auto-registers any function named exactly
`onEdit` as a **simple trigger**, and simple triggers always run in a **restricted
authorization sandbox** — no exceptions, no amount of running other functions and clicking
"Allow" changes this. It throws `"Specified permissions are not sufficient to call
UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request"`
at the `onEdit` call site. This is a deliberate Google security restriction (simple
triggers fire without any per-invocation consent, so Google won't let them reach out to
arbitrary URLs), not a bug that goes away with more permissions. **Fix**: name the handler
anything else (CPA Review uses `onCpaReviewEdit`) and register it as an **installable
trigger** explicitly — `ScriptApp.newTrigger("yourHandlerName").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create()`
— inside the one-time "install" function the user runs and grants permission to manually.
Installable triggers run with full authorization. Delete-and-recreate this trigger (by
handler name) at the top of the install function so re-running it after a script update
doesn't leave duplicate triggers firing twice.

**3. The generated script (with its embedded per-connection secret) must be re-fetchable,
not shown once and lost.** The very first version of this only returned `appsScript` in the
one-time POST /connect response. When gotcha #2's fix shipped, every ALREADY-connected
month had no way to get the corrected script short of disconnecting (which changes the
secret and throws away the cached row-index map). **Fix from day one**: give the config GET
endpoint an optional `?period=X` param that, if that period is already connected, rebuilds
`appsScript` from the saved secret/tab name and returns it — and put a "Copy script" button
in whatever guide/help UI you build, not just at connect time. See
`GET /api/config/cpa-review-sheet` and the guide dialog's "Copy script" block for the
pattern to copy.

**4. Error messages must surface the real cause, not a generic fallback.** The first
version of `mapSheetsError()` only recognized one Google error shape and fell back to
"failed, try again later" for everything else — permission errors with a different shape,
Sheets API rate-limit/quota errors, and a custom `SheetNotAccessibleError` (wrong tab/gid)
all got flattened into the same unhelpful string, which made the actual production issues
(quota, then a malformed key, then the grid-size bug, then the `onEdit` bug) each look
identical from the outside and took a debugging round-trip apiece to unmask. Check MULTIPLE
Google error shapes (`response.data.error.status`, legacy `errors[].reason`,
`response.status`, plus known non-HTTP failure message substrings like
`DECODER routines`/`invalid_grant` for a malformed private key), pass through custom error
classes' own messages unchanged instead of remapping them, `console.error` the raw error
server-side even after mapping it (Vercel Runtime Logs are otherwise the only way to see
what actually happened), and — cheapest win — append the raw underlying `message` to
whatever generic fallback string remains. See `mapSheetsError()` in `google-sheets.ts` and
the catch block in `POST /api/config/cpa-review-sheet` for the current version.

## Service Account private key: always offer a base64 env var

A multi-line PEM string pasted into any web-based env-var editor (Vercel dashboard
included) is extremely easy to mangle — stray wrapping quotes, `\n` literal vs real
newline getting flipped one way or the other depending on how the paste box handles it.
Hit this for real on 2026-08-15: re-pasted the exact same correct value multiple times and
still got `"Specified permissions are not sufficient"`/auth failures. **Fix implemented in
`google-service-account.ts`**: prefer a `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64` env var
(single line, alphanumeric-plus-`/+=` only, nothing for a text box to mangle) over the raw
PEM var, generated once via
`Buffer.from(rawPemStringWithRealNewlines, "utf8").toString("base64")`. Any NEW
Service-Account-based integration in this repo should offer the same base64 escape hatch
from the start rather than rediscovering this after a support round-trip.

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
