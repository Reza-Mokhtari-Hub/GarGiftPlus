# GarGift+ — Cloudflare Production Readiness & Security Audit (Phase 6)

This document defines the production architecture inventory, environment isolation model, edge/Worker security hardening controls, and safe launch checklist for **GarGift+** on Cloudflare Workers.

> **Important Operational Rule:** No real Cloudflare account IDs, database UUIDs, or live credentials are committed in this repository. Provisioning and secret injection must be executed separately per environment by an authorized operator.

---

## 1. Structured Cloudflare Infrastructure Inventory

| Resource Name | Binding Name | Purpose | Required / Optional | Local Dev (`astro dev` / `.wrangler/state`) | Staging Availability | Production Requirement | Verification Status |
|---|---|---|---|---|---|---|---|
| **Cloudflare Worker Entry (`src/worker.ts`)** | N/A (`fetch` + `scheduled`) | Astro 7 SSR storefront/admin handler + 5-minute cron sweep (inventory reservation expiry & notification outbox retries) | **Required** | Available (`astro dev` + `wrangler dev`) | Provision dedicated `gargift-plus-staging` Worker | Provision dedicated `gargift-plus-production` Worker (`workers_dev: false` with custom domain) | Verified locally via `astro check`, production `build`, and `wrangler dev` integration suite |
| **Cloudflare D1 Database** | `DB` | Catalog, orders, wallets, bank transfer accounts/receipts, tickets, audit logs, settings, encrypted vault (`migrations/` 0001–0022) | **Required** | Available (isolated `.wrangler/state` SQLite D1) | Dedicated D1 database (`gargift-staging-db`) + `wrangler d1 migrations apply` | Dedicated D1 database (`gargift-prod-db`) + remote migrations before deploy | Verified locally with full migration replay and D1 integration suite |
| **Public Media R2 Bucket** | `BUCKET` | Product thumbnails, gallery images, promotional banners, homepage CMS graphics, store logo | **Required** | Available (local Miniflare R2 storage) | Dedicated R2 bucket (`gargift-staging-images`) | Dedicated R2 bucket (`gargift-prod-images`); optional custom domain via `IMAGE_BASE_URL` | Verified locally (`media.mjs`, Worker `/images/*` endpoint) |
| **Private Files R2 Bucket** | `FILES` | Paid digital fulfillment attachments & customer bank-transfer receipt uploads (never publicly exposed) | **Required** | Available (local Miniflare R2 storage) | Dedicated private R2 bucket (`gargift-staging-files`), `r2.dev` **disabled** | Dedicated private R2 bucket (`gargift-prod-files`), `r2.dev` **disabled**, no public domain | Verified locally (isolated bucket binding enforced by unit & integration checks) |
| **Auth Rate Limiter** | `AUTH_RATE_LIMITER` | Brute-force protection on `/admin/login`, `/admin/setup`, `/account/login`, `/account/verify`, `/api/auth/*` (10 req / 60s per IP) | **Required in Prod** | Declared in `wrangler.jsonc`; optional fail-open if unbound in dev | Dedicated `namespace_id` in staging | Dedicated `namespace_id` in production | Verified via unit tests + middleware dispatch checks |
| **Checkout & Payment Rate Limiter** | `CHECKOUT_RATE_LIMITER` | Abuse protection on `/api/checkout`, `/checkout`, `/pay/*`, `/api/payments/*`, `/api/wallet/topup` (20 req / 60s per IP) | **Required in Prod** | Declared in `wrangler.jsonc`; optional fail-open if unbound in dev | Dedicated `namespace_id` in staging | Dedicated `namespace_id` in production | Verified via unit tests + middleware dispatch checks |
| **Search & Tracking Rate Limiter** | `SEARCH_RATE_LIMITER` | Flood protection on `/search`, `/track-order`, `/api/products`, `/api/support` (60 req / 60s per IP) | **Required in Prod** | Declared in `wrangler.jsonc`; optional fail-open if unbound in dev | Dedicated `namespace_id` in staging | Dedicated `namespace_id` in production | Verified via unit tests + middleware dispatch checks |
| **Cloudflare Worker Secrets** | `SECRETS_KEK`, `AUTH_SECRET`, `CACHE_PURGE_SECRET` | AES-256-GCM vault key encryption (`SECRETS_KEK`), HMAC session/magic-link signing (`AUTH_SECRET`), signed post-deploy purge (`CACHE_PURGE_SECRET`) | **Required** | `.dev.vars` (auto-created locally; never committed) | Set via `wrangler secret put ... --env staging` | Set via `wrangler secret put ... --env production` (unique 32-byte base64 secrets) | Verified (`SECRETS_KEK` Vault encryption & HMAC session signing unit tests) |
| **Cron Triggers** | `scheduled()` (`*/5 * * * *`) | Releases expired stock reservations and retries queued outbox emails | **Required** | Triggered locally when invoked via Wrangler scheduled handler | Enabled in `wrangler.environments.example.jsonc` | Enabled (`*/5 * * * *`) | Handler typechecked and built into `dist/` |
| **Cloudflare Access (Zero Trust)** | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Edge JWT verification gating `/admin/*` & `/api/admin/*` before app auth | **Recommended (Optional)** | Omitted locally (or mocked cleanly in unit tests) | Staging Access App protecting `/admin/*` | Production Access App protecting `/admin/*` with strict `https://` team domain & AUD tag | JWT verification & HTTPS enforcement unit tested |
| **Cloudflare Cache API** | `caches.default` / `cache.enabled` | Edge HTML/asset caching with tag purge (`/api/internal/cache-purge`) | **Optional** (`false` on workers.dev) | Bypassed locally (`false`) | `false` on preview/workers.dev | Enable (`true`) **only** when `CANONICAL_ORIGIN` + custom domain + `workers_dev: false` + `CACHE_PURGE_SECRET` are active | Verified header isolation (`private, no-store` on admin/account/cart/pay/order) |
| **Cloudflare Images** | `IMAGES` | Optional server-side upload re-encoding (`optimizeUpload`) | **Optional** | Absent by default (graceful pass-through) | Enable only if Cloudflare Images plan enabled | Enable only if Cloudflare Images plan enabled | Graceful pass-through verified |
| **Workers AI + Vectorize** | `AI`, `VECTORIZE` | Semantic product search (fallback default is D1 FTS5) | **Optional** | Absent by default (`fts` mode active) | Enable only with separate staging index | Enable only with separate production index | FTS5 fallback verified locally |
| **Cloudflare Email Sending** | `EMAIL` | Native Workers email transport (alternative to Resend HTTPS in D1 Vault) | **Optional** | Absent by default (Outbox + Resend fallback) | Resend Sandbox or dedicated sender domain | Resend or Workers Paid onboarded sender domain | Email outbox pipeline verified locally |
| **Static Assets Binding** | `ASSETS` | Serves `dist/client` compiled JS, Vazirmatn/JetBrains Mono fonts, favicons, and stylesheets | **Required (Auto)** | Emitted in `dist/server/wrangler.json` | Emitted in `dist/server/wrangler.json` | Automatically bundled by `@astrojs/cloudflare` (`main: src/worker.ts`) | Verified in `dist/server/wrangler.json` + `check-built-css` |
| **Astro Session KV Namespace** | `SESSION` | Provisioned automatically by `@astrojs/cloudflare` for Astro runtime session support (note: app auth/cart use signed HMAC cookies) | **Required by Adapter** | Local Miniflare KV (`wrangler dev`) | Dedicated staging KV namespace ID (`wrangler kv namespace create`) | Dedicated production KV namespace ID (`wrangler kv namespace create`) | Adapter binding verified in `dist/server/wrangler.json` |
| **Queues / Durable Objects** | *None* | Not used — retries run via D1 `email_outbox` + Cron (`scheduled`) | *Not Needed* | N/A | N/A | N/A | Architecture audit confirmed zero hidden queue/DO dependencies |

