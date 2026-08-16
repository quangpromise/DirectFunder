---
name: send-client-email
description: How the "Send email to client" (SMTP webmail mail.directfunder.com, per-user credentials) feature works in this repo, and the contrast with the other email-sending pattern (Gmail App Password, shared mailbox) used for CPA email. Read this before building a new email-sending feature, changing the client email template, or debugging why "Send email to client" fails.
---

# Send Email to Client (Direct Funder)

This repo has TWO independent email-sending patterns. Don't invent a third — extend one
of these depending on the requirement.

## Pattern A: Gmail App Password, shared mailbox (CPA email)

`src/lib/mailer.ts` — one company Gmail account (`GMAIL_USER`/`GMAIL_APP_PASSWORD` env
vars, SMTP App Password not a real password) sends on behalf of the app itself, regardless
of who clicks the button. Use this pattern when: the email should always appear to come
from the same company address, and no individual user needs to authenticate.

## Pattern B: SMTP webmail, per-user mailbox ("Send email to client")

This is what "Gửi email cho khách hàng" (added 2026-08-11) uses — each Processor/Manager
connects their OWN company webmail mailbox (`@directfunder.com`, hosted at
`mail.directfunder.com`, a plain cPanel-style webmail — NOT Microsoft 365/Outlook) once,
and every email they send to a client goes out under their own identity (so the client
sees a reply-able 1:1 email from their actual contact, not a shared inbox). Use this
pattern when the sender's identity matters and you're OK requiring each user to enter
their own mailbox credentials once.

**Rewritten 2026-08-15**: the original design used Microsoft Graph OAuth2 (Outlook), but
that required an Azure AD App registration + admin consent from the tenant admin — nobody
on the team held that access, and self-service app registration under a personal Microsoft
account hit an unavoidable `InteractionRequired` error caused by Windows-level SSO
injecting the wrong account. Since the company's actual mailbox is plain SMTP webmail (not
Microsoft 365), the feature was rebuilt on plain SMTP + per-user stored credentials instead
of OAuth — this needs no admin access, no App registration, no external service at all.

**Architecture:**
- **Credential storage**: `User.webmailUsername` (the mailbox email, may differ from the
  user's app login email) + `User.webmailPasswordEncrypted` (AES-256-GCM ciphertext, see
  `src/lib/webmail-crypto.ts`) — nullable, one pair per user. Unlike the Google/former
  Microsoft OAuth refresh tokens (which are plain text in the DB — they're revocable from
  Google's/Microsoft's side if leaked), a webmail password is a real, non-revocable secret,
  so it's the one credential in this repo that's encrypted at rest rather than stored plain.
  `WEBMAIL_CREDENTIAL_ENCRYPTION_KEY` (32-byte base64, `.env.example`) is the AES key —
  losing/rotating it makes every stored password permanently undecryptable, forcing every
  user to reconnect. `webmailUsername` (the non-secret half — an email address, not the
  password) is exposed to the client via `GET/POST/PATCH /api/users*` (added 2026-08-16,
  `User.webmailUsername` in `types.ts`) and shown as a connected/not-connected status row in
  the account dropdown (`top-nav.tsx`) — purely informational, no connect/disconnect action
  lives there, that still only happens via `ConnectWebmailDialog` triggered from a send
  attempt. `webmailPasswordEncrypted` is never sent to the client anywhere.
- **Connect flow** (in-app dialog, not an OAuth popup — there's no consent screen for plain
  SMTP):
  1. Client calls `connectWebmailAccount(email, password)` (`app-store.ts`) — POSTs to
     `/api/me/webmail-account`.
  2. The route validates the email format, calls `verifyWebmailCredentials()`
     (`client-mailer.ts`, does a real `transporter.verify()` SMTP handshake) so a wrong
     password is rejected immediately instead of silently stored, then `encryptSecret()`s
     the password and saves both fields on the current user.
  3. `ConnectWebmailDialog` (`connect-webmail-dialog.tsx`) is the UI — a plain 2-field
     (email, password) modal, opened by `SendClientEmailButton` when a send attempt reports
     `needsWebmailAuth`, or can be opened proactively. On success it immediately retries the
     send once, so the user only sees one click.
- **Auth failure handling**: a `535`/`EAUTH` SMTP response (wrong password, or a password
  the user later changed directly in webmail) throws `WebmailAuthError`
  (`client-mailer.ts`). The API route (`send-client-email/route.ts`) catches this
  specifically, **deletes the stored credential** (so the NEXT attempt fails fast with a
  clean "not connected" state instead of retrying a dead password forever), and returns
  HTTP 428 with body `{error: "WEBMAIL_NOT_CONNECTED"}`. The client checks for exactly this
  sentinel string to trigger the reconnect dialog — same 428/sentinel/retry-once shape the
  old Microsoft OAuth flow used, just renamed.
