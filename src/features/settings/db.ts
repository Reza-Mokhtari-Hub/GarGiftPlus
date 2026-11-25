import type { D1Database } from '@cloudflare/workers-types';
import { normalizeTimeZone } from './timeZone';
import {
  parseRuntimeShippingConfig,
  type ParsedRuntimeShippingConfig,
} from '../shipping/settings';
import { defaultWeightUnit, isWeightUnit, type WeightUnit } from '../shipping/weight';

/**
 * Runtime settings — the small set of values the setup wizard persists to D1 so
 * they can change without a redeploy. Everything else stays build-time config.
 * Reads here OVERLAY env/config defaults; absence means "use the default".
 */

/** Keys we store. Kept narrow on purpose — most config remains build-time. */
export type SettingKey =
  | 'setup_complete' // '1' once the wizard has been finished
  | 'store_name' // overrides config.storeName
  | 'time_zone' // IANA zone for store/admin date display; absent = config/env default
  | 'stripe_webhook_secret' // captured by webhook auto-registration (env wins if set)
  | 'payment_methods_disabled' // CSV of payment methods the admin switched off
  | 'cart_enabled' // '0' = cart/checkout off (browse-only catalog); absent = on
  | 'buy_now_enabled' // '0' = hide "Buy now" (cart-only purchase); absent = on
  | 'search_provider' // 'fts' | 'vector' — overrides config/SEARCH_PROVIDER; absent = default
  // Runtime overrides of build-time config toggles ('1'/'0'; absent = inherit config).
  | 'discounts_enabled' // overrides config.discounts.enabled
  | 'tax_enabled' // overrides config.tax.enabled
  | 'accounts_enabled' // overrides config.features.accounts
  | 'image_optimize' // overrides config.images.optimizeOnUpload
  | 'image_delivery' // 'cloudflare' = responsive on-demand transforms; absent = originals
  | 'shipping_enabled' // LEGACY: overrides config.shipping.enabled. Only consulted while no shipping_config document exists.
  | 'shipping_config' // the merchant-managed shipping document (JSON; see features/shipping/settings.ts)
  | 'weight_unit' // 'g' | 'kg' | 'oz' | 'lb' — Admin input/display unit; storage is always grams
  | 'ship_from' // JSON ShipFrom — the store's return address for label purchase (read at label time, not in locals)
  | 'parcel_default' // JSON {length,width,height} — remembered box dimensions for label purchase
  | 'admin_password_hash' // PBKDF2 hash of the admin password (set at setup). NOT in StoreSettings — read only by the auth layer, never loaded into locals.
  // Integrations configured in the admin dashboard (non-secret halves; the keys
  // live encrypted in the vault — see features/secrets/store.ts).
  | 'email_enabled' // '0' = order/login email off; absent = on
  | 'email_provider' // 'resend' | 'cloudflare'; absent = resend
  | 'logo_image_key' // media image_key shown instead of the text store name; absent = text
  | 'home_page' // what / renders: 'page:<id>' | 'product:<id>'; absent = the catalog list
  | 'announcement' // storefront announcement bar text; absent/empty = bar hidden
  | 'announcement_href' // optional link for the announcement bar
  | 'email_from' // sender address; absent = build-time default
  | 'store_url' // origin last seen serving a settlement, so the cron can build order links
  | 'email_from_name' // sender display name; absent = store name
  | 'email_notify_to' // owner "new order" alert recipient; absent = store.config.ts notifyTo
  | 'turnstile_enabled' // '1' = bot challenge on (admin login + customer sign-in); absent = off
  | 'turnstile_site_key' // Turnstile public sitekey
  | 'payment_provider' // 'stripe' | 'lightning' | 'opennode' | 'zarinpal' | 'zibal' | 'bank_transfer' | 'wallet' | 'demo'; absent = stripe
  | 'lightning_backend' // 'phoenixd' | 'lnbits'; absent = phoenixd
  | 'lnbits_url' // LNbits node URL (the invoice/read key is in the vault)
  | 'phoenixd_url' // phoenixd node URL (the password is in the vault)
  | 'opennode_api_url' // OpenNode API base override (testnet); absent = live default
  | 'zarinpal_sandbox' // '1' = use sandbox.zarinpal.com
  | 'zibal_sandbox' // '1' = use Zibal sandbox ('zibal' merchant)
  | 'bank_transfer_enabled' // '0' = disable card-to-card/bank transfer; absent/'1' = enabled when active bank accounts exist
  | 'bank_accounts_ready' // '1' when at least one active bank account exists in bank_accounts
  | 'wallet_enabled' // '0' = disable customer wallet; absent/'1' = enabled
  | 'wallet_min_topup' // minimum integer Toman top-up
  | 'wallet_max_topup' // maximum integer Toman top-up
  | 'store_currency' // runtime currency override ('irt' | 'irr' | 'usd')
  | 'admin_default_role' // fallback RBAC role when CF Access/primary session doesn't specify one
  | 'admin_session_ttl_hours' // admin login cookie lifetime in hours
  | 'customer_session_ttl_days' // customer magic-link session lifetime in days
  | 'theme_appearance_config' // validated JSON customization for storefront theme appearance
  | 'seo_meta_title' // default storefront SEO title suffix/override
  | 'seo_meta_description' // default storefront meta description
  | 'seo_og_image_key' // default storefront OpenGraph image media key
  | 'seo_robots_disallow_admin' // '0' to customize, default '1' keeps /admin Disallow
  | 'email_reply_to' // optional Reply-To email address
  | 'email_test_mode' // '1' logs or labels emails cleanly without breaking flows
  | `enc:${string}`; // AES-GCM-encrypted secret (see features/secrets/store.ts), e.g. 'enc:stripe_secret_key'. Never loaded as plaintext into locals.

