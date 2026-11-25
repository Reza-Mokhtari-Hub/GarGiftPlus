import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId.ts';
import type { Product } from '../products/db.ts';
import { buildProductCard } from '../storefront/productCard.ts';
import { buildStorefrontImage } from '../storefront/productCard.ts';
import type { ProductCardModel, StorefrontImage } from '../storefront/models.ts';
import type { ImageDelivery } from '../products/image.ts';
import {
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_SERVICE_BENEFITS,
  isWithinScheduleWindow,
  type BannerAccentTheme,
  type FaqCategory,
  type FooterConfig,
  type HomepageSectionKey,
  type ServiceBenefitItem,
  type ValidatedHomepageSectionUpdate,
  type ValidatedPromotionalBannerInput,
  type ValidatedStorefrontFaqInput,
} from './schema.ts';

export interface HomepageSectionRow {
  id: number;
  public_id: string;
  section_key: HomepageSectionKey;
  title: string;
  subtitle: string | null;
  description: string | null;
  badge_text: string | null;
  cta_text: string | null;
  cta_href: string | null;
  secondary_cta_text: string | null;
  secondary_cta_href: string | null;
  desktop_image_key: string | null;
  mobile_image_key: string | null;
  category_filter_slug: string | null;
  max_items: number;
  config_json: string;
  is_enabled: number;
  sort_order: number;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromotionalBannerRow {
  id: number;
  public_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  badge_text: string | null;
  cta_text: string | null;
  cta_href: string;
  desktop_image_key: string | null;
  mobile_image_key: string | null;
  alt_text: string;
  accent_theme: BannerAccentTheme;
  start_at: string | null;
  end_at: string | null;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface StorefrontFaqRow {
  id: number;
  public_id: string;
  question: string;
  answer: string;
  category: FaqCategory;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ProductReviewRow {
  id: number;
  public_id: string;
  product_id: number | null;
  order_id: number | null;
  customer_id: number | null;
  customer_name: string;
  rating: number;
  comment: string;
  is_approved: number;
  created_at: string;
  updated_at: string;
  product_name?: string | null;
  product_slug?: string | null;
}

export interface HomepageCategoryItem {
  id: number;
  publicId: string | null;
  name: string;
  slug: string;
  href: string;
  description: string | null;
  iconKey: string | null;
  accentColor: string | null;
  image: StorefrontImage | null;
  productCount: number;
}

export interface PromotionalBannerModel {
  publicId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  badgeText: string | null;
  ctaText: string;
  ctaHref: string;
  altText: string;
  accentTheme: BannerAccentTheme;
  desktopImage: StorefrontImage | null;
  mobileImage: StorefrontImage | null;
}

export interface HomepageDataModel {
  sections: HomepageSectionRow[];
  activeSections: HomepageSectionRow[];
  announcementSection: HomepageSectionRow | null;
  heroSection: HomepageSectionRow | null;
  heroDesktopImage: StorefrontImage | null;
  heroMobileImage: StorefrontImage | null;
  heroHighlights: string[];
  categories: HomepageCategoryItem[];
  featuredProducts: ProductCardModel[];
  popularProducts: ProductCardModel[];
  aiProducts: ProductCardModel[];
  gamingProducts: ProductCardModel[];
  giftCardProducts: ProductCardModel[];
  promotionalBanners: PromotionalBannerModel[];
  serviceBenefits: ServiceBenefitItem[];
  approvedReviews: ProductReviewRow[];
  hideTestimonialsWhenEmpty: boolean;
  testimonialsEmptyMessage: string;
  faqs: StorefrontFaqRow[];
  footerConfig: FooterConfig;
  referencedProductPublicIds: string[];
}

export async function listHomepageSections(db: D1Database): Promise<HomepageSectionRow[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM homepage_sections ORDER BY sort_order ASC, id ASC')
      .all<HomepageSectionRow>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function getHomepageSectionByKey(
  db: D1Database,
  sectionKey: HomepageSectionKey,
): Promise<HomepageSectionRow | null> {
  try {
    return await db
      .prepare('SELECT * FROM homepage_sections WHERE section_key = ?')
      .bind(sectionKey)
      .first<HomepageSectionRow>();
  } catch {
    return null;
  }
}

export async function updateHomepageSection(
  db: D1Database,
  input: ValidatedHomepageSectionUpdate,
  configJsonOverride?: string,
): Promise<HomepageSectionRow | null> {
  const existing = await getHomepageSectionByKey(db, input.sectionKey);
  const nextConfigJson = configJsonOverride ?? existing?.config_json ?? '{}';

  if (existing) {
    const updated = await db
      .prepare(
        `UPDATE homepage_sections
            SET title = ?,
                subtitle = ?,
                description = ?,
                badge_text = ?,
                cta_text = ?,
                cta_href = ?,
                secondary_cta_text = ?,
                secondary_cta_href = ?,
                desktop_image_key = ?,
                mobile_image_key = ?,
                category_filter_slug = ?,
                max_items = ?,
                config_json = ?,
                is_enabled = ?,
                sort_order = ?,
                start_at = ?,
                end_at = ?,
                updated_at = datetime('now')
          WHERE section_key = ?
          RETURNING *`,
      )
      .bind(
        input.title,
        input.subtitle,
        input.description,
        input.badgeText,
        input.ctaText,
        input.ctaHref,
        input.secondaryCtaText,
        input.secondaryCtaHref,
        input.desktopImageKey,
        input.mobileImageKey,
        input.categoryFilterSlug,
        input.maxItems,
        nextConfigJson,
        input.isEnabled ? 1 : 0,
        input.sortOrder,
        input.startAt,
        input.endAt,
        input.sectionKey,
      )
      .first<HomepageSectionRow>();
    return updated ?? null;
  }

  return withPublicId('homepageSection', async (publicId) => {
    const inserted = await db
      .prepare(
        `INSERT INTO homepage_sections (
           public_id, section_key, title, subtitle, description, badge_text,
           cta_text, cta_href, secondary_cta_text, secondary_cta_href,
           desktop_image_key, mobile_image_key, category_filter_slug,
           max_items, config_json, is_enabled, sort_order, start_at, end_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        publicId,
        input.sectionKey,
        input.title,
        input.subtitle,
        input.description,
        input.badgeText,
        input.ctaText,
        input.ctaHref,
        input.secondaryCtaText,
        input.secondaryCtaHref,
        input.desktopImageKey,
        input.mobileImageKey,
        input.categoryFilterSlug,
        input.maxItems,
        nextConfigJson,
        input.isEnabled ? 1 : 0,
        input.sortOrder,
        input.startAt,
        input.endAt,
      )
      .first<HomepageSectionRow>();
    return inserted ?? null;
  });
}

export async function reorderAndToggleHomepageSections(
  db: D1Database,
  items: { sectionKey: HomepageSectionKey; sortOrder: number; isEnabled: boolean }[],
): Promise<void> {
  if (items.length === 0) return;
  const stmts = items.map((item) =>
    db
      .prepare(
        `UPDATE homepage_sections
            SET sort_order = ?,
                is_enabled = ?,
                updated_at = datetime('now')
          WHERE section_key = ?`,
      )
      .bind(item.sortOrder, item.isEnabled ? 1 : 0, item.sectionKey),
  );
  await db.batch(stmts);
}

// --- Promotional Banners CRUD ---

export async function listPromotionalBanners(db: D1Database): Promise<PromotionalBannerRow[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM promotional_banners ORDER BY sort_order ASC, id ASC')
      .all<PromotionalBannerRow>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function getPromotionalBannerByPublicId(
  db: D1Database,
  publicId: string,
): Promise<PromotionalBannerRow | null> {
  return db
    .prepare('SELECT * FROM promotional_banners WHERE public_id = ?')
    .bind(publicId)
    .first<PromotionalBannerRow>();
}

export async function createPromotionalBanner(
  db: D1Database,
  input: ValidatedPromotionalBannerInput,
): Promise<PromotionalBannerRow> {
  return withPublicId('promoBanner', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO promotional_banners (
           public_id, title, subtitle, description, badge_text,
           cta_text, cta_href, desktop_image_key, mobile_image_key,
           alt_text, accent_theme, start_at, end_at, sort_order, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        publicId,
        input.title,
        input.subtitle,
        input.description,
        input.badgeText,
        input.ctaText,
        input.ctaHref,
        input.desktopImageKey,
        input.mobileImageKey,
        input.altText,
        input.accentTheme,
        input.startAt,
        input.endAt,
        input.sortOrder,
        input.isActive ? 1 : 0,
      )
      .first<PromotionalBannerRow>();
    if (!row) throw new Error('Failed to create promotional banner');
    return row;
  });
}

export async function updatePromotionalBanner(
  db: D1Database,
  publicId: string,
  input: ValidatedPromotionalBannerInput,
): Promise<PromotionalBannerRow | null> {
  return db
    .prepare(
      `UPDATE promotional_banners
          SET title = ?,
              subtitle = ?,
              description = ?,
              badge_text = ?,
              cta_text = ?,
              cta_href = ?,
              desktop_image_key = ?,
              mobile_image_key = ?,
              alt_text = ?,
              accent_theme = ?,
              start_at = ?,
              end_at = ?,
              sort_order = ?,
              is_active = ?,
              updated_at = datetime('now')
        WHERE public_id = ?
        RETURNING *`,
    )
    .bind(
      input.title,
      input.subtitle,
      input.description,
      input.badgeText,
      input.ctaText,
      input.ctaHref,
      input.desktopImageKey,
      input.mobileImageKey,
      input.altText,
      input.accentTheme,
      input.startAt,
      input.endAt,
      input.sortOrder,
      input.isActive ? 1 : 0,
      publicId,
    )
    .first<PromotionalBannerRow>();
}

export async function deletePromotionalBanner(
  db: D1Database,
  publicId: string,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM promotional_banners WHERE public_id = ?')
    .bind(publicId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// --- Storefront FAQs CRUD ---

export async function listStorefrontFaqs(
  db: D1Database,
  onlyActive = false,
): Promise<StorefrontFaqRow[]> {
  try {
    const sql = onlyActive
      ? 'SELECT * FROM storefront_faqs WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
      : 'SELECT * FROM storefront_faqs ORDER BY sort_order ASC, id ASC';
    const { results } = await db.prepare(sql).all<StorefrontFaqRow>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function createStorefrontFaq(
  db: D1Database,
  input: ValidatedStorefrontFaqInput,
): Promise<StorefrontFaqRow> {
  return withPublicId('storeFaq', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO storefront_faqs (public_id, question, answer, category, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        publicId,
        input.question,
        input.answer,
        input.category,
        input.sortOrder,
        input.isActive ? 1 : 0,
      )
      .first<StorefrontFaqRow>();
    if (!row) throw new Error('Failed to create FAQ');
    return row;
  });
}

export async function updateStorefrontFaq(
  db: D1Database,
  publicId: string,
  input: ValidatedStorefrontFaqInput,
): Promise<StorefrontFaqRow | null> {
  return db
    .prepare(
      `UPDATE storefront_faqs
          SET question = ?,
              answer = ?,
              category = ?,
              sort_order = ?,
              is_active = ?,
              updated_at = datetime('now')
        WHERE public_id = ?
        RETURNING *`,
    )
    .bind(
      input.question,
      input.answer,
      input.category,
      input.sortOrder,
      input.isActive ? 1 : 0,
      publicId,
    )
    .first<StorefrontFaqRow>();
}

export async function deleteStorefrontFaq(db: D1Database, publicId: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM storefront_faqs WHERE public_id = ?')
    .bind(publicId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// --- Customer Reviews Moderation ---

export async function listApprovedProductReviews(
  db: D1Database,
  limit = 6,
): Promise<ProductReviewRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT r.*, p.name AS product_name, p.slug AS product_slug
           FROM product_reviews r
           LEFT JOIN products p ON p.id = r.product_id
          WHERE r.is_approved = 1
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ?`,
      )
      .bind(limit)
      .all<ProductReviewRow>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function listAllProductReviewsForAdmin(
  db: D1Database,
  limit = 50,
): Promise<ProductReviewRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT r.*, p.name AS product_name, p.slug AS product_slug
           FROM product_reviews r
           LEFT JOIN products p ON p.id = r.product_id
          ORDER BY r.is_approved ASC, r.created_at DESC, r.id DESC
          LIMIT ?`,
      )
      .bind(limit)
      .all<ProductReviewRow>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function createProductReview(
  db: D1Database,
  input: {
    productId?: number | null;
    orderId?: number | null;
    customerId?: number | null;
    customerName: string;
    rating: number;
    comment: string;
    isApproved?: boolean;
  },
): Promise<ProductReviewRow> {
  const rating = Math.max(1, Math.min(5, Math.trunc(input.rating)));
  return withPublicId('productReview', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO product_reviews (
           public_id, product_id, order_id, customer_id, customer_name, rating, comment, is_approved
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        publicId,
        input.productId ?? null,
        input.orderId ?? null,
        input.customerId ?? null,
        input.customerName.trim().slice(0, 80),
        rating,
        input.comment.trim().slice(0, 1000),
        input.isApproved ? 1 : 0,
      )
      .first<ProductReviewRow>();
    if (!row) throw new Error('Failed to create product review');
    return row;
  });
}

export async function setProductReviewApproval(
  db: D1Database,
  publicId: string,
  isApproved: boolean,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE product_reviews
          SET is_approved = ?, updated_at = datetime('now')
        WHERE public_id = ?`,
    )
    .bind(isApproved ? 1 : 0, publicId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function deleteProductReview(db: D1Database, publicId: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM product_reviews WHERE public_id = ?')
    .bind(publicId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// --- Footer Configuration in settings ---

export async function getFooterConfig(db: D1Database): Promise<FooterConfig> {
  try {
    const row = await db
      .prepare("SELECT value FROM settings WHERE key = 'footer_config_json'")
      .first<{ value: string }>();
    if (!row?.value) return { ...DEFAULT_FOOTER_CONFIG };
    const parsed = JSON.parse(row.value) as Partial<FooterConfig>;
    return {
      description: parsed.description || DEFAULT_FOOTER_CONFIG.description,
      supportHours: parsed.supportHours || DEFAULT_FOOTER_CONFIG.supportHours,
      supportEmail: parsed.supportEmail || DEFAULT_FOOTER_CONFIG.supportEmail,
      supportPhone: parsed.supportPhone || DEFAULT_FOOTER_CONFIG.supportPhone,
      telegramUrl: parsed.telegramUrl ?? DEFAULT_FOOTER_CONFIG.telegramUrl,
      instagramUrl: parsed.instagramUrl ?? DEFAULT_FOOTER_CONFIG.instagramUrl,
      copyrightText: parsed.copyrightText || DEFAULT_FOOTER_CONFIG.copyrightText,
      trustNote: parsed.trustNote || DEFAULT_FOOTER_CONFIG.trustNote,
    };
  } catch {
    return { ...DEFAULT_FOOTER_CONFIG };
  }
}

export async function saveFooterConfig(
  db: D1Database,
  config: FooterConfig,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('footer_config_json', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(JSON.stringify(config))
    .run();
}

// --- Dynamic Product Queries for Homepage Sections ---

/**
 * Loads genuinely popular active products ranked by real paid `order_items`
 * quantity in D1, with deterministic fallback to featured / newest active
 * products when fewer products have settled order rows.
 * Never fabricates sales numbers.
 */
export async function listPopularStoreProducts(
  db: D1Database,
  limit: number,
): Promise<Product[]> {
  if (limit <= 0) return [];
  const { results } = await db
    .prepare(
      `SELECT p.*,
              COALESCE(sales.total_qty, 0) AS sold_qty
         FROM products p
         LEFT JOIN (
           SELECT oi.product_id,
                  SUM(oi.quantity) AS total_qty
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE o.status IN ('paid', 'completed', 'DELIVERED', 'PARTIALLY_DELIVERED', 'IN_PROGRESS', 'PAID')
              AND oi.product_id IS NOT NULL
            GROUP BY oi.product_id
         ) sales ON sales.product_id = p.id
        WHERE p.active = 1
          AND p.public_id IS NOT NULL
        ORDER BY sold_qty DESC, p.is_featured DESC, p.display_order ASC, p.created_at DESC, p.id DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<Product>();
  return results ?? [];
}

/**
 * Loads active products for a thematic section (AI, Gaming, Gift Cards) by
 * matching either the assigned category slug tree OR curated brand/name keywords.
 */
export async function listThematicStoreProducts(
  db: D1Database,
  options: {
    categorySlug: string | null;
    keywords: string[];
    limit: number;
  },
): Promise<Product[]> {
  if (options.limit <= 0) return [];

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.categorySlug) {
    clauses.push(
      `EXISTS (
        WITH RECURSIVE sub(id) AS (
          SELECT id FROM categories WHERE slug = ?
          UNION ALL
          SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
        )
        SELECT 1 FROM product_categories pc
        WHERE pc.product_id = p.id AND pc.category_id IN (SELECT id FROM sub)
      )`,
    );
    params.push(options.categorySlug);
  }

  for (const kw of options.keywords.slice(0, 14)) {
    const clean = kw.trim();
    if (!clean) continue;
    const pat = `%${clean}%`;
    clauses.push(
      `(p.name LIKE ? COLLATE NOCASE OR COALESCE(p.brand, '') LIKE ? COLLATE NOCASE OR COALESCE(p.short_description, '') LIKE ? COLLATE NOCASE)`,
    );
    params.push(pat, pat, pat);
  }

  if (clauses.length === 0) return [];

  const sql = `
    SELECT p.*
      FROM products p
     WHERE p.active = 1
       AND p.public_id IS NOT NULL
       AND (${clauses.join(' OR ')})
     ORDER BY p.is_featured DESC, p.display_order ASC, p.created_at DESC, p.id DESC
     LIMIT ?
  `;
  const { results } = await db
    .prepare(sql)
    .bind(...params, options.limit)
    .all<Product>();
  return results ?? [];
}

/**
 * Loads variant count & minimum variant price summary for a batch of product IDs
 * so product cards can display variant availability cleanly.
 */
export async function loadVariantSummariesForProducts(
  db: D1Database,
  productIds: number[],
): Promise<Map<number, { count: number; minPriceCents: number | null; sampleLabels: string[] }>> {
  const uniqueIds = [...new Set(productIds.filter(Number.isInteger))];
  const map = new Map<number, { count: number; minPriceCents: number | null; sampleLabels: string[] }>();
  if (uniqueIds.length === 0) return map;

  const placeholders = uniqueIds.map(() => '?').join(',');
  try {
    const { results } = await db
      .prepare(
        `SELECT product_id, label, price_cents
           FROM product_variants
          WHERE product_id IN (${placeholders})
          ORDER BY product_id ASC, position ASC, id ASC`,
      )
      .bind(...uniqueIds)
      .all<{ product_id: number; label: string; price_cents: number }>();

    for (const row of results ?? []) {
      const entry = map.get(row.product_id) ?? {
        count: 0,
        minPriceCents: null,
        sampleLabels: [],
      };
      entry.count += 1;
      if (entry.minPriceCents === null || row.price_cents < entry.minPriceCents) {
        entry.minPriceCents = row.price_cents;
      }
      if (entry.sampleLabels.length < 3) {
        entry.sampleLabels.push(row.label);
      }
      map.set(row.product_id, entry);
    }
  } catch {
    // Graceful if variants table is absent in minimal test fixtures
  }
  return map;
}

const CARD_SIZES = '(min-width: 1024px) 280px, calc(50vw - 24px)';
const BANNER_SIZES = '(min-width: 1024px) 640px, 100vw';

function parseSectionConfigJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function loadHomepageData(
  db: D1Database,
  options: {
    imageBaseUrl: string;
    delivery?: ImageDelivery;
    currency: string;
    nowMs?: number;
  },
): Promise<HomepageDataModel> {
  const nowMs = options.nowMs ?? Date.now();
  const sections = await listHomepageSections(db);
  const activeSections = sections.filter(
    (s) => s.is_enabled === 1 && isWithinScheduleWindow(s.start_at, s.end_at, nowMs),
  );

  const byKey = new Map<HomepageSectionKey, HomepageSectionRow>();
  for (const s of activeSections) {
    byKey.set(s.section_key, s);
  }

  const announcementSection = byKey.get('announcement') ?? null;
  const heroSection = byKey.get('hero') ?? null;

  const heroConfig = parseSectionConfigJson(heroSection?.config_json);
  const heroHighlights = Array.isArray(heroConfig.highlights)
    ? heroConfig.highlights.filter((x): x is string => typeof x === 'string')
    : [
        'تحویل توسط تیم گرگیفت+',
        'پرداخت امن ریالی و کیف پول',
        'بدون دریافت رمز عبور حساس',
        'پیگیری شفاف وضعیت سفارش',
      ];

  const heroDesktopImage = heroSection?.desktop_image_key
    ? buildStorefrontImage(heroSection.desktop_image_key, heroSection.title, {
        baseUrl: options.imageBaseUrl,
        delivery: options.delivery,
        sizes: '(min-width: 1024px) 560px, 100vw',
        priority: true,
      })
    : null;

  const heroMobileImage = heroSection?.mobile_image_key
    ? buildStorefrontImage(heroSection.mobile_image_key, heroSection.title, {
        baseUrl: options.imageBaseUrl,
        delivery: options.delivery,
        sizes: '100vw',
        priority: true,
      })
    : null;

  // Categories with active product counts
  const categoriesLimit = byKey.get('categories')?.max_items ?? 8;
  let categories: HomepageCategoryItem[] = [];
  if (byKey.has('categories')) {
    try {
      const { results: catRows } = await db
        .prepare(
          `SELECT c.id, c.public_id, c.name, c.slug, c.description, c.image_key, c.icon_key, c.accent_color,
                  COUNT(DISTINCT CASE WHEN p.active = 1 THEN p.id END) AS product_count
             FROM categories c
             LEFT JOIN product_categories pc ON pc.category_id = c.id
             LEFT JOIN products p ON p.id = pc.product_id
            WHERE c.parent_id IS NULL AND COALESCE(c.is_featured, 1) = 1
            GROUP BY c.id
            ORDER BY COALESCE(c.display_order, 0) ASC, c.name ASC
            LIMIT ?`,
        )
        .bind(categoriesLimit)
        .all<{
          id: number;
          public_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          image_key: string | null;
          icon_key: string | null;
          accent_color: string | null;
          product_count: number;
        }>();

      categories = (catRows ?? []).map((c) => ({
        id: c.id,
        publicId: c.public_id,
        name: c.name,
        slug: c.slug,
        href: `/categories/${c.slug}`,
        description: c.description ?? null,
        iconKey: c.icon_key ?? null,
        accentColor: c.accent_color ?? null,
        image: c.image_key
          ? buildStorefrontImage(c.image_key, c.name, {
              baseUrl: options.imageBaseUrl,
              delivery: options.delivery,
              sizes: '160px',
            })
          : null,
        productCount: Number(c.product_count ?? 0),
      }));
    } catch {
      categories = [];
    }
  }

  // Featured Products
  let featuredRows: Product[] = [];
  if (byKey.has('featured_products')) {
    const limit = byKey.get('featured_products')?.max_items ?? 8;
    const { results } = await db
      .prepare(
        `SELECT * FROM products
          WHERE active = 1 AND public_id IS NOT NULL
          ORDER BY is_featured DESC, display_order ASC, created_at DESC, id DESC
          LIMIT ?`,
      )
      .bind(limit)
      .all<Product>();
    featuredRows = results ?? [];
  }

  // Popular Products
  let popularRows: Product[] = [];
  if (byKey.has('popular_products')) {
    const limit = byKey.get('popular_products')?.max_items ?? 8;
    popularRows = await listPopularStoreProducts(db, limit);
  }

  // AI Products
  let aiRows: Product[] = [];
  if (byKey.has('ai_products')) {
    const sec = byKey.get('ai_products')!;
    const cfg = parseSectionConfigJson(sec.config_json);
    const keywords = Array.isArray(cfg.keywords)
      ? cfg.keywords.filter((x): x is string => typeof x === 'string')
      : ['chatgpt', 'openai', 'claude', 'gemini', 'هوش مصنوعی', 'چت‌جی‌پی‌تی', 'کلود'];
    aiRows = await listThematicStoreProducts(db, {
      categorySlug: sec.category_filter_slug || 'ai-subscriptions',
      keywords,
      limit: sec.max_items || 4,
    });
  }

  // Gaming Products
  let gamingRows: Product[] = [];
  if (byKey.has('gaming_products')) {
    const sec = byKey.get('gaming_products')!;
    const cfg = parseSectionConfigJson(sec.config_json);
    const keywords = Array.isArray(cfg.keywords)
      ? cfg.keywords.filter((x): x is string => typeof x === 'string')
      : ['pubg', 'free fire', 'call of duty', 'uc', 'cp', 'پابجی', 'فری فایر', 'کالاف', 'یوسی', 'جم', 'بازی'];
    gamingRows = await listThematicStoreProducts(db, {
      categorySlug: sec.category_filter_slug || 'game-topup',
      keywords,
      limit: sec.max_items || 4,
    });
  }

  // Gift Cards
  let giftCardRows: Product[] = [];
  if (byKey.has('gift_cards')) {
    const sec = byKey.get('gift_cards')!;
    const cfg = parseSectionConfigJson(sec.config_json);
    const keywords = Array.isArray(cfg.keywords)
      ? cfg.keywords.filter((x): x is string => typeof x === 'string')
      : ['gift', 'apple', 'itunes', 'google play', 'steam', 'playstation', 'xbox', 'amazon', 'گیفت', 'اپل', 'گوگل', 'استیم', 'پلی‌استیشن'];
    giftCardRows = await listThematicStoreProducts(db, {
      categorySlug: sec.category_filter_slug || 'gift-cards',
      keywords,
      limit: sec.max_items || 4,
    });
  }

  // Collect all product IDs to enrich variant summaries in a single D1 query
  const allProductRows = [
    ...featuredRows,
    ...popularRows,
    ...aiRows,
    ...gamingRows,
    ...giftCardRows,
  ];
  const variantMap = await loadVariantSummariesForProducts(
    db,
    allProductRows.map((p) => p.id),
  );

  const toCard = (p: Product, priority = false): ProductCardModel => {
    const card = buildProductCard(p, {
      baseUrl: options.imageBaseUrl,
      delivery: options.delivery,
      currency: options.currency,
      sizes: CARD_SIZES,
      priority,
    });
    const vInfo = variantMap.get(p.id);
    if (vInfo && vInfo.count > 0) {
      return {
        ...card,
        variantCount: vInfo.count,
        variantSummary:
          vInfo.sampleLabels.length > 0
            ? vInfo.sampleLabels.slice(0, 2).join(' · ')
            : `${vInfo.count} گزینه`,
      };
    }
    return card;
  };

  const featuredProducts = featuredRows.map((p, idx) => toCard(p, idx === 0));
  const popularProducts = popularRows.map((p) => toCard(p, false));
  const aiProducts = aiRows.map((p) => toCard(p, false));
  const gamingProducts = gamingRows.map((p) => toCard(p, false));
  const giftCardProducts = giftCardRows.map((p) => toCard(p, false));

  // Promotional Banners (active & within schedule window)
  let promotionalBanners: PromotionalBannerModel[] = [];
  if (byKey.has('promotional_banners')) {
    const limit = byKey.get('promotional_banners')?.max_items ?? 4;
    const allBanners = await listPromotionalBanners(db);
    promotionalBanners = allBanners
      .filter((b) => b.is_active === 1 && isWithinScheduleWindow(b.start_at, b.end_at, nowMs))
      .slice(0, limit)
      .map((b) => ({
        publicId: b.public_id,
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        badgeText: b.badge_text,
        ctaText: b.cta_text || 'مشاهده پیشنهاد',
        ctaHref: b.cta_href,
        altText: b.alt_text || b.title,
        accentTheme: b.accent_theme,
        desktopImage: b.desktop_image_key
          ? buildStorefrontImage(b.desktop_image_key, b.alt_text || b.title, {
              baseUrl: options.imageBaseUrl,
              delivery: options.delivery,
              sizes: BANNER_SIZES,
            })
          : null,
        mobileImage: b.mobile_image_key
          ? buildStorefrontImage(b.mobile_image_key, b.alt_text || b.title, {
              baseUrl: options.imageBaseUrl,
              delivery: options.delivery,
              sizes: '100vw',
            })
          : null,
      }));
  }

  // Service Benefits
  let serviceBenefits: ServiceBenefitItem[] = DEFAULT_SERVICE_BENEFITS;
  if (byKey.has('service_benefits')) {
    const cfg = parseSectionConfigJson(byKey.get('service_benefits')?.config_json);
    if (Array.isArray(cfg.items) && cfg.items.length > 0) {
      serviceBenefits = cfg.items as ServiceBenefitItem[];
    }
  }

  // Testimonials (Real Approved Reviews ONLY — never fake reviews)
  let approvedReviews: ProductReviewRow[] = [];
  let hideTestimonialsWhenEmpty = true;
  let testimonialsEmptyMessage = 'دیدگاه‌های مشتریان پس از ثبت و تایید نمایش داده می‌شوند.';
  if (byKey.has('testimonials')) {
    const sec = byKey.get('testimonials')!;
    const cfg = parseSectionConfigJson(sec.config_json);
    if (typeof cfg.hideWhenEmpty === 'boolean') {
      hideTestimonialsWhenEmpty = cfg.hideWhenEmpty;
    }
    if (typeof cfg.emptyMessage === 'string' && cfg.emptyMessage.trim()) {
      testimonialsEmptyMessage = cfg.emptyMessage.trim();
    }
    approvedReviews = await listApprovedProductReviews(db, sec.max_items || 6);
  }

  // FAQs
  let faqs: StorefrontFaqRow[] = [];
  if (byKey.has('faq')) {
    const limit = byKey.get('faq')?.max_items ?? 8;
    const allFaqs = await listStorefrontFaqs(db, true);
    faqs = allFaqs.slice(0, limit);
  }

  const footerConfig = await getFooterConfig(db);

  const referencedProductPublicIds = [
    ...new Set(
      allProductRows
        .map((p) => p.public_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  return {
    sections,
    activeSections,
    announcementSection,
    heroSection,
    heroDesktopImage,
    heroMobileImage,
    heroHighlights,
    categories,
    featuredProducts,
    popularProducts,
    aiProducts,
    gamingProducts,
    giftCardProducts,
    promotionalBanners,
    serviceBenefits,
    approvedReviews,
    hideTestimonialsWhenEmpty,
    testimonialsEmptyMessage,
    faqs,
    footerConfig,
    referencedProductPublicIds,
  };
}
