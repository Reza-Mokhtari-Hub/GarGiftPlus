-- GarGift+ Phase 2: Customers, Persistent Wallets, Wallet Ledger & Topups,
-- Iranian Bank Accounts, Payment Transactions State Machine,
-- Bank Transfer Receipts (Private R2), and Admin Financial Audit Logs.
-- Strictly additive & remote-safe.

-- 1. Customers table (unified identity backed by verified magic-link email)
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- 2. Persistent Customer Wallets (integer Toman by default; balance >= 0 enforced)
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  currency TEXT NOT NULL DEFAULT 'irt',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wallets_customer ON wallets(customer_id);

-- 3. Append-only Wallet Ledger (idempotency_key prevents double credit/debit)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  wallet_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'TOPUP_GATEWAY',
    'TOPUP_BANK',
    'ORDER_DEBIT',
    'REFUND_CREDIT',
    'ADMIN_CREDIT',
    'ADMIN_DEBIT'
  )),
  amount INTEGER NOT NULL CHECK(amount != 0),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  currency TEXT NOT NULL DEFAULT 'irt',
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reason TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet_created
  ON wallet_transactions(wallet_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_customer_created
  ON wallet_transactions(customer_id, created_at DESC, id DESC);

-- 4. Wallet Top-up Requests (settled once via Zarinpal, Zibal, or Bank Transfer)
CREATE TABLE IF NOT EXISTS wallet_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  wallet_id INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'irt',
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending',
    'payment_review',
    'completed',
    'failed',
    'cancelled',
    'expired'
  )),
  payment_tx_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_customer_created
  ON wallet_topups(customer_id, created_at DESC, id DESC);

-- 5. Destination Bank Accounts for Card-to-Card / Bank Transfer
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  card_number TEXT NOT NULL,
  iban TEXT,
  account_number TEXT,
  instructions TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_active_sort
  ON bank_accounts(is_active, sort_order, id);

-- 6. Persistent Payment Transactions State Machine
CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL CHECK(target_type IN ('order', 'wallet_topup')),
  target_public_id TEXT NOT NULL,
  customer_id INTEGER,
  customer_email TEXT,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'irt',
  gateway_amount_rial INTEGER,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK(status IN (
    'CREATED',
    'INITIATED',
    'PAYMENT_REVIEW',
    'VERIFIED',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
  )),
  authority_or_track_id TEXT,
  ref_id TEXT,
  card_pan TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  failure_reason TEXT,
  payload_json TEXT,
  initiated_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_target
  ON payment_transactions(target_type, target_public_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_authority
  ON payment_transactions(method, authority_or_track_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_customer
  ON payment_transactions(customer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payment_tx_status_created
  ON payment_transactions(status, created_at DESC);

-- 7. Bank Transfer Receipts stored in private R2 (`env.FILES`)
CREATE TABLE IF NOT EXISTS bank_transfer_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  payment_tx_id INTEGER NOT NULL,
  bank_account_id INTEGER,
  customer_id INTEGER,
  customer_email TEXT,
  target_type TEXT NOT NULL CHECK(target_type IN ('order', 'wallet_topup')),
  target_public_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'irt',
  tracking_code TEXT,
  r2_object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN (
    'pending_review',
    'approved',
    'rejected'
  )),
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_receipts_status_created
  ON bank_transfer_receipts(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_tx
  ON bank_transfer_receipts(payment_tx_id);
CREATE INDEX IF NOT EXISTS idx_receipts_customer
  ON bank_transfer_receipts(customer_id, created_at DESC);

-- 8. Admin Financial Audit Log
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON admin_audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON admin_audit_logs(target_type, target_id);

-- 9. Additive columns on orders (keeps existing orders untouched)
ALTER TABLE orders ADD COLUMN customer_id INTEGER;
ALTER TABLE orders ADD COLUMN payment_status TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