/** The storefront features that can be flipped at runtime (default on). */
export type FeatureKey = 'cart_enabled' | 'buy_now_enabled';

export interface StoreSettings {
  setupComplete: boolean;
  storeName: string | null;
  /** Runtime IANA time zone, or null to use TIME_ZONE / UTC. */
  timeZone: string | null;
  stripeWebhookSecret: string | null;
  /** Methods the admin disabled at runtime. A method is offered iff it's both
   *  configured (keys present) AND not in this list. Empty = nothing disabled. */
  disabledPaymentMethods: string[];
  /** Add-to-cart + checkout available (default true). Off → browse-only catalog. */
  cartEnabled: boolean;
  /** "Buy now" instant-checkout button shown (default true). Requires cartEnabled. */
  buyNowEnabled: boolean;
  /** Search backend chosen at runtime, or null to use the build-time default
   *  (config.search.provider / SEARCH_PROVIDER). */
  searchProvider: 'fts' | 'vector' | null;
  /** Payment-secret names (e.g. 'stripe_secret_key') the admin has stored encrypted
   *  in D1 — i.e. names with a non-empty `enc:` row. Lets the storefront know a key
   *  is configured WITHOUT decrypting it. Env-var fallbacks are checked separately
   *  (see features/secrets/store.ts → hasSecret). */
  configuredSecrets: string[];
  /** Order/login email on (default true; a no-op until a provider key is set). */
  emailEnabled: boolean;
  /** Email backend: 'resend' (free) or 'cloudflare' (paid send_email binding). */
  emailProvider: 'resend' | 'cloudflare';
  /** Sender address / display name, or null to use the build-time defaults. */
  /** Header logo object key, or null to render the store name as text. Stores the
   *  immutable key rather than a media id so the layout renders it without a
   *  second D1 lookup. */
  logoImageKey: string | null;
  /** What `/` renders: 'page:<id>', 'product:<id>', or null for the catalog
   *  list. Stored as an id so renaming the target cannot break it. */
  homePage: string | null;
  /** Announcement bar message, or null to hide the bar entirely. The message IS
   *  the on/off switch — an empty value deletes the row, so there is no separate
   *  enabled flag to fall out of sync with it. */
  announcement: string | null;
  /** Optional destination making the whole announcement bar clickable. */
  announcementHref: string | null;
  emailFrom: string | null;
  emailFromName: string | null;
  emailNotifyTo: string | null;
  // Nullable = inherit the build-time config default (resolve at the consumer).
  discountsEnabled: boolean | null;
  taxEnabled: boolean | null;
  accountsEnabled: boolean | null;
  imageOptimize: boolean | null;
  /** Product-image delivery. Original is the safe, zero-configuration default. */
  imageDelivery: 'original' | 'cloudflare';
  /** LEGACY on/off switch. Consulted only when `shippingConfig` is absent — a
   *  saved document owns `enabled` itself. */
  shippingEnabled: boolean | null;
  /** The complete parse state, not a nullable config: absent (inherit build-time)
   *  and invalid (fail closed) must stay distinguishable, and the invalid case
   *  carries the raw value the Admin replacement flow needs. */
  shippingConfig: ParsedRuntimeShippingConfig;
  /** Unit the Admin forms read and write. Storage is always integer grams. */
  weightUnit: WeightUnit;
  /** Turnstile bot challenge on (admin login + customer sign-in). Default off. */
  turnstileEnabled: boolean;
  /** Turnstile public sitekey, or null. (The secret lives in the vault.) */
  turnstileSiteKey: string | null;
  /** Default payment rail (Settings → Payments). Default 'stripe'. */
  paymentProvider:
    | 'stripe'
    | 'lightning'
    | 'opennode'
    | 'zarinpal'
    | 'zibal'
    | 'bank_transfer'
    | 'wallet'
    | 'demo';
  /** Self-hosted Lightning node (when provider/rail is lightning). Default 'phoenixd'. */
  lightningBackend: 'phoenixd' | 'lnbits';
  /** Lightning node URLs, or null. (The key/password live in the vault.) */
  lnbitsUrl: string | null;
  phoenixdUrl: string | null;
  /** OpenNode API base override (testnet), or null for the live default. */
  opennodeApiUrl: string | null;
  /** Zarinpal sandbox mode ('1' = sandbox.zarinpal.com). */
  zarinpalSandbox: boolean;
  /** Zibal sandbox mode ('1' = merchant 'zibal'). */
  zibalSandbox: boolean;
  /** Bank Transfer (Card-to-Card) enabled toggle (default true). */
  bankTransferEnabled: boolean;
  /** True when at least one active destination bank account is configured. */
  hasActiveBankAccounts: boolean;
  /** Customer Wallet enabled toggle (default true). */
  walletEnabled: boolean;
  /** True when wallet_enabled was explicitly turned on ('1') in settings. */
  walletExplicitlyEnabled: boolean;
  /** Minimum wallet top-up in integer Toman (default 10,000). */
  walletMinTopup: number;
  /** Maximum wallet top-up in integer Toman (default 50,000,000). */
  walletMaxTopup: number;
  /** Optional runtime store currency ('irt' | 'irr' | 'usd'). */
  storeCurrency: string | null;
  /** Default RBAC role fallback when not derived from operator user row. */
  adminDefaultRole: string | null;
  /** Admin cookie session TTL in hours (default 168 = 7 days). */
  adminSessionTtlHours: number;
  /** Customer session TTL in days (default 30 days). */
  customerSessionTtlDays: number;
  /** Raw validated storefront theme appearance JSON string. */
  themeAppearanceConfig: string | null;
  /** Storefront SEO defaults. */
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  seoOgImageKey: string | null;
  seoRobotsDisallowAdmin: boolean;
  /** Email settings extensions. */
  emailReplyTo: string | null;
  emailTestMode: boolean;
}

