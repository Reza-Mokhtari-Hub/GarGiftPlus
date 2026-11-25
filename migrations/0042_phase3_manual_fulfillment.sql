-- GarGift+ Phase 3: Manual Order Fulfillment Workspace, Per-Item Deliveries,
-- Delivery Revisions, Private R2 Delivery Attachments, Order Status History,
-- and Delivery Notification Events.
-- Strictly additive & remote-safe (no DROP, no nested END in triggers).

-- 1. Additive fulfillment columns on orders
ALTER TABLE orders ADD COLUMN assigned_admin TEXT;
ALTER TABLE orders ADD COLUMN internal_notes TEXT;
ALTER TABLE orders ADD COLUMN processing_started_at TEXT;
ALTER TABLE orders ADD COLUMN ready_for_delivery_at TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_created
  ON orders(fulfillment_status, created_at DESC, id DESC);

-- 2. Additive per-item fulfillment columns on order_items
ALTER TABLE order_items ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled';
ALTER TABLE order_items ADD COLUMN fulfilled_at TEXT;
ALTER TABLE order_items ADD COLUMN fulfilled_by TEXT;

CREATE INDEX IF NOT EXISTS idx_order_items_order_fulfillment
  ON order_items(order_id, fulfillment_status, id);

-- 3. Per-Item Delivery Record (supports draft & published states)
CREATE TABLE IF NOT EXISTS order_item_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
    'draft',
    'ready_for_delivery',
    'published',
    'cancelled'
  )),
  current_version INTEGER NOT NULL DEFAULT 0,
  draft_sections_json TEXT,
  published_sections_json TEXT,
  published_payload_hash TEXT,
  customer_note TEXT,
  admin_note TEXT,
  assigned_admin TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  last_notified_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_deliveries_order
  ON order_item_deliveries(order_id, status);
CREATE INDEX IF NOT EXISTS idx_item_deliveries_published_at
  ON order_item_deliveries(status, published_at DESC, id DESC);

-- 4. Immutable Delivery Revisions (created on initial publish and every published edit)
CREATE TABLE IF NOT EXISTS delivery_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  delivery_id INTEGER NOT NULL REFERENCES order_item_deliveries(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  sections_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  customer_note TEXT,
  change_reason TEXT,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(delivery_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_delivery_versions_delivery
  ON delivery_versions(delivery_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_versions_order
  ON delivery_versions(order_id, published_at DESC);

-- 5. Private Delivery Attachments stored in private R2 (`env.FILES`)
CREATE TABLE IF NOT EXISTS delivery_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  delivery_id INTEGER NOT NULL REFERENCES order_item_deliveries(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  version_number INTEGER,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK(is_published IN (0, 1)),
  removed_at TEXT,
  file_name TEXT NOT NULL,
  r2_object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  sha256_hex TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_attachments_delivery
  ON delivery_attachments(delivery_id, is_published, removed_at);
CREATE INDEX IF NOT EXISTS idx_delivery_attachments_order
  ON delivery_attachments(order_id, order_item_id);

-- 6. Order & Item Status History (for customer timeline and admin audit)
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER,
  status_type TEXT NOT NULL CHECK(status_type IN ('payment', 'fulfillment', 'item_fulfillment')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  is_customer_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_customer_visible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order
  ON order_status_history(order_id, created_at ASC, id ASC);

-- 7. Delivery Notification Events (idempotent tracking of customer delivery notifications)
CREATE TABLE IF NOT EXISTS delivery_notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER,
  delivery_id INTEGER,
  version_number INTEGER,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'order_accepted',
    'processing_started',
    'ready_for_delivery',
    'partial_delivery',
    'delivery_published',
    'order_fulfilled'
  )),
  channel TEXT NOT NULL DEFAULT 'email',
  outbox_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_notif_order
  ON delivery_notification_events(order_id, created_at DESC, id DESC);
