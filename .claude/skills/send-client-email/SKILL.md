---
name: send-client-email
description: How the "Send email to client" (Outlook/Microsoft Graph, per-user OAuth2) feature works in this repo, and the contrast with the other email-sending pattern (Gmail App Password, shared mailbox) used for CPA email. Read this before building a new email-sending feature, changing the client email template, or debugging why "Send email to client" fails.
---

# Send Email to Client (Direct Funder)

This repo has TWO independent email-sending patterns. Don't invent a third — extend one
of these depending on the requirement.

## Pattern A: Gmail App Password, shared mailbox (CPA email)

`src/lib/mailer.ts` — one company Gmail account (`GMAIL_USER`/`GMAIL_APP_PASSWORD` env
vars, SMTP App Password not a real password) sends on behalf of the app itself, regardless
of who clicks the button. Use this pattern when: the email should always appear to come
from the same company address, and no individual user needs to authenticate.

## Pattern B: Microsoft Graph OAuth2, per-user mailbox ("Send email to client")

This is what "Gửi email cho khách hàng" (added 2026-08-11) uses — each Processor/Manager
connects their OWN Outlook mailbox (`@directfunder.com`) once, and every email they send
to a client goes out under their own identity (so the client sees a reply-able 1:1 email
from their actual contact, not a shared inbox). Use this pattern when the sender's identity
matters and you're OK requiring each user to individually authorize the app once.

**Architecture:**
- **Token storage**: `User.microsoftRefreshToken` (nullable, one per user) — only the
  refresh_token is persisted. The access_token is always requested fresh from the
  refresh_token immediately before each send (`getAccessTokenFromRefreshToken` in
  `src/lib/microsoft-graph.ts`), same pattern as `google-sheets.ts`'s Service Account flow.