/** One setting value, or null if unset. */
export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** Upsert a setting (empty/undefined value deletes it → falls back to the default). */
export async function setSetting(
  db: D1Database,
  key: SettingKey,
  value: string | null | undefined,
): Promise<void> {
  if (value == null || value === '') {
    await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(key, value)
    .run();
}

/** The single settings read. Exported so middleware can put it in a batch
 *  alongside the footer's page links without duplicating the SQL. */
export const STORE_SETTINGS_SQL = 'SELECT key, value FROM settings';

/** All overlay settings in one read (used by middleware to populate locals). */
export async function getStoreSettings(db: D1Database): Promise<StoreSettings> {
  const { results } = await db.prepare(STORE_SETTINGS_SQL).all<{
    key: string;
    value: string;
  }>();
  return parseStoreSettings(results ?? []);
}

/** Rows → settings. Split from the query so a batched read parses identically. */
export function parseStoreSettings(
  results: Array<{ key: string; value: string }>,
): StoreSettings {
  const map = new Map((results ?? []).map((r) => [r.key, r.value]));
  const rawMinTopup = Number(map.get('wallet_min_topup') ?? '');
  const rawMaxTopup = Number(map.get('wallet_max_topup') ?? '');
  const rawCurrency = (map.get('store_currency') ?? '').trim().toLowerCase();
  return {
    setupComplete: map.get('setup_complete') === '1',
    storeName: map.get('store_name') ?? null,
    timeZone: normalizeTimeZone(map.get('time_zone')),
    stripeWebhookSecret: map.get('stripe_webhook_secret') ?? null,
    disabledPaymentMethods: (map.get('payment_methods_disabled') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cartEnabled: map.get('cart_enabled') !== '0',
    buyNowEnabled: map.get('buy_now_enabled') !== '0',
    searchProvider: map.get('search_provider') === 'vector' ? 'vector'
      : map.get('search_provider') === 'fts' ? 'fts'
      : null,
    configuredSecrets: (results ?? [])
      .filter((r) => r.key.startsWith('enc:') && r.value)
      .map((r) => r.key.slice(4)),
    emailEnabled: map.get('email_enabled') !== '0',
    emailProvider: map.get('email_provider') === 'cloudflare' ? 'cloudflare' : 'resend',
    logoImageKey: map.get('logo_image_key') ?? null,
    homePage: map.get('home_page') ?? null,
    announcement: map.get('announcement') ?? null,
    announcementHref: map.get('announcement_href') ?? null,
    emailFrom: map.get('email_from') ?? null,
    emailFromName: map.get('email_from_name') ?? null,
    emailNotifyTo: map.get('email_notify_to') ?? null,
    discountsEnabled: map.get('discounts_enabled') == null ? null : map.get('discounts_enabled') === '1',
    taxEnabled: map.get('tax_enabled') == null ? null : map.get('tax_enabled') === '1',
    accountsEnabled: map.get('accounts_enabled') == null ? null : map.get('accounts_enabled') === '1',
    imageOptimize: map.get('image_optimize') == null ? null : map.get('image_optimize') === '1',
    imageDelivery: map.get('image_delivery') === 'cloudflare' ? 'cloudflare' : 'original',
    shippingEnabled: map.get('shipping_enabled') == null ? null : map.get('shipping_enabled') === '1',
    // Parsed from the rows we already have — no extra query, and the storefront
    // never has to decide what a malformed document means on its own.
    shippingConfig: parseRuntimeShippingConfig(map.get('shipping_config')),
    weightUnit: isWeightUnit(map.get('weight_unit'))
      ? (map.get('weight_unit') as WeightUnit)
      : defaultWeightUnit(normalizeTimeZone(map.get('time_zone'))),
    turnstileEnabled: map.get('turnstile_enabled') === '1',
    turnstileSiteKey: map.get('turnstile_site_key') ?? null,
    paymentProvider:
      map.get('payment_provider') === 'lightning' ? 'lightning'
      : map.get('payment_provider') === 'opennode' ? 'opennode'
      : map.get('payment_provider') === 'zarinpal' ? 'zarinpal'
      : map.get('payment_provider') === 'zibal' ? 'zibal'
      : map.get('payment_provider') === 'bank_transfer' ? 'bank_transfer'
      : map.get('payment_provider') === 'wallet' ? 'wallet'
      : map.get('payment_provider') === 'demo' ? 'demo'
      : 'stripe',
    lightningBackend: map.get('lightning_backend') === 'lnbits' ? 'lnbits' : 'phoenixd',
    lnbitsUrl: map.get('lnbits_url') ?? null,
    phoenixdUrl: map.get('phoenixd_url') ?? null,
    opennodeApiUrl: map.get('opennode_api_url') ?? null,
    zarinpalSandbox: map.get('zarinpal_sandbox') === '1',
    zibalSandbox: map.get('zibal_sandbox') === '1',
    bankTransferEnabled: map.get('bank_transfer_enabled') !== '0',
    hasActiveBankAccounts: map.get('bank_accounts_ready') === '1',
    walletEnabled: map.get('wallet_enabled') !== '0',
    walletExplicitlyEnabled: map.get('wallet_enabled') === '1',
    walletMinTopup:
      Number.isSafeInteger(rawMinTopup) && rawMinTopup > 0 ? rawMinTopup : 10_000,
    walletMaxTopup:
      Number.isSafeInteger(rawMaxTopup) && rawMaxTopup >= 10_000 ? rawMaxTopup : 50_000_000,
    storeCurrency: /^[a-z]{3}$/.test(rawCurrency) ? rawCurrency : null,
    adminDefaultRole: map.get('admin_default_role') ?? null,
    adminSessionTtlHours: (() => {
      const n = Number(map.get('admin_session_ttl_hours') ?? '');
      return Number.isSafeInteger(n) && n >= 1 && n <= 720 ? n : 168;
    })(),
    customerSessionTtlDays: (() => {
      const n = Number(map.get('customer_session_ttl_days') ?? '');
      return Number.isSafeInteger(n) && n >= 1 && n <= 180 ? n : 30;
    })(),
    themeAppearanceConfig: map.get('theme_appearance_config') ?? null,
    seoMetaTitle: map.get('seo_meta_title') ?? null,
    seoMetaDescription: map.get('seo_meta_description') ?? null,
    seoOgImageKey: map.get('seo_og_image_key') ?? null,
    seoRobotsDisallowAdmin: map.get('seo_robots_disallow_admin') !== '0',
    emailReplyTo: map.get('email_reply_to') ?? null,
    emailTestMode: map.get('email_test_mode') === '1',
  };
}

/**
 * Flip a storefront feature on/off. Stored only when OFF ('0') — enabling deletes
 * the row so the default (absent = on) takes over and the table stays tidy.
 */
export async function setFeatureEnabled(
  db: D1Database,
  key: FeatureKey,
  enabled: boolean,
): Promise<void> {
  await setSetting(db, key, enabled ? null : '0');
}

/**
 * Flip one payment method on/off at runtime. Stored as the set of DISABLED
 * methods (so the default — empty — means "offer everything that's configured").
 */
export async function setPaymentMethodDisabled(
  db: D1Database,
  method: string,
  disabled: boolean,
): Promise<void> {
  const current = (await getSetting(db, 'payment_methods_disabled')) ?? '';
  const set = new Set(
    current
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (disabled) set.add(method);
  else set.delete(method);
  // Empty string → setSetting deletes the row → back to the "nothing disabled" default.
  await setSetting(db, 'payment_methods_disabled', [...set].join(','));
}
