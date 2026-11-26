# Rezsiradar

Utility bill intake and monthly tenant statements. Infrastructure names (Worker, D1, R2) remain `auto-bill`.

Utility bill intake + monthly tenant statements on a single Cloudflare Worker.
See [spec.md](spec.md) for the what and why.

```
email ──> Email Routing ──> Worker.email ──> R2 (pdf, raw eml)
                                   └──> Workers AI (toMarkdown + LLM) ──> D1 (bill: pending_review)
admin UI (Access) ──> review/approve bills ──> statement (rent + condo + utilities ± adjustments) ──> sent ──> tenant UI
cron (10th, 06:00 UTC) ──> draft statements for every location
```

## Layout

| Path | What |
|---|---|
| `src/index.tsx` | Worker entry: `fetch`, `email`, `scheduled` |
| `src/intake.ts` | Email parsing, sender allowlist, PDF ingest, duplicate detection |
| `src/extract.ts` | PDF → text → JSON fields (prompt, schema, output normalization) |
| `src/statements.ts` | Statement creation, pulling approved bills, keeping draft lines in sync |
| `src/auth.ts` | Access JWT verification, user/role lookup, CSRF origin check |
| `src/routes/` | UI pages (server-rendered Hono JSX) |
| `migrations/` | D1 schema |

## Local development

```sh
npm install
npm run db:migrate:local
echo 'DEV_AUTH_EMAIL=you@example.com' > .dev.vars   # bypasses Access on localhost only
npm run dev
```

- Open http://localhost:8787. Send `x-dev-email: tenant@example.com` to act as another user.
- `npm run dev` passes `--local-upstream localhost`; without it the custom-domain route makes
  requests look like `bills.tamasjozsa.net` and the localhost-only dev login is refused.
- Simulate an incoming bill:
  `curl -X POST 'localhost:8787/cdn-cgi/handler/email?from=you@example.com&to=bills@tamasjozsa.net' --data-binary @bill.eml`
  (the sender must be in `ALLOWED_SENDERS`).
- Workers AI always runs remotely, so `wrangler` must be logged in.
- `npm test` (unit tests) · `npm run typecheck`

## Deploy

1. Create resources and put the D1 id into `wrangler.jsonc`:
   ```sh
   npx wrangler d1 create auto-bill
   npx wrangler r2 bucket create auto-bill-files
   npm run db:migrate:remote
   ```
2. Pick a hostname (e.g. `bills.tamasjozsa.net`), add it as a custom domain under
   `routes` in `wrangler.jsonc`, then `npm run deploy`.
3. Zero Trust → Access → add a self-hosted application for that hostname. Use an
   "everyone" + one-time PIN policy (the app does authorization itself). Copy the
   application **AUD** tag into `ACCESS_AUD` and deploy again.
4. Email Routing → point `bills@tamasjozsa.net` at the `auto-bill` Worker.
5. In Gmail, auto-forward bill emails to `bills@tamasjozsa.net`. Keep `ALLOWED_SENDERS`
   in sync with the forwarding address.

## Configuration (`vars`)

| Var | Meaning |
|---|---|
| `ADMIN_EMAILS` | Comma-separated bootstrap admins (auto-created, can't be banned) |
| `ALLOWED_SENDERS` | Comma-separated addresses or `@domain`s allowed to send bills |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | Used to verify the Cloudflare Access JWT |
| `AI_MODEL` | Workers AI text model used for extraction |
