-- GarGift+ Phase 1: Digital Product Catalog, Variant Metadata,
-- Product Custom Checkout Fields, Cart Line Inputs, and Immutable Order Inputs Snapshot.
-- Additive & remote-safe only (never drops existing tables/columns or uses triggers with nested END).

-- 1. Digital product catalog fields
ALTER TABLE products ADD COLUMN short_description TEXT;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN region TEXT;
ALTER TABLE products ADD COLUMN badge TEXT;
ALTER TABLE products ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN faq_json TEXT;
ALTER TABLE products ADD COLUMN instructions TEXT;
ALTER TABLE products ADD COLUMN seo_title TEXT;
ALTER TABLE products ADD COLUMN seo_description TEXT;
ALTER TABLE products ADD COLUMN compare_price_cents INTEGER;
ALTER TABLE products ADD COLUMN estimated_delivery TEXT;

CREATE INDEX IF NOT EXISTS idx_products_catalog_order
  ON products(active, is_featured, display_order, created_at, id);

-- 2. Digital variant metadata fields
ALTER TABLE product_variants ADD COLUMN region TEXT;
ALTER TABLE product_variants ADD COLUMN amount_label TEXT;
ALTER TABLE product_variants ADD COLUMN duration_label TEXT;
ALTER TABLE product_variants ADD COLUMN compare_price_cents INTEGER;

-- 3. Dynamic custom checkout fields per product
-- Security: only allowlisted non-credential types ('text','email','number','select','textarea').
-- 'password' is strictly disallowed at DB constraint, parser, API, and UI layers.
CREATE TABLE IF NOT EXISTS product_checkout_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE,
  product_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK(field_type IN ('text', 'email', 'number', 'select', 'textarea')),
  placeholder TEXT,
  help_text TEXT,
  options_json TEXT,
  is_required INTEGER NOT NULL DEFAULT 1,
  min_length INTEGER,
  max_length INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_pcf_product_sort
  ON product_checkout_fields(product_id, sort_order, id);

-- 4. Durable per-cart-line customer inputs tied to an httpOnly session cookie (never URL query strings)
CREATE TABLE IF NOT EXISTS cart_line_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  cart_session TEXT NOT NULL,
  product_public_id TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cart_line_inputs_session
  ON cart_line_inputs(cart_session, product_public_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_cart_line_inputs_expires
  ON cart_line_inputs(expires_at);

-- 5. Immutable snapshot of validated customer inputs on settled order line items
ALTER TABLE order_items ADD COLUMN customer_inputs_json TEXT;
