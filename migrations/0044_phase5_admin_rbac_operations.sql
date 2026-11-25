-- GarGift+ Phase 5: Admin RBAC Users, Support Tickets, Email Templates,
-- Category Active/SEO Fields, Customer Status/Notes, and Structured Audit Logs.
-- Strictly additive & idempotent. Does not alter or drop existing records.

-- 1. Categories: active toggle & SEO metadata
ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN seo_title TEXT;
ALTER TABLE categories ADD COLUMN seo_description TEXT;

CREATE INDEX IF NOT EXISTS idx_categories_active_order
  ON categories(is_active, display_order, name);

-- 2. Customers: account status, admin notes, and verified marker
ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE customers ADD COLUMN admin_notes TEXT;
ALTER TABLE customers ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_customers_status_created
  ON customers(status, created_at DESC, id DESC);

-- 3. Admin Users & RBAC Roles (additive alongside primary admin_password_hash & CF Access)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(
    role IN (
      'super_admin',
      'operations_manager',
      'fulfillment_manager',
      'fulfillment_operator',
      'finance_manager',
      'product_manager',
      'content_manager',
      'support_viewer',
      'none'
    )
  ),
  custom_permissions_json TEXT,
  password_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_users_active_role
  ON admin_users(is_active, role, id);

-- 4. Structured Audit Log columns (module & outcome)
ALTER TABLE admin_audit_logs ADD COLUMN module TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN result TEXT NOT NULL DEFAULT 'success';

CREATE INDEX IF NOT EXISTS idx_audit_logs_module_created
  ON admin_audit_logs(module, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON admin_audit_logs(actor, created_at DESC, id DESC);

-- 5. Support Tickets & Conversation Replies (customer <-> admin)
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  customer_email TEXT NOT NULL,
  order_public_id TEXT,
  subject TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'support' CHECK(
    department IN ('support', 'fulfillment', 'finance', 'technical')
  ),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(
    priority IN ('low', 'normal', 'high', 'urgent')
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK(
    status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')
  ),
  assigned_admin TEXT,
  last_reply_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_reply
  ON support_tickets(status, last_reply_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer
  ON support_tickets(customer_email, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  ticket_id INTEGER NOT NULL,
  author_type TEXT NOT NULL CHECK(author_type IN ('customer', 'admin')),
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket
  ON support_ticket_replies(ticket_id, created_at ASC, id ASC);

-- 6. Persian Email Templates (persisted safe structured copy)
CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  heading TEXT NOT NULL,
  intro TEXT NOT NULL,
  cta_label TEXT NOT NULL,
  footer_note TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO email_templates (
  event_key, title, subject, heading, intro, cta_label, footer_note, is_active
) VALUES
  (
    'order_confirmed',
    'تایید ثبت و پرداخت سفارش',
    'تایید سفارش #{orderRef} در {storeName}',
    'سفارش شما با موفقیت ثبت شد',
    'از خرید شما در {storeName} سپاسگزاریم. سفارش شما در صف پردازش قرار گرفته و پس از آماده‌سازی توسط تیم تحویل، اطلاع‌رسانی خواهد شد.',
    'مشاهده و پیگیری سفارش',
    'برای پیگیری وضعیت سفارش در هر زمان می‌توانید از دکمه بالا یا پنل حساب کاربری خود استفاده کنید.',
    1
  ),
  (
    'fulfillment_ready',
    'اعلان تکمیل و آماده بودن تحویل سفارش',
    'سفارش #{orderRef} آماده تحویل است — {storeName}',
    'اطلاعات سفارش شما آماده است',
    'سفارش شما توسط تیم تحویل {storeName} پردازش و تکمیل شد. به منظور حفظ امنیت، کدها و فایل‌های پیوست فقط از طریق صفحه امن سفارش قابل مشاهده هستند.',
    'مشاهده اطلاعات تحویل',
    'هرگز اطلاعات محرمانه خود را در اختیار دیگران قرار ندهید.',
    1
  ),
  (
    'wallet_topup',
    'تایید شارژ کیف پول کاربری',
    'شارژ کیف پول به مبلغ {amount} تایید شد — {storeName}',
    'کیف پول شما شارژ شد',
    'مبلغ {amount} با موفقیت به کیف پول شما در {storeName} افزوده شد و هم‌اکنون قابل استفاده در خریدهای شما است.',
    'مشاهده کیف پول',
    'تاریخچه کامل تراکنش‌های کیف پول در حساب کاربری شما در دسترس است.',
    1
  ),
  (
    'login_link',
    'لینک ورود به حساب کاربری',
    'لینک ورود یک‌بارمصرف به {storeName}',
    'ورود امن به حساب کاربری',
    'برای ورود به حساب کاربری خود در {storeName} روی دکمه زیر کلیک کنید. این لینک تا ۱۵ دقیقه معتبر است و فقط یک‌بار قابل استفاده خواهد بود.',
    'ورود به حساب کاربری',
    'اگر شما این درخواست را ثبت نکرده‌اید، این ایمیل را نادیده بگیرید.',
    1
  );
