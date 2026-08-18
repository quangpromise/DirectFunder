---
name: vercel-blob-large-upload
description: How to accept a large file upload (bigger than ~4.5MB) in this repo without hitting Vercel's hard Serverless Function request-body limit — via Vercel Blob client-side direct upload. Read this before adding any new file-upload feature, or debugging a 413 / "Unexpected token... is not valid JSON" error on an upload endpoint.
---

# Large file upload on Vercel (Vercel Blob client-upload pattern)

## The problem this solves

Vercel Serverless Functions (Node.js runtime, the only kind this app's API routes use)
enforce a **hard ~4.5MB limit on request body size**, enforced at the edge/proxy layer
**before the request ever reaches the route handler**. No `next.config.ts` option, no
route segment config, no `maxDuration` setting changes this — it is a platform limit, not
an app-level one.

**Symptom if you don't know this**: a route handler that does
`const data = await res.json()` unconditionally (before checking `res.ok`) will crash with
`Unexpected token 'R', "Request En"... is not valid JSON` on the client — because Vercel's
platform-level 413 response is plain text ("Request Entity Too Large"), not the app's usual
JSON error shape, since it never reached the app's code at all. This bit `POST
/api/irs-splitter/analyze` in production on 2026-08-18 (see
`.claude/rules/deployment-database-sync.md` mục 4.31) with a PDF upload over ~4.5MB.

## The fix: client uploads directly to Vercel Blob, not through the route handler

`@vercel/blob` (already a dependency — added 2026-08-18) supports a **client-side direct
upload** flow that bypasses the route handler for the actual file bytes entirely:

1. Browser calls `upload()` from `@vercel/blob/client`, pointed at a small "token" route.
2. That route (using `handleUpload()` from `@vercel/blob/client`, server-side) issues a
   short-lived upload token — its own request/response bodies are tiny (no file bytes), so
   they never hit the 4.5MB wall.
3. The browser then uploads the file **directly to Vercel Blob's storage endpoint**, using
   that token — this request goes straight to Vercel's storage service, not to any Next.js
   route handler in this app, so the Serverless Function body limit simply doesn't apply
   (Blob supports uploads up to several GB).
4. The browser gets back a blob URL and sends *that* (a short string) to the app's real
   processing route(s) as JSON.
5. The processing route does `fetch(blobUrl)` **server-to-server** to pull the bytes back —
   this is an outbound fetch, not an inbound function invocation body, so it isn't subject
   to the same limit (only bounded by `maxDuration` and available memory).
6. Once done, `del(blobUrl)` from `@vercel/blob` (server-side) deletes the blob — keep this
   best-effort (wrapped in try/catch, log on failure, never let cleanup failure block
   returning the actual result to the user).

## Reference implementation in this repo

The Notice Splitter feature (`src/lib/irs-splitter/`) is the first and, as of this writing,
only feature using this pattern — use it as the template:

- **Token route**: `src/app/api/irs-splitter/blob-upload/route.ts` — the `onBeforeGenerateToken`
  callback is where you enforce auth + feature-permission gating (same
  `requireUser()` + `hasFeature(permissions, "<key>", me.role)` pattern used everywhere
  else in this repo) and restrict `allowedContentTypes` (e.g. `["application/pdf"]`).
  **This callback is the actual security boundary** — anyone who can reach this route and
  pass the gate gets a token to upload; don't skip the permission check here just because
  the processing routes also check permissions.
- **Client**: `src/components/notice-splitter-panel.tsx` — calls
  `upload(file.name, file, { access: "public", handleUploadUrl: "/api/irs-splitter/blob-upload" })`,
  then sends `{blobUrl: blob.url}` as JSON (not FormData) to the processing route.
- **Processing routes**: `src/app/api/irs-splitter/analyze/route.ts` and `.../split/route.ts`
  — both now accept `{blobUrl, ...}` JSON bodies instead of `request.formData()`. Shared
  helper `src/lib/irs-splitter/fetch-blob-pdf.ts` (`fetchBlobPdfBytes()`) does the
  `fetch(blobUrl)` + error handling (throws `BlobFetchError` with a clean user-facing
  message if the URL is missing/expired/unreachable — catch this specifically in the route
  to return a proper 400 instead of a generic 500).
- **Cleanup**: `split/route.ts` calls `del(blobUrl)` right after building its response, in a
  try/catch that only logs on failure — this repo's chosen tradeoff is "delete after the
  terminal step of the flow succeeds, accept a rare orphaned blob if the user abandons
  mid-flow" rather than building a TTL/cron cleanup job. If a future feature needs stronger
  guarantees (e.g. much higher upload volume), reconsider a cleanup cron (there's already
  precedent for Vercel Cron in this repo — see `.claude/rules/deployment-database-sync.md`
  mục 4.30, RingCentral subscription renewal, `vercel.json` + `src/app/api/cron/*`).

## `access: "public"` is an intentional, accepted tradeoff

`upload()` requires `access: "public" | "private"`. This repo uses `"public"` — the blob
URL is unguessable (Blob's `addRandomSuffix: true`, set in `onBeforeGenerateToken`, appends
a random suffix) but not authenticated; anyone with the exact URL could fetch it. Given
blobs here are short-lived (deleted right after processing) and this is an internal tool,
that's an acceptable tradeoff, same security model as a random unlisted link. If a future
use case needs stronger guarantees, `access: "private"` requires passing an
`Authorization: Bearer <BLOB_READ_WRITE_TOKEN>` header on every server-side fetch of the
blob, not just a plain URL fetch — more setup, only reach for it if actually needed.

## Environment variable

`BLOB_READ_WRITE_TOKEN` — **requires a one-time manual step on the Vercel Dashboard**
(Storage → Create Blob Store → Connect Project) that Claude cannot do — Vercel then
auto-injects this variable into the project's production Environment Variables. For local
dev, pull it via `vercel link` + `vercel env pull .env.local`, or copy it by hand from
Dashboard → Storage → Blob Store → the `.env.local` tab. See `.env.example` for the
documented variable and `.claude/rules/deployment-database-sync.md` mục 4.31 for the exact
production checklist steps.

## Gotcha: `onUploadCompleted` doesn't fire on localhost

`handleUpload()`'s `onUploadCompleted` callback is a **webhook** Vercel calls back to your
app after a client upload finishes — it only works when the app has a public domain
(production), never on `localhost`. Don't put any load-bearing logic there (e.g. don't rely
on it for cleanup or to mark something "uploaded" in your own state) — keep it a no-op and
do that logic in the actual processing route instead, exactly as this repo's reference
implementation does.