- **OAuth flow** (popup, not full-page redirect — the user stays on the Cases page):
  1. Client calls `connectMicrosoftAccount()` (`app-store.ts`) — opens
     `/api/auth/microsoft/start` in a `window.open` popup.
  2. `start/route.ts` signs a CSRF `state` token (`oauth-state.ts`, shared helper — also
     used by the Google OAuth flow, discriminated by a `provider: "google" | "microsoft"`
     field baked into the signed JWT so a state minted for one provider can't be replayed
     against the other's callback) and redirects to Microsoft's consent screen.
  3. `callback/route.ts` verifies `state`, exchanges the `code` for a refresh_token
     (`exchangeCodeForRefreshToken`), saves it on `User.microsoftRefreshToken`, then returns
     a tiny self-closing HTML page that `postMessage`s `{type: "microsoft-oauth-done", ok}`
     to `window.opener` and calls `window.close()`.
  4. The store's `connectMicrosoftAccount()` promise resolves from that `postMessage`
     (with a `popup.closed` poll as a fallback if the user closes the popup manually without
     completing consent).
- **Token expiry / revocation handling**: a 401 from `/me/sendMail`, or an `invalid_grant`
  error while refreshing, both throw `MicrosoftAuthExpiredError`. The API route
  (`send-client-email/route.ts`) catches this specifically, **deletes the stored
  `microsoftRefreshToken`** (so the NEXT attempt fails fast with a clean "not connected"
  state instead of retrying a dead token forever), and returns HTTP 428 with body
  `{error: "MICROSOFT_NOT_CONNECTED"}`. The client (`send-client-email-button.tsx`) checks
  for exactly this sentinel string, transparently reopens the connect popup, and retries
  the send once — the user only sees one click, not "fails, reconnect, click send again".
- **No persistent "sent" state** (deliberate, unlike `SendToSheetButton`/`sendCpaEmail`):
  following up with a client by email is a repeatable action, not a one-time milestone, so
  there's no `xSentAt` timestamp column and no "are you sure you want to resend?" confirm —
  just a 5-second success checkmark flash (`useSuccessFlash`) then back to the default icon.
  History is still visible via Edit History (`logEdit(caseId, "Gửi email cho khách hàng", ...)`).
- **Template**: Admin configures Subject/Body once on the Phân quyền page
  (`ClientEmailTemplateDialog` → `AppConfig.clientEmailTemplate`, nullable — falls back to
  `DEFAULT_CLIENT_EMAIL_SUBJECT`/`DEFAULT_CLIENT_EMAIL_BODY` in `client-email-template.ts`
  until Admin saves one). Rendered server-side via the SAME `renderTemplate()` helper
  (`email-template-render.ts`) used by the CPA email template — plain `{key}` substitution,
  unrecognized tokens are left as-is rather than erroring.
  **`ClientEmailTemplateVars` deliberately excludes internal fields** (ssn, zipcode, money,
  status) that exist on `CpaEmailTemplateVars` — this is an outbound email to the client
  themselves, so Admin can't accidentally template in something that shouldn't leave the
  company. If a future request asks to add a new `{token}` to this template, check whether
  the underlying data is safe to send to the client before wiring it into
  `ClientEmailTemplateVars`/`buildClientTemplateVars`.

**Key files:**
- `src/lib/microsoft-graph.ts` — token exchange/refresh, `sendClientEmail()`, error mapping.
- `src/lib/oauth-state.ts` — shared CSRF state signer/verifier (Google + Microsoft).
- `src/app/api/auth/microsoft/start/route.ts` / `callback/route.ts` — the popup OAuth dance.
- `src/app/api/cases/[id]/send-client-email/route.ts` — validates the case has a
  well-formed email, loads the sender's refresh_token, renders the template, sends, maps
  `MicrosoftAuthExpiredError` to 428.
- `src/lib/client-email-template.ts` — template vars + defaults.
- `src/components/send-client-email-button.tsx` — the button (in `ClientProfileDialog`,
  next to the Email field, only shown when `hasFeature(..., "sendClientEmail", role)` AND
  the case has a non-empty email).
- `src/store/app-store.ts` — `sendClientEmail()` action, `connectMicrosoftAccount()` popup
  orchestration.

**Feature gating**: `sendClientEmail` in `DEFAULT_FEATURE_PERMISSIONS` (`rbac.ts`), default
`["processor"]` — a NON-empty default, so per the gotcha in `.claude/rules/
deployment-database-sync.md` mục 4.8, any change to this default requires the same
production `AppConfig.featurePermissions` merge-script treatment as `viewCpaReview` etc.
(empty-array defaults don't need it; this one isn't empty).

**Env vars** (`.env.example`): `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`,
`MICROSOFT_TENANT_ID`. Requires an Azure App registration (Single tenant, scoped to the
`@directfunder.com` tenant) with Delegated `Mail.Send` permission granted, and the exact
redirect URI `https://<domain>/api/auth/microsoft/callback` registered for BOTH the dev
domain and the production domain (Azure rejects a mismatched redirect_uri outright — this
is the most common "OAuth just doesn't work" cause when adding a new environment).

**Production status** (as of 2026-08-15, see mục 4.12 in `deployment-database-sync.md`):
the `User.microsoftRefreshToken` column migration (`20260811025930_add_client_email_
microsoft_oauth`) predates the batch of migrations that were found unapplied on production
during the 2026-08-14→15 login incident, and production has been through several later
`prisma migrate deploy` runs since — the column is essentially certainly live. **What is
NOT confirmed**: whether the 3 `MICROSOFT_*` env vars are actually set in Vercel, and
whether the Azure App registration + redirect URI + admin consent were ever completed —
mục 4.12's checklist was still marked pending last it was checked and nothing since
suggests it was finished. If a user reports "Send email to client" failing in production,
check this FIRST (a clean OAuth failure on click, or a generic "gửi email thất bại" without
ever reaching Microsoft's consent screen, both point here) before assuming a code bug.