---

## 2. Environment Separation (Development vs Staging vs Production)

Never share D1 databases, R2 buckets, `SECRETS_KEK`, `AUTH_SECRET`, `CACHE_PURGE_SECRET`, or payment merchant accounts across environments. Reference `wrangler.environments.example.jsonc` and `.env.example` for isolated templates.

| Dimension | Development (Local) | Staging | Production |
|---|---|---|---|
| **Origin / Ingress** | `http://localhost:3000` / `http://127.0.0.1` | `https://staging.example.com` (`CANONICAL_ORIGIN`) | `https://shop.example.com` (`CANONICAL_ORIGIN`, `workers_dev: false`) |
| **D1 Database** | Local `.wrangler/state` SQLite D1 | `gargift-staging-db` (distinct `database_id`) | `gargift-prod-db` (distinct `database_id`) |
| **R2 Media (`BUCKET`)** | Local `.wrangler/state` R2 | `gargift-staging-images` | `gargift-prod-images` |
| **R2 Private (`FILES`)** | Local `.wrangler/state` R2 | `gargift-staging-files` (no public access) | `gargift-prod-files` (no public access) |
| **Worker Secrets** | `.dev.vars` (local only) | Staging-only `wrangler secret put --env staging` | Production-only `wrangler secret put --env production` |
| **Payment Gateways** | Zarinpal/Zibal **Sandbox** (`demo` optional) | Zarinpal/Zibal **Sandbox** only; Bank transfer test accounts | Live Zarinpal/Zibal Merchant IDs in encrypted Vault; Demo rail **disabled** |
| **Edge Caching** | Disabled (`cache.enabled: false`) | Disabled (`cache.enabled: false`) | Enabled only with `CANONICAL_ORIGIN`, custom domain, `CACHE_PURGE_SECRET` |

