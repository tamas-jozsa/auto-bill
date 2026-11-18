# auto-bill — spec

## Problem

I rent out two places. Utility bills arrive by email on random days. On the 10th of
every month I collect what I paid (with proofs) and work out what each tenant owes me:
utilities + rent + condominium fee ± one-off adjustments (e.g. a tenant fixed something
and I reimburse them). This is manual, boring and error-prone.

## Goal

A single Cloudflare Worker that:

1. Receives forwarded bill emails, extracts the bill data with AI, stores the PDF.
2. Lets me (admin) review bills and turn them into a **monthly statement** per location.
3. Gives tenants a read-only portal to see their statements, bills and PDFs.

## Non-goals (explicitly out of scope)

- Bank integration, online payments, payment reconciliation from bank statements.
- Meter readings / consumption tracking.
- Splitting one bill across multiple locations.
- Multi-currency maths inside one statement (a location has one currency).
- Managing Cloudflare Access policies from the app.

## Architecture

| Piece | Choice |
|---|---|
| Runtime | One Worker (`auto-bill`): `fetch` (UI), `email` (intake), `scheduled` (cron) |
| Data | D1 (`auto-bill`) for everything structured |
| Files | R2 (`auto-bill-files`): bill PDFs, raw emails, payment proofs |
| Extraction | Workers AI: `toMarkdown` (PDF → text) + LLM with JSON schema output (default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, configurable) |
| Auth | Cloudflare Access (identity) + `users` table in D1 (authorization) |
| UI | Server-rendered HTML (Hono JSX), plain forms, no SPA |

Secrets/config live in `wrangler secret` / `vars`, never in the repo.

## Bill intake

1. Utility emails are auto-forwarded to `bills@tamasjozsa.net` → Email Routing → Worker.
2. **Sender allowlist** (`ALLOWED_SENDERS`, comma-separated emails or `@domain`). Matched
   against the envelope sender or the `From` header. Anything else is rejected.
3. Raw email is stored in R2 (`raw/<id>.eml`).
4. Each PDF attachment becomes one bill: PDF to R2 (`bills/<id>.pdf`), text via
   `toMarkdown`, fields via LLM.
5. No PDF attachment (e.g. "your bill is ready, click here") → a bill with status
   `pending_review` and a note, so it is never silently lost.
6. `contract_number` is looked up in `contracts` → sets `location_id` (and default type).
7. Same `contract_number` + `invoice_number` already present → status `duplicate`.
8. Admins can also **upload a PDF manually**; it goes through the same pipeline.

AI output is never trusted blindly: every bill lands in `pending_review`. Only `approved`
bills can appear on a statement. The bill text is treated as untrusted input
(prompt-injection), output is constrained to a JSON schema and reviewed by a human.

### Extracted fields

`contract_number`, `utility_type` (electricity/gas/water/internet/other), `provider`,
`invoice_number`, `amount` (negative = credit), `currency`, `issue_date`, `due_date`,
`period_start`, `period_end`, `notes`.

## Monthly statement (the core feature)

- A **statement** = one location + one month (`YYYY-MM`), made of **line items**.
- Line item kinds: `utility` (linked to a bill), `rent`, `condo_fee`, `adjustment`.
- Sign convention: **positive = tenant owes me, negative = I owe the tenant**.
- **Recurring items** (rent, condo fee, …) are defined per location and copied into
  every new statement.
- Utility lines: every `approved` bill of that location that is not yet on any
  statement. ("Everything approved since the last statement" — no guessing which month
  a bill belongs to.) A bill can be on at most one statement.
- Status flow: `draft` → `sent` → `paid`. Drafts are editable (add adjustment, remove
  line, pull in newly approved bills). Sent/paid are locked; admin can re-open to draft.
- Tenants only see `sent` and `paid` statements.
- Cron on the 10th (06:00 UTC) creates drafts for every location for that month.
- Amounts are stored as integer minor units (cents/fillér); currency per location.

## Payments & proofs

Per bill, admin can record `paid_at` and upload a payment proof (PDF/image) to R2.
Tenants can view the bill PDF and proof for bills on their visible statements.

## Users & access

- Cloudflare Access protects the hostname (e.g. email one-time PIN, "everyone" policy).
  The app verifies the Access JWT (`Cf-Access-Jwt-Assertion`, team domain + AUD).
- Authorization is the `users` table: `role` (`admin`/`tenant`), `banned`.
- Emails in `ADMIN_EMAILS` are auto-provisioned as admins (bootstrap).
- **Invite** = admin adds email + assigns location(s). **Ban** = flag; banned/unknown
  users get 403.
- Tenants see only locations they are assigned to. Admins see everything.
- Comments: on a statement (optionally a specific line); tenants and admins can comment.
  This is the lightweight way to dispute a charge.

## Data model (D1)

```
users(id, email UNIQUE, name, role, banned, created_at)
locations(id, name, address, currency, created_at)
location_users(location_id, user_id)                       -- tenant ↔ location
contracts(id, contract_number UNIQUE, location_id, utility_type, provider, note)
recurring_items(id, location_id, kind, description, amount, active)
bills(id, status, source, location_id?, contract_number, utility_type, provider,
      invoice_number, amount, currency, issue_date, due_date, period_start, period_end,
      notes, pdf_key, raw_email_key, email_from, email_subject, extraction,
      paid_at, proof_key, created_at, updated_at)
      status ∈ pending_review | approved | rejected | duplicate
statements(id, location_id, month, status, sent_at, paid_at, created_at,
           UNIQUE(location_id, month))
line_items(id, statement_id, kind, description, amount, bill_id UNIQUE?, created_at)
comments(id, statement_id, line_item_id?, user_id, body, created_at)
```

## UI

- **Tenant** `/`: their locations → statements (total, status) → statement detail
  (lines, bill PDFs, proofs, comments).
- **Admin**
  - `/admin` dashboard: review queue count, locations, latest statements.
  - `/admin/bills` (filter by status), `/admin/bills/:id`: PDF preview, edit fields,
    set location, approve/reject, mark paid + upload proof. `/admin/bills/new`: upload.
  - `/admin/locations/:id`: details, contract numbers, recurring items, tenants,
    statements, "create statement for month".
  - `/statements/:id`: shared with tenants; admins get edit controls.
  - `/admin/users`: invite, change role, ban/unban.
  - **View as tenant**: admin picks a tenant (dashboard or users page) and sees the site
    exactly as that tenant, read-only, with a banner to switch back. Implemented as an
    HttpOnly cookie that is only honoured when the Access-authenticated user is an admin;
    all writes are blocked while previewing.
- UI language: Hungarian.

## Phases

1. **Phase 1 (MVP):** intake → extraction → review queue → R2/D1; locations, contracts,
   recurring items; admin builds statements. *Replaces the manual 10th-of-month work.*
2. **Phase 2:** tenant portal (statements, PDFs, comments), user invite/ban.
3. **Phase 3:** cron drafts on the 10th, email notification to admin / tenants on "sent".

Status: phases 1–2 and the cron drafts are implemented and tested locally. Notification
emails are not built yet.

## Migration from the old `bill-reader` worker

The existing `bills@tamasjozsa.net` routing rule points to `bill-reader` (1 bill in its
D1). `auto-bill` uses its own D1/R2. Cutover = repoint the routing rule to `auto-bill`,
re-upload the old PDF(s) manually, then delete `bill-reader`.
