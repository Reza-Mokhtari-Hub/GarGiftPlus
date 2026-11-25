-- GarGift+ Phase 4: Dynamic Homepage Sections, Promotional Banners, Storefront FAQs,
-- Customer Product Reviews (moderated), and Category Presentation Metadata.
-- Strictly additive & idempotent. Does not alter existing product/category row counts.

-- 1. Category visual & presentation columns
ALTER TABLE categories ADD COLUMN description TEXT;
ALTER TABLE categories ADD COLUMN image_key TEXT;
ALTER TABLE categories ADD COLUMN icon_key TEXT;
ALTER TABLE categories ADD COLUMN accent_color TEXT;
ALTER TABLE categories ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_categories_featured_order
  ON categories(is_featured, display_order, name);

-- 2. Dynamic Homepage Sections configuration table
-- Strictly allowlisted section keys; no arbitrary HTML/JS/CSS execution.
CREATE TABLE IF NOT EXISTS homepage_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  section_key TEXT NOT NULL UNIQUE CHECK(
    section_key IN (
      'announcement',
      'hero',
      'categories',
      'featured_products',
      'popular_products',
      'ai_products',
      'gaming_products',
      'gift_cards',
      'promotional_banners',
      'service_benefits',
      'testimonials',
      'faq',
      'final_cta'
    )
  ),
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  badge_text TEXT,
  cta_text TEXT,
  cta_href TEXT,
  secondary_cta_text TEXT,
  secondary_cta_href TEXT,
  desktop_image_key TEXT,
  mobile_image_key TEXT,
  category_filter_slug TEXT,
  max_items INTEGER NOT NULL DEFAULT 8,
  config_json TEXT NOT NULL DEFAULT '{}',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  start_at TEXT,
  end_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_homepage_sections_order
  ON homepage_sections(is_enabled, sort_order, id);

-- 3. Promotional Banners table with desktop/mobile image keys & date scheduling
CREATE TABLE IF NOT EXISTS promotional_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  badge_text TEXT,
  cta_text TEXT,
  cta_href TEXT NOT NULL,
  desktop_image_key TEXT,
  mobile_image_key TEXT,
  alt_text TEXT NOT NULL DEFAULT '',
  accent_theme TEXT NOT NULL DEFAULT 'violet' CHECK(
    accent_theme IN ('violet', 'turquoise', 'coral', 'amber', 'navy')
  ),
  start_at TEXT,
  end_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_promotional_banners_active_order
  ON promotional_banners(is_active, sort_order, id);

-- 4. Storefront FAQs table
CREATE TABLE IF NOT EXISTS storefront_faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_storefront_faqs_active_order
  ON storefront_faqs(is_active, sort_order, id);

