# GarGift+

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Astro](https://img.shields.io/badge/Astro-7_SSR-BC52EE?logo=astro&logoColor=white)](https://astro.build/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers_%2B_D1_%2B_R2-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Author](https://img.shields.io/badge/GitHub-Reza--Mokhtari--Hub-181717?logo=github)](https://github.com/Reza-Mokhtari-Hub)

A full-stack digital commerce platform built for selling gift cards, software subscriptions, and game top-ups in Iran — running server-first on **Cloudflare Workers**, **D1 (SQLite)**, **R2**, and **Astro 7 SSR**.

Built and maintained by **[Reza Mokhtari (@Reza-Mokhtari-Hub)](https://github.com/Reza-Mokhtari-Hub)**.

---

## Why I Built It This Way

Most open-source storefronts assume USD/Stripe, physical shipping boxes, client-heavy SPAs, and a separate VPS + Postgres setup. Digital gift card commerce in Iran has a different set of constraints:

- **Toman pricing & Jalali localization first:** Currency is stored in integer minor units end to end (`irt` / `Asia/Tehran` in `src/store.config.ts`), formatted at the edge, and paired with native Persian RTL typography (`@fontsource/vazirmatn` + `@fontsource/jetbrains-mono`) and Light / Dark / System themes.
- **Zero-origin-server edge runtime:** Storefront SSR, admin dashboard, scheduled background sweeps, SQLite D1, and object storage all run inside a single Cloudflare Worker (`src/worker.ts`) without external databases or containers.
- **Strict public vs. private file separation:** Product thumbnails and banners live in a public R2 bucket (`BUCKET`), while paid digital license files and customer bank-transfer receipts live in a separate private R2 bucket (`FILES`) that never gets a public domain and only streams after signed token or admin verification.
- **Encrypted runtime secrets in D1:** Payment gateway merchant keys, Turnstile secrets, and mail API tokens are encrypted with AES-256-GCM (`SECRETS_KEK`) inside D1 via Admin Settings instead of triggering redeployments when rotating provider keys.
- **Html-first storefront:** Server-rendered pages with progressive enhancement only where interaction earns it (cart drawer, variant selection, live payment polling), keeping initial payloads small on mobile networks.

---

## Core Capabilities

### Storefront & Digital Catalog
- **Digital Goods Model:** Products support variants, add-on extras, and product-specific checkout fields (account email, player ID, region notes) validated server-side before checkout.
- **Dynamic Homepage CMS:** Configurable homepage sections (`src/features/homepage`), promotional hero banners, FAQs, moderated customer reviews, and custom navigation menus.
- **Fast Local Search:** SQLite FTS5 full-text search with query sanitization and typo tolerance (`src/features/search/fts.ts`), plus an optional Cloudflare Vectorize semantic search adapter.
- **Markdown Content Pages:** Static pages (`/pages/<slug>`) rendered server-side with `markdown-it` (`html: false`) so raw HTML injection is impossible.

### Iranian Payment Rails & Customer Wallet
- **Zarinpal & Zibal Gateways:** Server-verified callback handling (`authority` / `trackId` binding, amount/currency matching, `AbortSignal.timeout` protection, and idempotent settlement claims).
- **Card-to-Card Bank Transfer:** Admin-managed destination bank cards, customer receipt upload stored privately in `FILES`, and an admin verification queue.
- **Customer Wallet:** Top-ups via gateways or approved bank transfers, immutable ledger entries, and instant wallet balance checkout.
- **Atomic Stock Holds:** Checkout reserves inventory in `checkout_reservations` to prevent overselling during in-flight payments; a 5-minute Cloudflare Cron (`scheduled()` in `src/worker.ts`) releases expired holds and retries queued emails.

### Fulfillment, Customer Portal & Notifications
- **Manual & Attachment Fulfillment:** Order fulfillment queue with versioned digital delivery records, private file attachments, and customer order tracking (`/track-order` and capability token URLs `/order/<token>`).
- **Customer Accounts & Support:** Passwordless magic-link login (`/account/login`), saved order history, wallet ledger, and integrated support tickets (`/account/tickets`).
- **Persian Transactional Emails:** D1-backed `email_outbox` with Resend and Cloudflare Email adapters (`src/features/email`).

### Admin Dashboard, RBAC & Security
- **Guided First-Run Setup:** Localized setup wizard at `/admin/setup` to configure store metadata, `Asia/Tehran` timezone, and the initial `super_admin` account; permanently locks once initialized.
- **Granular RBAC & Audit Logs:** Role-based permissions across `super_admin`, `operations_manager`, `fulfillment_manager`, `fulfillment_operator`, `finance_manager`, `product_manager`, `content_manager`, and `support_viewer`, enforced on both SSR pages and `/api/admin/*` endpoints with an immutable audit log (`admin_audit_logs`) and last-Super-Admin deletion protection.
- **Edge & Upload Hardening:** Fail-closed admin middleware (`src/middleware.ts`), optional Cloudflare Access JWT verification, native Workers rate limiting (`AUTH_RATE_LIMITER`, `CHECKOUT_RATE_LIMITER`, `SEARCH_RATE_LIMITER`), strict `x-forwarded-*` origin sanitization (`src/features/http/origin.ts`), magic-byte validation on raster uploads (blocking SVG), and sandboxed `/images/[...key]` CSP headers.

---

## Architecture Overview

The codebase follows vertical feature slices under `src/features/` backed by port interfaces (`PaymentProvider`, `StorageProvider`, `EmailProvider`, `SearchProvider`) so vendor integrations stay isolated from checkout and order logic.

```text
├── migrations/              # Additive D1 SQLite migrations (0001..0044)
├── src/
│   ├── config.ts            # Base configuration schema and defaults
│   ├── store.config.ts      # GarGift+ build-time overrides (currency, TZ, flags)
│   ├── middleware.ts        # Fail-closed auth gate, RBAC guard, security headers
│   ├── worker.ts            # Custom Worker entrypoint (Astro fetch + 5-min cron)
│   ├── themes/gargift/      # Persian RTL tokens, typography, Light/Dark palettes
│   ├── features/
│   │   ├── account/         # Customer portal & session helpers
│   │   ├── admin/           # Admin dashboard state & account management
│   │   ├── audit/           # Admin action audit log queries & writer
│   │   ├── auth/            # HMAC sessions, magic links, CF Access, rate limits
│   │   ├── cache/           # Signed edge cache purge & response caching rules
│   │   ├── cart/            # Cart state & pricing calculations
│   │   ├── catalog/         # Public catalog serialization & DTOs
│   │   ├── categories/      # Category hierarchy & slugs
│   │   ├── currency/        # Toman/Rial integer minor-unit formatting
│   │   ├── customers/       # Customer directory & lookups
│   │   ├── digitalDelivery/ # Private R2 deliverable delivery & versioning
│   │   ├── email/           # Outbox queue, Persian templates, Resend/CF adapters
│   │   ├── fulfillment/     # Order fulfillment state machine & RBAC permissions
│   │   ├── homepage/        # Dynamic homepage sections, banners, FAQs, reviews
│   │   ├── http/            # Proxy origin validation & canonical callback helpers
│   │   ├── ids/             # Prefixed public IDs (prod_, ord_, var_, itm_)
│   │   ├── media/           # R2 media registry & magic-byte upload validator
│   │   ├── navigation/      # Header/footer menu configuration
│   │   ├── orders/          # Order ledger, numbering, atomic stock reservations
│   │   ├── pages/           # Markdown page renderer & layout presets
│   │   ├── payments/        # Zarinpal, Zibal, Bank Transfer, Wallet & gateway core
│   │   ├── products/        # Catalog CRUD, variants, custom checkout fields, FTS5
│   │   ├── refunds/         # Refund tracking & ledger adjustments
│   │   ├── search/          # FTS5 keyword & optional Vectorize semantic search
│   │   ├── secrets/         # AES-256-GCM vault backed by SECRETS_KEK
│   │   ├── settings/        # Runtime store settings stored in D1
│   │   ├── storage/         # R2 storage adapter
│   │   ├── theme/           # Appearance mode & theme switcher helpers
│   │   ├── tickets/         # Customer support ticket system
│   │   └── wallet/          # Customer wallet balances & transaction ledger
│   └── pages/               # Astro SSR routes, /admin/*, /account/*, /api/*
├── test/                    # Vitest unit/contract tests & D1 integration suites
├── docs/                    # Production readiness & Cloudflare infrastructure guide
├── wrangler.jsonc           # Local & base Cloudflare Worker configuration
├── wrangler.template.jsonc  # Per-instance deployment template
└── wrangler.environments.example.jsonc  # Isolated staging/production example
```

---

## Local Development

### Prerequisites
- **Node.js `>= 22.12`**
- **npm**

### 1. Install Dependencies & Initialize Local Env

```sh
npm install
cp .env.example .dev.vars
```

Populate the local secrets in `.dev.vars` (generate 32-byte base64 values with `openssl rand -base64 32`):
- `SECRETS_KEK`
- `AUTH_SECRET`
- `CACHE_PURGE_SECRET`

*(During `npm run dev`, `scripts/ensure-local-env.mjs` also checks local prerequisites automatically.)*

### 2. Apply Local D1 Migrations

```sh
npm run db:migrate
```

Optional sample data for local UI inspection:

```sh
npm run db:seed
```

### 3. Start the Dev Server

```sh
npm run dev
```

The app runs on `http://localhost:3000`. Open `/admin/setup` on a fresh database to create the initial `super_admin` account and save baseline store settings.

To test the production bundle and middleware auth gate locally with Wrangler + Miniflare:

```sh
npm run build
npm run preview
```

---

## Testing & Verification

The project uses **Vitest** for pure domain/security unit tests and **Miniflare / Wrangler** for real SQLite D1 & R2 integration tests.

| Command | What It Checks |
|---|---|
| `npm test` | Syncs theme assets and runs the Vitest suite (pricing, RBAC, origin validation, media magic bytes, payments, wallet, auth) |
| `npm run check` | Runs `astro check` across all `.astro` and `.ts` files |
| `npm run theme:check` | Validates theme tokens, layout presets, and built CSS expectations |
| `npm run build` | Builds the production Cloudflare Worker bundle into `dist/` |
| `npm run test:integration` | Runs end-to-end Miniflare/D1 suites (reservations, refunds, media, menus, guest access, fulfillment, homepage CMS, and D1 smoke tests) |
| `npm run verify` | Full release gate combining unit tests, typechecks, theme checks, production build, CSS check, and D1 integration tests |

---

## Cloudflare Deployment & Environment Isolation

Staging and production deployments are intentionally separated (distinct D1 databases, distinct `BUCKET` / `FILES` R2 buckets, distinct `SESSION` KV namespaces, and separate Worker secrets). Never share `SECRETS_KEK`, `AUTH_SECRET`, or gateway merchant credentials across environments.

Reference templates included in this repo:
- `wrangler.template.jsonc` — standalone instance template
- `wrangler.environments.example.jsonc` — isolated `staging` and `production` environments
- `docs/CLOUDFLARE_PRODUCTION_READINESS.md` — full binding inventory, security header checklist, and launch runbook

### High-Level Production Checklist

1. Create isolated D1 (`DB`) and R2 (`BUCKET`, `FILES`) resources for the target environment, keeping `r2.dev` public access **disabled** on `FILES`.
2. Set `CANONICAL_ORIGIN` to the exact `https://` custom domain so gateway callbacks never rely on request headers.
3. Upload unique per-environment secrets:
   ```sh
   npx wrangler secret put SECRETS_KEK --env production
   npx wrangler secret put AUTH_SECRET --env production
   npx wrangler secret put CACHE_PURGE_SECRET --env production
   ```
4. Apply D1 migrations remotely **before** deploying Worker code:
   ```sh
   npx wrangler d1 migrations apply DB --remote --env production
   ```
5. Run local preflight verification and deploy:
   ```sh
   npm run verify
   npm run deploy
   ```
6. Confirm `/api/health` returns `200 OK`, complete `/admin/setup` on a fresh database, configure Zarinpal/Zibal merchant credentials in **Admin -> Settings -> Payments**, and enable Cloudflare Access Zero Trust in front of `/admin/*`.

---

## Repository Owner

- **GitHub:** [github.com/Reza-Mokhtari-Hub](https://github.com/Reza-Mokhtari-Hub)
- **Contact:** `reza2015zzzx@gmail.com`

## License

MIT
