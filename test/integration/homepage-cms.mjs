import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import {
  createProductReview,
  createPromotionalBanner,
  createStorefrontFaq,
  deleteProductReview,
  deletePromotionalBanner,
  deleteStorefrontFaq,
  getFooterConfig,
  listAllProductReviewsForAdmin,
  listHomepageSections,
  listPopularStoreProducts,
  listPromotionalBanners,
  listStorefrontFaqs,
  loadHomepageData,
  reorderAndToggleHomepageSections,
  saveFooterConfig,
  setProductReviewApproval,
  updateHomepageSection,
  updatePromotionalBanner,
  updateStorefrontFaq,
} from '../../src/features/homepage/db.ts';
import {
  parseFooterConfigInput,
  parseHomepageSectionInput,
  parsePromotionalBannerInput,
  parseStorefrontFaqInput,
} from '../../src/features/homepage/schema.ts';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
  }
};

try {
  const db = await mf.getD1Database('DB');

  // Create core schema + apply 0043_phase4_homepage_cms.sql
  for (const sql of [
    `CREATE TABLE settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE categories (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       name TEXT NOT NULL,
       slug TEXT NOT NULL UNIQUE,
       parent_id INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE products (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       name TEXT NOT NULL,
       slug TEXT NOT NULL UNIQUE,
       description TEXT,
       short_description TEXT,
       brand TEXT,
       region TEXT,
       badge TEXT,
       price_cents INTEGER NOT NULL DEFAULT 0,
       compare_price_cents INTEGER,
       currency TEXT NOT NULL DEFAULT 'IRT',
       image_key TEXT,
       stock INTEGER NOT NULL DEFAULT 0,
       active INTEGER NOT NULL DEFAULT 1,
       variant_label TEXT,
       weight_grams INTEGER,
       requires_shipping INTEGER NOT NULL DEFAULT 0,
       is_featured INTEGER NOT NULL DEFAULT 0,
       display_order INTEGER NOT NULL DEFAULT 0,
       estimated_delivery TEXT,
       file_key TEXT,
       file_name TEXT,
       file_mime TEXT,
       file_size_bytes INTEGER,
       related_ids TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE product_categories (
       product_id INTEGER NOT NULL,
       category_id INTEGER NOT NULL,
       PRIMARY KEY (product_id, category_id)
     )`,
    `CREATE TABLE product_variants (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       product_id INTEGER NOT NULL,
       label TEXT NOT NULL,
       price_cents INTEGER NOT NULL DEFAULT 0,
       position INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE orders (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       status TEXT NOT NULL DEFAULT 'paid',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE order_items (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       order_id INTEGER NOT NULL,
       product_id INTEGER,
       quantity INTEGER NOT NULL DEFAULT 1,
       price_cents INTEGER NOT NULL DEFAULT 0
     )`,
  ]) {
    await db.prepare(sql).run();
  }

  const migration0043 = readFileSync('migrations/0043_phase4_homepage_cms.sql', 'utf8');
  for (const rawStmt of migration0043.split(/;\s*\n/)) {
    const stmt = rawStmt.replace(/--.*$/gm, '').trim();
    if (!stmt) continue;
    await db.prepare(stmt).run();
  }

  console.log('\nGarGift+ Phase 4 — Homepage CMS & Dynamic Storefront D1 Integration');

  await check('seeds all 13 default homepage sections in deterministic sort order', async () => {
    const sections = await listHomepageSections(db);
    assert.equal(sections.length, 13);
    assert.equal(sections[0].section_key, 'announcement');
    assert.equal(sections[1].section_key, 'hero');
    assert.equal(sections[1].title, 'دنیای دیجیتال، یک قدم نزدیک‌تر');
    assert.equal(sections[12].section_key, 'final_cta');
  });

  await check('reorders and disables homepage sections and reflects in loadHomepageData', async () => {
    await reorderAndToggleHomepageSections(db, [
      { sectionKey: 'faq', sortOrder: 5, isEnabled: true },
      { sectionKey: 'final_cta', sortOrder: 130, isEnabled: false },
    ]);

    const data = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
    });

    assert.equal(data.activeSections[0].section_key, 'faq');
    assert.equal(
      data.activeSections.some((s) => s.section_key === 'final_cta'),
      false,
      'disabled section should not appear in activeSections',
    );

    // Restore default order
    await reorderAndToggleHomepageSections(db, [
      { sectionKey: 'faq', sortOrder: 120, isEnabled: true },
      { sectionKey: 'final_cta', sortOrder: 130, isEnabled: true },
    ]);
  });

  await check('updates Hero section desktop/mobile images and schedule window', async () => {
    const parsed = parseHomepageSectionInput({
      section_key: 'hero',
      title: 'دنیای دیجیتال، یک قدم نزدیک‌تر',
      subtitle: 'گیفت‌کارت، هوش مصنوعی و گیمینگ',
      description: 'خرید امن با تحویل تخصصی توسط تیم گرگیفت+',
      badge_text: 'GarGift+',
      cta_text: 'مشاهده محصولات',
      cta_href: '/products',
      secondary_cta_text: 'ورود به حساب کاربری',
      secondary_cta_href: '/account',
      desktop_image_key: 'media/hero-desktop-test.webp',
      mobile_image_key: 'media/hero-mobile-test.webp',
      max_items: 4,
      sort_order: 20,
      is_enabled: true,
    });
    assert.equal(parsed.ok, true);
    await updateHomepageSection(db, parsed.data);

    const data = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
    });
    assert.equal(data.heroDesktopImage?.src, '/images/media/hero-desktop-test.webp');
    assert.equal(data.heroMobileImage?.src, '/images/media/hero-mobile-test.webp');
  });

  await check('creates, schedules, updates, and deletes Promotional Banners', async () => {
    const activeInput = parsePromotionalBannerInput({
      title: 'کمپین تابستانی گیمینگ',
      subtitle: 'PUBG · Call of Duty · Steam',
      description: 'تخفیف ویژه شارژ بازی‌ها',
      badge_text: 'ویژه گیمرها',
      cta_text: 'خرید بسته بازی',
      cta_href: '/categories/game-topup',
      desktop_image_key: 'media/banner-desk.webp',
      mobile_image_key: 'media/banner-mob.webp',
      accent_theme: 'coral',
      start_at: '2026-01-01T00:00:00Z',
      end_at: '2026-12-31T23:59:59Z',
      sort_order: 5,
      is_active: true,
    });
    assert.equal(activeInput.ok, true);
    const createdActive = await createPromotionalBanner(db, activeInput.data);
    assert.ok(createdActive.public_id.startsWith('bnr_'));

    // Create an expired banner that must NOT appear on homepage at 2026-06-01
    const expiredInput = parsePromotionalBannerInput({
      title: 'کمپین منقضی‌شده',
      cta_href: '/products',
      start_at: '2025-01-01T00:00:00Z',
      end_at: '2025-02-01T00:00:00Z',
      sort_order: 1,
      is_active: true,
    });
    assert.equal(expiredInput.ok, true);
    const createdExpired = await createPromotionalBanner(db, expiredInput.data);

    const nowMs = Date.parse('2026-06-01T12:00:00Z');
    const data = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
      nowMs,
    });

    assert.equal(
      data.promotionalBanners.some((b) => b.publicId === createdActive.public_id),
      true,
      'active scheduled banner should appear',
    );
    assert.equal(
      data.promotionalBanners.some((b) => b.publicId === createdExpired.public_id),
      false,
      'expired banner must not appear',
    );

    const activeModel = data.promotionalBanners.find(
      (b) => b.publicId === createdActive.public_id,
    );
    assert.equal(activeModel?.desktopImage?.src, '/images/media/banner-desk.webp');
    assert.equal(activeModel?.mobileImage?.src, '/images/media/banner-mob.webp');

    // Update and delete
    const updated = await updatePromotionalBanner(db, createdActive.public_id, {
      ...activeInput.data,
      isActive: false,
    });
    assert.equal(updated?.is_active, 0);

    await deletePromotionalBanner(db, createdActive.public_id);
    await deletePromotionalBanner(db, createdExpired.public_id);
    const allRemaining = await listPromotionalBanners(db);
    assert.equal(
      allRemaining.some((b) => b.public_id === createdActive.public_id),
      false,
    );
  });

  await check('ranks popular products by real paid order_items and enriches thematic sections + variants', async () => {
    await db
      .prepare(
        `INSERT INTO categories (id, public_id, name, slug, description, display_order, is_featured)
         VALUES
           (1, 'cat_gift000001', 'گیفت‌کارت‌ها', 'gift-cards', 'گیفت‌کارت‌های بین‌المللی', 10, 1),
           (2, 'cat_aisub00002', 'اشتراک هوش مصنوعی', 'ai-subscriptions', 'اشتراک‌های AI', 20, 1),
           (3, 'cat_game000003', 'شارژ بازی‌ها', 'game-topup', 'یوسی و سی‌پی', 30, 1)`,
      )
      .run();

    await db
      .prepare(
        `INSERT INTO products (id, public_id, name, slug, brand, region, price_cents, compare_price_cents, currency, active, is_featured, display_order)
         VALUES
           (10, 'prod_apple00010', 'گیفت کارت اپل ۱۰ دلاری', 'apple-10', 'Apple', 'US', 680000, 720000, 'IRT', 1, 1, 10),
           (11, 'prod_gpt0000011', 'اشتراک ChatGPT Plus', 'chatgpt-plus', 'OpenAI', 'Global', 1250000, NULL, 'IRT', 1, 1, 20),
           (12, 'prod_pubg000012', 'بسته ۶۶۰ یوسی پابجی موبایل', 'pubg-660-uc', 'PUBG Mobile', 'Global', 640000, NULL, 'IRT', 1, 0, 30)`,
      )
      .run();

    await db
      .prepare(
        `INSERT INTO product_categories (product_id, category_id) VALUES (10, 1), (11, 2), (12, 3)`,
      )
      .run();

    await db
      .prepare(
        `INSERT INTO product_variants (public_id, product_id, label, price_cents, position)
         VALUES
           ('var_apple10usd', 10, '۱۰ دلاری آمریکا', 680000, 0),
           ('var_apple25usd', 10, '۲۵ دلاری آمریکا', 1680000, 1)`,
      )
      .run();

    // Paid order gives product 12 (PUBG UC) 5 sold units, making it #1 in popularProducts
    await db
      .prepare(`INSERT INTO orders (id, public_id, status) VALUES (100, 'ord_paid000100', 'paid')`)
      .run();
    await db
      .prepare(
        `INSERT INTO order_items (public_id, order_id, product_id, quantity, price_cents)
         VALUES ('itm_0000000100', 100, 12, 5, 640000)`,
      )
      .run();

    // Cancelled order for product 10 must be ignored
    await db
      .prepare(
        `INSERT INTO orders (id, public_id, status) VALUES (101, 'ord_canc000101', 'CANCELLED')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO order_items (public_id, order_id, product_id, quantity, price_cents)
         VALUES ('itm_0000000101', 101, 10, 99, 680000)`,
      )
      .run();

    const popular = await listPopularStoreProducts(db, 3);
    assert.equal(popular[0].slug, 'pubg-660-uc', 'highest real paid quantity should rank first');

    const data = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
    });

    assert.equal(data.categories.length, 3);
    assert.equal(data.aiProducts.some((p) => p.id === 'prod_gpt0000011'), true);
    assert.equal(data.gamingProducts.some((p) => p.id === 'prod_pubg000012'), true);
    assert.equal(data.giftCardProducts.some((p) => p.id === 'prod_apple00010'), true);

    const appleCard = data.giftCardProducts.find((p) => p.id === 'prod_apple00010');
    assert.equal(appleCard?.variantCount, 2);
    assert.equal(appleCard?.variantSummary, '۱۰ دلاری آمریکا · ۲۵ دلاری آمریکا');
  });

  await check('moderates customer reviews strictly: zero fake reviews, only approved reviews appear', async () => {
    const initialData = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
    });
    assert.equal(initialData.approvedReviews.length, 0);
    assert.equal(initialData.hideTestimonialsWhenEmpty, true);

    const pendingRev = await createProductReview(db, {
      productId: 11,
      customerName: 'امیررضا محمدی',
      rating: 5,
      comment: 'اشتراک ChatGPT Plus در کمتر از ۳۰ دقیقه توسط تیم گرگیفت تحویل شد.',
      isApproved: false,
    });

    const dataWhilePending = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
    });
    assert.equal(
      dataWhilePending.approvedReviews.length,
      0,
      'unapproved review must never leak to storefront',
    );

    await setProductReviewApproval(db, pendingRev.public_id, true);
    const dataAfterApproval = await loadHomepageData(db, {
      imageBaseUrl: '',
      currency: 'IRT',
    });
    assert.equal(dataAfterApproval.approvedReviews.length, 1);
    assert.equal(dataAfterApproval.approvedReviews[0].customer_name, 'امیررضا محمدی');

    const adminList = await listAllProductReviewsForAdmin(db);
    assert.equal(adminList.length, 1);

    await deleteProductReview(db, pendingRev.public_id);
    const afterDelete = await listAllProductReviewsForAdmin(db);
    assert.equal(afterDelete.length, 0);
  });

  await check('manages Storefront FAQs and Footer Configuration in D1', async () => {
    const faqParsed = parseStorefrontFaqInput({
      question: 'آیا امکان پرداخت با کیف پول وجود دارد؟',
      answer: 'بله، می‌توانید کیف پول خود را شارژ کرده و آنی خرید کنید.',
      category: 'wallet',
      sort_order: 60,
      is_active: true,
    });
    assert.equal(faqParsed.ok, true);
    const createdFaq = await createStorefrontFaq(db, faqParsed.data);
    assert.ok(createdFaq.public_id.startsWith('faq_'));

    const updatedFaq = await updateStorefrontFaq(db, createdFaq.public_id, {
      ...faqParsed.data,
      isActive: false,
    });
    assert.equal(updatedFaq?.is_active, 0);

    const activeFaqs = await listStorefrontFaqs(db, true);
    assert.equal(
      activeFaqs.some((f) => f.public_id === createdFaq.public_id),
      false,
      'inactive FAQ should not appear in active list',
    );

    await deleteStorefrontFaq(db, createdFaq.public_id);

    const footerParsed = parseFooterConfigInput({
      description: 'توضیحات اختصاصی فوتر گرگیفت+',
      supportHours: '۸ صبح تا ۱۲ شب',
      supportEmail: 'help@gargift.ir',
      supportPhone: '۰۲۱-۸۸۰۰۰۰۰۰',
      copyrightText: 'کپی‌رایت گرگیفت+',
      trustNote: 'تحویل تخصصی سفارش‌ها',
    });
    assert.equal(footerParsed.ok, true);
    await saveFooterConfig(db, footerParsed.data);

    const loadedFooter = await getFooterConfig(db);
    assert.equal(loadedFooter.supportEmail, 'help@gargift.ir');
    assert.equal(loadedFooter.supportHours, '۸ صبح تا ۱۲ شب');
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} homepage CMS check(s) failed`);
  process.exit(1);
}
console.log('\nhomepage CMS & dynamic storefront: all checks passed');