- **Persistent "sent" state** (added 2026-08-16, reversing the earlier "no persistent state,
  just a 5s flash" design): `Case.clientEmailSentAt` (`DateTime?`), same shape as
  `sheetSentAt`/`cpaEmailSentAt`/`cpaReviewTestSentAt` — set on real send success AND on
  "Mark as sent" (`manual: true` in the request body, no SMTP call), cleared on the resend
  confirm (`clear: true`). The button icon reads this straight off `CaseRecord`, not local
  `useState`, so it survives reload — clicking it while green opens a "muốn gửi lại?" confirm
  before clearing.
- **Two-step send flow, preview → compose → send** (rewritten 2026-08-16, replacing the
  earlier "pick years, hit Send, gửi ngay" flow): clicking the button opens a year-picker
  popup (same shape as `TestSheetButton`'s) with a VI/EN language toggle and, for each
  selected year, an "Additional tax on 1099-INT" amount input rendered **directly under that
  year's tile** (highlighted amber) rather than in a separate list below all the tiles —
  leaving a year's INT blank omits that year's INT/estimated-refund lines entirely, only the
  Tax credit line shows (see `hasTaxInt` in `refund-notification-email.ts`). The picker also
  has a secondary "Mark as sent" button (manual, no send). Its primary button, labeled
  "Confirm"/"Xác nhận" (not "Send" — sending happens one screen later), calls
  `POST /api/cases/[id]/refund-email-preview` to render Subject + body HTML from the same
  templates/tokens as before (`renderTemplate()`, `REFUND_EMAIL_TEMPLATE_VAR_KEYS`,
  `{breakdown}` block — unchanged), WITHOUT the signature and WITHOUT sending or requiring a
  connected webmail. That result opens a second "soạn mail" (compose) screen — To and Cc are
  plain inputs (comma-separated, `splitEmails()`, added 2026-08-16 alongside the file
  attachment picker — same `Paperclip`/`fileToDataUrl()`/4MB-total UI as
  `SendCpaEmailDialog`'s, reusing its `cpaEmail.toLabel`/`ccLabel`/`attachLabel`/`attachBtn`/
  `removeAttachment`/`fileTooLarge`/`missingRecipient` i18n keys rather than duplicating
  them), Subject is a plain input, body is a `MailBodyEditor` (rich text, same component
  `SendCpaEmailDialog` uses) — where the user can freely edit all of it before the real send
  (per explicit 2026-08-16 product decision: "cho sửa tự do", not a read-only preview). To
  defaults to the case's email, Cc defaults to Admin's configured `cc` + the sender's own
  webmail address (both computed server-side in `refund-email-preview/route.ts`, editable
  after). Only that screen's "Send" button calls `POST /api/cases/[id]/send-client-email` for
  real, now passing the (possibly-edited) `subject`/`bodyHtml`/`to`/`cc` plus any uploaded
  attachments (base64, decoded server-side into a `Buffer`, re-validated against the same
  4MB cap) directly instead of the route re-deriving them — the route no longer imports
  `buildRefundNotificationEmail` at all, and `to`/`cc` are no longer hardcoded from
  `Case.email`/`ClientEmailTemplate.cc`.
  `Case.bankName`/`routingNumber`/`accountNumber` (3 hidden columns, editable only via the
  "Edit Hồ sơ" popup, same permission group as `refunds`) still feed `{bankLine}` at preview
  time; the Tax credit amount still comes from `Case.refunds[year]`; entered INT amounts
  still persist to `Case.taxIntByYear` (a `Json` column, saved on the server BEFORE
  attempting the SMTP send) so re-opening the picker later pre-fills them — none of that
  changed, only WHEN the final subject/body get frozen (at preview time, editable after)
  instead of (re-)computed fresh at send time.
  The signature block (name/title/avatar/web/email/phone/address/promo line/company banner)
  is still NOT templated and NOT part of what's editable in the compose screen — it's always
  code-generated and appended server-side, right before the SMTP send
  (`finalizeRefundEmailHtml()` in `refund-notification-email.ts`), built from the sending
  user's `name`/`email` (the connected webmail address, not necessarily the app login
  email)/`avatarUrl` plus 4 Admin-configured constants (job title, signature phone, signature
  address, Customer Service phone — `ClientEmailTemplateDialog`, manager-gated on the Phân
  quyền page, still keeps `cc`). It embeds two images as **cid attachments** (not
  base64-inline, for Outlook-desktop compatibility): the sending user's avatar (parsed from
  the `data:image/...;base64,...` URI stored in `User.avatarUrl`) and the fixed company promo
  banner at `public/logo-chuky.png`. All user-sourced token values are HTML-escaped before
  substitution at PREVIEW time (`escapeHtml()` in `refund-notification-email.ts`) —
  `{breakdown}` is the one exception since it's already safe pre-escaped HTML; anything the
  user then types into the `MailBodyEditor` afterward is NOT re-escaped (it's already
  contentEditable-produced HTML, same trust level as `SendCpaEmailDialog`'s body editor).

**Key files:**
- `src/lib/webmail-crypto.ts` — AES-256-GCM `encryptSecret()`/`decryptSecret()` for the
  stored webmail password.
- `src/lib/client-mailer.ts` — `sendClientEmailSmtp()` (nodemailer, dynamic per-call
  credentials), `verifyWebmailCredentials()`, `WebmailAuthError`. `to` is `string[]` (2026-08-
  16, was a single string) since the compose screen lets users edit/add recipients;
  `SendClientEmailInlineAttachment.cid` is now optional — regular user-uploaded attachments
  omit it, only the 2 signature images (avatar/banner) set it.
- `src/app/api/me/webmail-account/route.ts` — `POST` (verify + save credentials), `DELETE`
  (disconnect).
- `src/app/api/cases/[id]/refund-email-preview/route.ts` — the "Confirm" step: same
  auth/feature checks as the send route, merges draft Tax INT with what's already saved
  (without persisting), calls `buildRefundEmailContent()`, returns `{subject, bodyHtml}`. No
  DB writes, no webmail credential required.
- `src/app/api/cases/[id]/send-client-email/route.ts` — the real send: `manual`/`clear`
  branches for Mark-as-sent/resend (mirroring `send-cpa-email`/`test-cpa-review-sheet`),
  otherwise requires `subject` + persists `taxInt`, decrypts the sender's credential, calls
  `finalizeRefundEmailHtml()` to attach the signature to the (possibly-edited) `bodyHtml`,
  sends, maps `WebmailAuthError` to 428, sets `clientEmailSentAt` on success.
- `src/lib/client-email-template.ts` — default Subject/Body templates per language
  (`DEFAULT_REFUND_EMAIL_SUBJECT_VI/EN`, `DEFAULT_REFUND_EMAIL_BODY_VI/EN`), the token list
  (`REFUND_EMAIL_TEMPLATE_VAR_KEYS`), and the 4 signature/contact constant defaults.
- `src/lib/refund-notification-email.ts` — split 2026-08-16 into `buildRefundEmailContent()`
  (Subject + body HTML from templates/tokens/`{breakdown}`, NO signature, NO wrap — the part
  the compose screen shows/edits) and `finalizeRefundEmailHtml()` (appends the
  code-generated signature block + wraps as a light-mode document with `!important`-
  reinforced inline styles, called server-side right before the real SMTP send). There's no
  single combined "build everything" function anymore — the two call sites (preview route,
  send route) each call exactly the piece they need.
- `src/components/connect-webmail-dialog.tsx` — the connect modal (email + password form).
- `src/components/send-client-email-button.tsx` — the button. Moved out of
  `ClientProfileDialog` (2026-08-16) onto the main Cases table itself — it now sits in the
  Status-column icon stack (`src/app/dashboard/cases/page.tsx`), directly below
  `TestSheetButton`, alongside (but gated independently from) `SendToSheetButton`/
  `SendCpaEmailDialog`. Unlike those 3 siblings it is NOT restricted to
  `sendButtonsStatusIds` — only shown when `hasFeature(..., "sendClientEmail", role)` AND
  the case has a non-empty email, regardless of Status.
- `src/store/app-store.ts` — `previewRefundEmail()`, `sendClientEmail()`,
  `markClientEmailSent()`, `connectWebmailAccount()` actions.

**Feature gating**: `sendClientEmail` in `DEFAULT_FEATURE_PERMISSIONS` (`rbac.ts`), default
`["processor"]` — a NON-empty default, so per the gotcha in `.claude/rules/
deployment-database-sync.md` mục 4.8, any change to this default requires the same
production `AppConfig.featurePermissions` merge-script treatment as `viewCpaReview` etc.
(empty-array defaults don't need it; this one isn't empty). This part is unaffected by the
OAuth→SMTP rewrite.

**Env vars** (`.env.example`): `WEBMAIL_SMTP_HOST`/`WEBMAIL_SMTP_PORT` (optional, default to
`mail.directfunder.com:465` SSL if unset) and `WEBMAIL_CREDENTIAL_ENCRYPTION_KEY`
(**required** — `encryptSecret()`/`decryptSecret()` throw immediately if missing). No Azure
App registration, no admin consent, no external OAuth provider of any kind — just a real
mailbox login each user already has.

**Removed 2026-08-15** (do not resurrect without a good reason — see the "Rewritten" note
above): `src/lib/microsoft-graph.ts`, `src/app/api/auth/microsoft/{start,callback}/route.ts`,
`User.microsoftRefreshToken`, `MICROSOFT_OAUTH_CLIENT_ID`/`MICROSOFT_OAUTH_CLIENT_SECRET`/
`MICROSOFT_TENANT_ID`. `src/lib/oauth-state.ts` (the shared CSRF state helper) is still used
by the Google OAuth flow (`connectGoogleAccount`/Send-to-Sheet) — its `OAuthProvider` union
was narrowed back to `"google"` only.