-- 5. Moderated Customer Product Reviews table
-- Zero fake reviews are seeded. Only real approved customer reviews (is_approved = 1) render.
CREATE TABLE IF NOT EXISTS product_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  product_id INTEGER,
  order_id INTEGER,
  customer_id INTEGER,
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  is_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_approved
  ON product_reviews(is_approved, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product
  ON product_reviews(product_id, is_approved, created_at DESC);

-- 6. Seed default 13 homepage sections
INSERT OR IGNORE INTO homepage_sections (
  public_id, section_key, title, subtitle, description, badge_text,
  cta_text, cta_href, secondary_cta_text, secondary_cta_href,
  category_filter_slug, max_items, config_json, is_enabled, sort_order
) VALUES
  (
    'hsec_01annc0001',
    'announcement',
    'تحویل تخصصی گیفت‌کارت، اشتراک هوش مصنوعی و شارژ بازی با پشتیبانی تیم گرگیفت+',
    'پرداخت امن ریالی و پیگیری لحظه‌ای وضعیت سفارش',
    NULL,
    'ویژه',
    'مشاهده محصولات',
    '/products',
    NULL,
    NULL,
    NULL,
    1,
    '{"style":"brand"}',
    1,
    10
  ),
  (
    'hsec_02hero0002',
    'hero',
    'دنیای دیجیتال، یک قدم نزدیک‌تر',
    'خرید گیفت‌کارت‌های اورجینال، اشتراک‌های هوش مصنوعی و شارژ بازی‌ها با پرداخت امن ریالی',
    'در گرگیفت+ به مجموعه‌ای کامل از گیفت‌کارت‌های بین‌المللی، اشتراک‌های ChatGPT، کلود و جمینای، و شارژ بازی‌های محبوب دسترسی دارید؛ با تحویل تخصصی توسط تیم گرگیفت+ و پنل کاربری شفاف.',
    'پلتفرم تخصصی محصولات دیجیتال GarGift+',
    'مشاهده محصولات',
    '/products',
    'ورود به حساب کاربری',
    '/account',
    NULL,
    4,
    '{"highlights":["تحویل توسط تیم گرگیفت+","پرداخت امن ریالی و کیف پول","بدون دریافت رمز عبور حساس","پیگیری شفاف وضعیت سفارش"]}',
    1,
    20
  ),
  (
    'hsec_03cats0003',
    'categories',
    'دسته‌بندی‌های اصلی گرگیفت+',
    'دسترسی سریع به سرویس‌ها، گیفت‌کارت‌ها، اشتراک‌های هوش مصنوعی و شارژ بازی‌ها',
    NULL,
    'دسته‌بندی‌ها',
    'مشاهده همه محصولات',
    '/products',
    NULL,
    NULL,
    NULL,
    8,
    '{}',
    1,
    30
  ),
  (
    'hsec_04feat0004',
    'featured_products',
    'محصولات ویژه و منتخب',
    'محصولات دیجیتال برگزیده با تنوع ریجن و پلن‌های متنوع',
    NULL,
    'منتخب گرگیفت+',
    'مشاهده همه محصولات ویژه',
    '/products?featured=1',
    NULL,
    NULL,
    NULL,
    8,
    '{}',
    1,
    40
  ),
  (
    'hsec_05popu0005',
    'popular_products',
    'پرفروش‌ترین و محبوب‌ترین محصولات',
    'محبوب‌ترین سرویس‌ها بر اساس سفارش‌های واقعی ثبت‌شده در گرگیفت+',
    NULL,
    'محبوب‌ترین‌ها',
    'مشاهده کاتالوگ کامل',
    '/products?sort=newest&dir=desc',
    NULL,
    NULL,
    NULL,
    8,
    '{}',
    1,
    50
  ),
  (
    'hsec_06aipr0006',
    'ai_products',
    'اشتراک‌های هوش مصنوعی',
    'دسترسی به جدیدترین مدل‌های ChatGPT Plus، Claude Pro، Gemini Advanced و ابزارهای هوش مصنوعی',
    'فعالسازی قانونی و مطمئن اشتراک‌های هوش مصنوعی روی ایمیل شما یا اکانت اختصاصی بدون نیاز به کارت ارزی.',
    'هوش مصنوعی (AI)',
    'مشاهده اشتراک‌های هوش مصنوعی',
    '/categories/ai-subscriptions',
    NULL,
    NULL,
    'ai-subscriptions',
    4,
    '{"keywords":["chatgpt","openai","claude","gemini","perplexity","midjourney","cursor","copilot","هوش مصنوعی","چت‌جی‌پی‌تی","کلود","جمینای"]}',
    1,
    60
  ),
  (
    'hsec_07game0007',
    'gaming_products',
    'شارژ بازی‌ها و آیتم‌های گیمینگ',
    'یوسی پابجی موبایل، جم فری‌فایر، سی‌پی کالاف دیوتی موبایل و اعتبار استیم و پلی‌استیشن',
    'انجام سفارش‌های گیمینگ با آیدی بازیکن (UID) بدون نیاز به اطلاعات ورود حساس و با ثبت تاریخچه کامل تحویل.',
    'گیمینگ و شارژ بازی',
    'مشاهده محصولات گیمینگ',
    '/categories/game-topup',
    NULL,
    NULL,
    'game-topup',
    4,
    '{"keywords":["pubg","free fire","call of duty","cod","uc","cp","roblox","valorant","fortnite","پابجی","فری فایر","کالاف","یوسی","جم","بازی"]}',
    1,
    70
  ),
  (
    'hsec_08gift0008',
    'gift_cards',
    'گیفت‌کارت‌های اورجینال بین‌المللی',
    'گیفت‌کارت اپل، گوگل‌پلی، استیم، پلی‌استیشن، ایکس‌باکس، آمازون و اسپاتیفای',
    'دریافت کد دیجیتال و فایل پیوست تحویل در پنل کاربری و صفحه اختصاصی پیگیری سفارش پس از تکمیل توسط تیم گرگیفت+.',
    'گیفت‌کارت‌ها',
    'مشاهده همه گیفت‌کارت‌ها',
    '/categories/gift-cards',
    NULL,
    NULL,
    'gift-cards',
    4,
    '{"keywords":["gift card","apple","itunes","google play","steam","playstation","psn","xbox","amazon","spotify","nintendo","گیفت","اپل","گوگل","استیم","پلی‌استیشن"]}',
    1,
    80
  ),
  (
    'hsec_09bnrs0009',
    'promotional_banners',
    'پیشنهادها و کمپین‌های ویژه',
    'بسته‌های منتخب اشتراک هوش مصنوعی، گیفت‌کارت و شارژ بازی‌ها',
    NULL,
    'پیشنهاد ویژه',
    'مشاهده پیشنهادها',
    '/products?discounted=1',
    NULL,
    NULL,
    NULL,
    4,
    '{}',
    1,
    90
  ),
  (
    'hsec_10bnft0010',
    'service_benefits',
    'چرا خرید از گرگیفت+؟',
    'فرآیند شفاف، پرداخت امن و تحویل تخصصی برای هر سفارش دیجیتال',
    NULL,
    'مزایای خدمات',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    5,
    '{"items":[{"icon":"support","title":"پشتیبانی مشتریان","description":"همراهی تیم پشتیبانی گرگیفت+ در تمام مراحل ثبت و تکمیل سفارش."},{"icon":"shield","title":"پرداخت امن ریالی و کیف پول","description":"امکان پرداخت از طریق درگاه بانکی، کیف پول کاربری یا واریز کارت‌به‌کارت با ثبت رسید."},{"icon":"delivery","title":"تحویل توسط تیم گرگیفت+","description":"بررسی و انجام دقیق هر ردیف سفارش توسط اپراتورهای مجاز به همراه ثبت کد و فایل پیوست."},{"icon":"tracking","title":"پیگیری شفاف سفارش","description":"مشاهده وضعیت لحظه‌ای هر آیتم سفارش، تایم‌لاین رویدادها و اعلان ایمیلی."},{"icon":"history","title":"دسترسی دائمی به سوابق خرید","description":"آرشیو کامل کدهای تحویلی، فایل‌های پیوست و تراکنش‌های مالی در حساب کاربری شما."}]}',
    1,
    100
  ),
  (
    'hsec_11test0011',
    'testimonials',
    'دیدگاه و تجربه خریداران',
    'نظرات ثبت‌شده و تاییدشده مشتریان واقعی گرگیفت+',
    'تمامی دیدگاه‌های این بخش مربوط به سفارش‌های واقعی ثبت‌شده توسط کاربران است.',
    'نظرات مشتریان',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    6,
    '{"hideWhenEmpty":true,"emptyMessage":"دیدگاه‌های مشتریان پس از ثبت و تایید نمایش داده می‌شوند."}',
    1,
    110
  ),
  (
    'hsec_12faqs0012',
    'faq',
    'پرسش‌های متداول',
    'پاسخ به سوالات رایج درباره نحوه ثبت سفارش، پرداخت، کیف پول و تحویل محصولات در گرگیفت+',
    NULL,
    'راهنمای خرید',
    'مشاهده همه محصولات',
    '/products',
    NULL,
    NULL,
    NULL,
    8,
    '{}',
    1,
    120
  ),
  (
    'hsec_13fcta0013',
    'final_cta',
    'محصول موردنظرت رو پیدا کن',
    'همین حالا از میان گیفت‌کارت‌های اورجینال، اشتراک‌های هوش مصنوعی و شارژ بازی‌ها، محصول دلخواهت رو با پرداخت امن انتخاب کن.',
    NULL,
    'شروع خرید از GarGift+',
    'همین حالا محصولات گرگیفت رو ببین',
    '/products',
    'ورود / حساب کاربری',
    '/account',
    NULL,
    1,
    '{}',
    1,
    130
  );

-- 7. Seed default Promotional Banners
INSERT OR IGNORE INTO promotional_banners (
  public_id, title, subtitle, description, badge_text,
  cta_text, cta_href, alt_text, accent_theme, sort_order, is_active
) VALUES
  (
    'bnr_01aisub001',
    'اشتراک‌های هوش مصنوعی نسل جدید',
    'ChatGPT Plus · Claude Pro · Gemini Advanced',
    'فعالسازی اشتراک‌های هوش مصنوعی روی ایمیل شخصی شما با پشتیبانی و راهنمای کامل استفاده در گرگیفت+.',
    'پیشنهاد ویژه AI',
    'مشاهده اشتراک‌های هوش مصنوعی',
    '/products?q=ChatGPT',
    'بنر اشتراک‌های هوش مصنوعی گرگیفت+',
    'violet',
    10,
    1
  ),
  (
    'bnr_02gcard002',
    'گیفت‌کارت و شارژ بازی‌های موبایل و کنسول',
    'Apple · Steam · PlayStation · PUBG Mobile',
    'خرید گیفت‌کارت‌های بین‌المللی و شارژ سریع بازی‌ها با آیدی بازیکن و دسترسی دائمی به کد تحویلی در حساب کاربری.',
    'گیمینگ و گیفت‌کارت',
    'مشاهده گیفت‌کارت‌ها و بازی‌ها',
    '/products',
    'بنر گیفت‌کارت و شارژ بازی گرگیفت+',
    'turquoise',
    20,
    1
  );

-- 8. Seed default factual Storefront FAQs
INSERT OR IGNORE INTO storefront_faqs (
  public_id, question, answer, category, sort_order, is_active
) VALUES
  (
    'faq_01dlvr0001',
    'نحوه تحویل سفارش‌ها در گرگیفت+ چگونه است؟',
    'تمامی سفارش‌های پرداخت‌شده در گرگیفت+ توسط تیم تخصصی تحویل بررسی و انجام می‌شوند. بسته به نوع محصول (کد گیفت‌کارت، فعال‌سازی اشتراک هوش مصنوعی یا شارژ بازی با UID)، اطلاعات تحویل و فایل‌های پیوست در بخش «سفارش‌های من» و صفحه پیگیری سفارش ثبت شده و از طریق ایمیل نیز اطلاع‌رسانی می‌گردد.',
    'delivery',
    10,
    1
  ),
  (
    'faq_02paym0002',
    'چه روش‌های پرداختی در گرگیفت+ وجود دارد؟',
    'شما می‌توانید هزینه سفارش خود را از طریق درگاه‌های پرداخت آنلاین شتابی (زرین‌پال و زیبال)، موجودی کیف پول کاربری گرگیفت+، یا واریز بانکی کارت‌به‌کارت (همراه با بارگذاری تصویر فیش واریزی برای تایید اپراتور) پرداخت نمایید.',
    'payment',
    20,
    1
  ),
  (
    'faq_03secu0003',
    'آیا برای خرید اشتراک یا شارژ بازی نیاز به رمز عبور اکانت شخصی من است؟',
    'خیر؛ در گرگیفت+ دریافت فیلد رمز عبور (Password) به‌طور کامل مسدود است. برای انجام سفارش‌ها تنها اطلاعات غیرحساس مانند آیدی بازیکن (Player ID / UID)، ایمیل اکانت یا ریجن مورد نظر دریافت می‌شود.',
    'security',
    30,
    1
  ),
  (
    'faq_04trck0004',
    'چگونه می‌توانم وضعیت سفارش و کدهای تحویلی خود را مشاهده کنم؟',
    'کافی است وارد حساب کاربری خود در گرگیفت+ شوید و به بخش «سفارش‌های من» مراجعه کنید. همچنین برای هر سفارش یک لینک اختصاصی و امن پیگیری سفارش ایجاد می‌شود که تایم‌لاین کامل وضعیت و جزئیات تحویل هر آیتم را نمایش می‌دهد.',
    'tracking',
    40,
    1
  ),
  (
    'faq_05wall0005',
    'کیف پول گرگیفت+ چه کاربردی دارد؟',
    'با استفاده از کیف پول گرگیفت+ می‌توانید حساب خود را شارژ کرده و سفارش‌های بعدی را بدون نیاز به درگاه بانکی تسویه کنید. همچنین در صورت لغو سفارش یا استرداد وجه، مبلغ مربوطه با ثبت سند شفاف در تاریخچه تراکنش‌ها به کیف پول شما بازگردانده می‌شود.',
    'wallet',
    50,
    1
  );