---

## 3. Worker & Application Security Controls

### Authentication, RBAC & Edge Perimeter
- **Fail-Closed Admin Middleware (`src/middleware.ts`)**: When setup is incomplete (`setup_complete != 'true'` and no admins exist), all `/admin/*` routes redirect to `/admin/setup` (and `/api/admin/*` fail closed with `403` JSON). Once initialized, `/admin/setup` is locked (`404` / redirect), and every `/admin/*` or `/api/admin/*` route requires either a valid signed HMAC `admin_session` cookie (with active admin + role RBAC permission verification) or verified Cloudflare Access JWT.
- **Role-Based Access Control (RBAC)**: Server-side `guardAdminPage` / `guardAdminApi` enforces granular permissions (`orders.view`, `orders.manage`, `payments.verify`, `wallets.manage`, `admins.manage`, `maintenance.manage`, `audit.view`, etc.) on both UI pages and JSON/form API endpoints, prevents privilege self-escalation, and blocks removing/deactivating the last active `super_admin`.
- **Cloudflare Access Hardening (`src/features/auth/access.ts`)**: Enforces `https:` protocol on `CF_ACCESS_TEAM_DOMAIN` and a 10-second `AbortSignal.timeout` when fetching JWKS certificates.

### HTTP Origin, Proxy Trust, Cookies & Security Headers
- **Validated Proxy Origin Resolution (`src/features/http/origin.ts`)**: Sanitizes `x-forwarded-proto` (`http` / `https` only) and `x-forwarded-host` (strict host regex + URL parse without credentials or path injection) before deriving `effectiveUrl`.
- **Canonical Payment Callback Origin (`gatewayCallbackOrigin`)**: Uses `CANONICAL_ORIGIN` for Zarinpal, Zibal, checkout, and wallet top-up callback URLs in non-loopback deployments so forwarded headers can never redirect gateway callbacks to untrusted hosts.
- **Proxy-Aware Cookie Flags (`isSecureRequest`)**: Admin session, customer session, cart session, and flash cookies consistently set `HttpOnly`, `SameSite=Lax`, and `Secure` over direct HTTPS or reverse-proxied TLS (`x-forwarded-proto: https`).
- **Response Security Headers**:
  - `X-Content-Type-Options: nosniff` on all responses.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` on HTTPS responses.
  - `Referrer-Policy: strict-origin-when-cross-origin` (with strict `no-referrer` preserved on capability/payment pages `/order/*`, `/pay/*`, `/attachments/*`).
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` and `X-Permitted-Cross-Domain-Policies: none`.
  - Authenticated, account, cart, checkout, order, pay, and health endpoints explicitly emit `Cache-Control: private, no-store` / `no-store`.

### Media Uploads, Private Deliverables & Secret Vault
- **Magic-Byte Image Validation (`validateUploadContent`)**: All HTTP upload endpoints (`/api/admin/media`, `/api/admin/homepage`, `/api/admin/products`, `/api/admin/products/[id]`, `/api/admin/products/[id]/images`) verify real JPEG, PNG, WebP, or GIF magic signatures matching the declared MIME type alongside the 5 MB limit; SVG uploads are blocked.
- **Sandboxed Image Serving (`/images/[...key]`)**: Serves R2 media objects with `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff` for defense-in-depth against active content execution.
- **Private Bucket Isolation (`FILES`)**: Digital delivery files and customer bank-transfer receipts are stored strictly in `FILES` (never `BUCKET`) and served only after token/entitlement or admin authorization checks.
- **Encrypted Vault (`src/features/secrets/store.ts`)**: Payment gateway merchant IDs, Turnstile secret, and Resend API key are encrypted with AES-256-GCM using `SECRETS_KEK` before storage in D1.

### Payment Gateway & Rate-Limit Resilience
- **Gateway Callback Integrity (`zarinpal/callback.ts`, `zibal/callback.ts`)**: Checks authority / `trackId` mismatches *before* permitting query-string cancellation transitions, enforces 15-second `AbortSignal.timeout` + HTTP 5xx error checks on verification calls, validates amount & currency atomically via `claimPaymentTxVerified`, and executes idempotent settlement (`settlePendingOrderFromTx` / `settleWalletTopupOnce`).
- **Rate Limiting (`src/features/auth/rateLimit.ts`)**: Covers login, first-run `/admin/setup` POST submissions, magic-link verification, checkout/top-up, payment submissions, search, order tracking, and support tickets with `Retry-After` responses on `429`.

---

## 4. Safe Preflight, Deployment & Rollback Runbook

> Execute these commands against the target environment only after reviewing configuration values and creating required Cloudflare resources.

### Pre-Deployment Verification Checklist (Local / CI)
1. **Dependencies & Typecheck**: `npm run check`
2. **Unit Tests (security, payments, auth, origin, media, RBAC)**: `npm run test`
3. **Theme Asset Integrity**: `npm run theme:check`
4. **Production SSR Build & CSS Verification**: `npm run build && node scripts/check-built-css.mjs`
5. **D1 & Edge Integration Suite**: `npm run test:integration`
6. **Build Preflight (No Remote Mutations)**: `npm run deploy -- --preflight-only`

### First-Time Environment Provisioning (Staging / Production)
1. Create isolated D1 database (`npx wrangler d1 create gargift-prod-db`) and isolated R2 buckets (`gargift-prod-images`, `gargift-prod-files`). Verify `r2.dev` public URL stays **disabled** on `gargift-prod-files`.
2. Update your deployment config with real database/bucket names & IDs, `CANONICAL_ORIGIN`, and Cloudflare Access vars (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`).
3. Set distinct per-environment secrets:
   - `npx wrangler secret put SECRETS_KEK --env production`
   - `npx wrangler secret put AUTH_SECRET --env production`
   - `npx wrangler secret put CACHE_PURGE_SECRET --env production`
4. Apply D1 migrations remotely **before** deploying Worker code:
   - `npx wrangler d1 migrations apply DB --remote --env production`
5. Deploy Worker:
   - `npm run deploy` (runs `astro build`, theme stamp check, migration check, deploy, and signed cache purge when enabled).

### Post-Deploy Verification & Launch Go/No-Go Checks
- [ ] `GET https://<domain>/api/health` returns `200 OK` with `{ "status": "ok", "db": "ok" }`.
- [ ] Security headers confirmed on homepage and `/admin/login` (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- [ ] Unauthenticated `GET /admin` and `GET /api/admin/settings` reject/redirect cleanly; `/api/admin/maintenance` rejects non-`super_admin` and unauthenticated `POST` with `401`/`403`.
- [ ] Complete `/admin/setup` (if brand-new DB) with strong `super_admin` password, `Asia/Tehran` timezone, and `GarGift+` store branding; confirm `/admin/setup` becomes inaccessible afterward.
- [ ] Configure real Zarinpal/Zibal merchant credentials and disable Demo checkout (`demoEnabled = false`) in Admin → Settings → Payments.
- [ ] Configure Resend / Cloudflare Email sender domain and verify test notification delivery in Admin → Emails.
- [ ] Configure Cloudflare Access Zero Trust policy protecting `/admin/*` and verify JWT enforcement.
- [ ] Take a D1 snapshot before major updates (`npx wrangler d1 export <db-name> --remote` — see `AGENTS.md` FTS5 export note if dropping/recreating FTS5 virtual tables) and verify rollback version availability in Cloudflare Workers Deployments.
