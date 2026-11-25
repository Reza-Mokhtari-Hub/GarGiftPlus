import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import {
  authorizeAndLoadCustomerAttachment,
  getCustomerOrderDeliveryView,
  getFulfillmentDashboardStats,
  listDeliveryAttachmentsForOrder,
  listDeliveryNotificationEvents,
  listDeliveryVersionsForOrder,
  listFulfillmentQueueOrders,
  listOrderStatusHistory,
  publishOrderItemDelivery,
  removeOrderItemDeliveryAttachment,
  saveOrderItemDeliveryDraft,
  updateOrderFulfillmentMetadata,
  uploadOrderItemDeliveryAttachment,
} from '../../src/features/fulfillment/db.ts';
import {
  getPermissionsForRole,
} from '../../src/features/fulfillment/permissions.ts';
import { claimOrderIdentity } from '../../src/features/orders/guestAccess.ts';

/**
 * In-memory StorageProvider simulating Cloudflare R2 private bucket (`env.FILES`)
 */
class MemoryPrivateStorage {
  objects = new Map();
  async put(key, body, contentType) {
    const bytes =
      body instanceof Uint8Array
        ? body
        : body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { bytes, contentType });
  }
  async get(key) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(entry.bytes);
        controller.close();
      },
    });
    return {
      body: stream,
      contentType: entry.contentType,
      size: entry.bytes.byteLength,
      etag: '"mem-etag"',
    };
  }
  async delete(key) {
    this.objects.delete(key);
  }
}

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});

try {
  const db = await mf.getD1Database('DB');
  const storage = new MemoryPrivateStorage();

  // Bootstrap D1 tables matching production + Phase 3 migration 0042
  for (const sql of [
    `CREATE TABLE customers (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       email TEXT NOT NULL UNIQUE,
       full_name TEXT,
       phone TEXT,
       status TEXT NOT NULL DEFAULT 'active',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE orders (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       customer_id INTEGER,
       stripe_session_id TEXT NOT NULL UNIQUE,
       provider_session_id TEXT,
       provider_payment_id TEXT,
       payment_method TEXT,
       status TEXT NOT NULL DEFAULT 'paid',
       amount_total_cents INTEGER NOT NULL,
       currency TEXT NOT NULL DEFAULT 'IRR',
       shipping_cents INTEGER NOT NULL DEFAULT 0,
       shipping_label TEXT,
       shipping_weight_grams INTEGER,
       delivery_method TEXT,
       discount_cents INTEGER NOT NULL DEFAULT 0,
       promo_code TEXT,
       tax_cents INTEGER NOT NULL DEFAULT 0,
       refunded_cents INTEGER NOT NULL DEFAULT 0,
       refund_status TEXT,
       email TEXT,
       ship_address TEXT,
       fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
       tracking_carrier TEXT,
       tracking_number TEXT,
       label_url TEXT,
       fulfilled_at TEXT,
       assigned_admin TEXT,
       internal_notes TEXT,
       processing_started_at TEXT,
       ready_for_delivery_at TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE order_items (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT UNIQUE,
       order_id INTEGER NOT NULL,
       product_id INTEGER,
       variant_id INTEGER,
       name TEXT NOT NULL,
       quantity INTEGER NOT NULL,
       price_cents INTEGER NOT NULL,
       customer_inputs_json TEXT,
       fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
       fulfilled_at TEXT,
       fulfilled_by TEXT
     )`,
    `CREATE TABLE order_guest_access (
       order_public_id TEXT NOT NULL PRIMARY KEY,
       access_token TEXT NOT NULL UNIQUE,
       generation INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       rotated_at TEXT,
       hidden_at TEXT
     )`,
    `CREATE TABLE order_notifications (
       order_id INTEGER NOT NULL,
       kind TEXT NOT NULL,
       state TEXT NOT NULL DEFAULT 'pending',
       attempts INTEGER NOT NULL DEFAULT 0,
       lease_expires_at TEXT,
       last_error TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       sent_at TEXT,
       PRIMARY KEY (order_id, kind)
     )`,
    `CREATE TABLE payment_transactions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       kind TEXT NOT NULL DEFAULT 'order',
       target_type TEXT NOT NULL DEFAULT 'order',
       target_public_id TEXT NOT NULL,
       customer_id INTEGER,
       customer_email TEXT,
       method TEXT NOT NULL,
       provider TEXT,
       amount INTEGER NOT NULL,
       currency TEXT NOT NULL DEFAULT 'IRR',
       status TEXT NOT NULL DEFAULT 'INITIATED',
       authority TEXT,
       ref_id TEXT,
       failure_reason TEXT,
       payload_json TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now')),
       verified_at TEXT
     )`,
    `CREATE TABLE bank_transfer_receipts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       payment_tx_id INTEGER NOT NULL,
       status TEXT NOT NULL DEFAULT 'submitted',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE admin_audit_logs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       action TEXT NOT NULL,
       target_type TEXT NOT NULL,
       target_id TEXT NOT NULL,
       actor TEXT NOT NULL,
       reason TEXT,
       details_json TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE order_item_deliveries (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       order_id INTEGER NOT NULL,
       order_item_id INTEGER NOT NULL UNIQUE,
       status TEXT NOT NULL DEFAULT 'draft',
       current_version INTEGER NOT NULL DEFAULT 0,
       draft_sections_json TEXT,
       published_sections_json TEXT,
       published_payload_hash TEXT,
       customer_note TEXT,
       admin_note TEXT,
       assigned_admin TEXT,
       created_by TEXT NOT NULL DEFAULT 'admin',
       updated_by TEXT NOT NULL DEFAULT 'admin',
       published_by TEXT,
       published_at TEXT,
       last_notified_version INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE delivery_versions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       delivery_id INTEGER NOT NULL,
       order_id INTEGER NOT NULL,
       order_item_id INTEGER NOT NULL,
       version_number INTEGER NOT NULL,
       sections_json TEXT NOT NULL,
       payload_hash TEXT NOT NULL,
       customer_note TEXT,
       change_reason TEXT,
       published_by TEXT NOT NULL DEFAULT 'admin',
       published_at TEXT NOT NULL DEFAULT (datetime('now')),
       UNIQUE(delivery_id, version_number)
     )`,
    `CREATE TABLE delivery_attachments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       delivery_id INTEGER NOT NULL,
       order_id INTEGER NOT NULL,
       order_item_id INTEGER NOT NULL,
       version_number INTEGER,
       is_published INTEGER NOT NULL DEFAULT 0,
       removed_at TEXT,
       file_name TEXT NOT NULL,
       r2_object_key TEXT NOT NULL UNIQUE,
       mime_type TEXT NOT NULL,
       size_bytes INTEGER NOT NULL,
       sha256_hex TEXT,
       download_count INTEGER NOT NULL DEFAULT 0,
       uploaded_by TEXT NOT NULL DEFAULT 'admin',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE order_status_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       order_id INTEGER NOT NULL,
       order_item_id INTEGER,
       status_type TEXT NOT NULL DEFAULT 'fulfillment',
       from_status TEXT,
       to_status TEXT NOT NULL,
       actor TEXT NOT NULL DEFAULT 'system',
       note TEXT,
       is_customer_visible INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE delivery_notification_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_id TEXT NOT NULL UNIQUE,
       order_id INTEGER NOT NULL,
       order_item_id INTEGER,
       delivery_id INTEGER,
       version_number INTEGER,
       event_type TEXT NOT NULL,
       channel TEXT NOT NULL DEFAULT 'email',
       outbox_kind TEXT NOT NULL,
       idempotency_key TEXT NOT NULL UNIQUE,
       actor TEXT NOT NULL DEFAULT 'admin',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ]) {
    await db.exec(sql.replace(/\n\s*/g, ' '));
  }

  const superAdmin = {
    id: 'admin@gargift.ir',
    role: 'super_admin',
    permissions: getPermissionsForRole('super_admin'),
  };

  const supportViewer = {
    id: 'support@gargift.ir',
    role: 'support_viewer',
    permissions: getPermissionsForRole('support_viewer'),
  };

  const operatorOnly = {
    id: 'operator@gargift.ir',
    role: 'fulfillment_operator',
    permissions: getPermissionsForRole('fulfillment_operator'),
  };

  // =========================================================================
  // SCENARIO 1 & 2: Unpaid order & Bank Transfer receipt in PAYMENT_REVIEW
  // cannot be fulfilled or enter the active fulfillment queue
  // =========================================================================
  const reviewIdentity = await claimOrderIdentity(db);
  await db
    .prepare(
      `INSERT INTO orders (public_id, stripe_session_id, payment_method, status, amount_total_cents, email)
       VALUES (?, 'sess_review_1', 'bank_transfer', 'paid', 1500000, 'review@example.com')`,
    )
    .bind(reviewIdentity.publicId)
    .run();
  const reviewOrderRow = await db
    .prepare('SELECT * FROM orders WHERE public_id = ?')
    .bind(reviewIdentity.publicId)
    .first();
  await db
    .prepare(
      `INSERT INTO order_items (public_id, order_id, name, quantity, price_cents)
       VALUES ('oi_reviewitem1', ?, 'گیفت کارت گوگل پلی ۱۰ دلاری', 1, 1500000)`,
    )
    .bind(reviewOrderRow.id)
    .run();
  const reviewItemRow = await db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .bind(reviewOrderRow.id)
    .first();
  // Create a payment_transactions row in PENDING_VERIFICATION (receipt awaiting approval)
  await db
    .prepare(
      `INSERT INTO payment_transactions (public_id, target_type, target_public_id, method, amount, status)
       VALUES ('ptx_review1234', 'order', ?, 'bank_transfer', 1500000, 'PENDING_VERIFICATION')`,
    )
    .bind(reviewIdentity.publicId)
    .run();

  const attemptReviewFulfill = await saveOrderItemDeliveryDraft(db, {
    actor: superAdmin,
    orderId: reviewOrderRow.id,
    orderItemId: reviewItemRow.id,
    sections: [{ type: 'gift_card_code', title: 'کد', value: 'GP-1111-2222' }],
  });
  assert.equal(attemptReviewFulfill.ok, false, 'Order in PAYMENT_REVIEW must be rejected from fulfillment');

  // =========================================================================
  // SCENARIO 3: Paid multi-item order enters fulfillment queue
  // =========================================================================
  const paidIdentity = await claimOrderIdentity(db);
  await db
    .prepare(
      `INSERT INTO customers (public_id, email, full_name, phone)
       VALUES ('cus_buyer11111', 'buyer@example.com', 'سارا محمدی', '09121234567')`,
    )
    .run();
  const buyerCustomer = await db
    .prepare('SELECT * FROM customers WHERE email = ?')
    .bind('buyer@example.com')
    .first();

  await db
    .prepare(
      `INSERT INTO orders (public_id, customer_id, stripe_session_id, payment_method, status, amount_total_cents, email)
       VALUES (?, ?, 'sess_paid_1', 'wallet', 'paid', 4500000, 'buyer@example.com')`,
    )
    .bind(paidIdentity.publicId, buyerCustomer.id)
    .run();
  const paidOrder = await db
    .prepare('SELECT * FROM orders WHERE public_id = ?')
    .bind(paidIdentity.publicId)
    .first();

  // Add 2 items with immutable customer_inputs_json snapshots
  await db
    .prepare(
      `INSERT INTO order_items (public_id, order_id, name, quantity, price_cents, customer_inputs_json)
       VALUES
         ('oi_paiditem01', ?, 'گیفت کارت استیم ۲۰ دلاری', 1, 2000000, ?),
         ('oi_paiditem02', ?, 'اشتراک ChatGPT Plus یک‌ماهه', 1, 2500000, ?)`,
    )
    .bind(
      paidOrder.id,
      JSON.stringify([{ key: 'region', label: 'ریجن اکانت', type: 'select', value: 'US' }]),
      paidOrder.id,
      JSON.stringify([{ key: 'account_email', label: 'ایمیل اکانت', type: 'email', value: 'sara.ai@example.com' }]),
    )
    .run();

  const paidItems = (
    await db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC')
      .bind(paidOrder.id)
      .all()
  ).results;
  assert.equal(paidItems.length, 2);
  const [item1, item2] = paidItems;

  // Verify dashboard stats and queue listing include the paid order, NOT the review order
  const initialStats = await getFulfillmentDashboardStats(db);
  assert.equal(initialStats.unfulfilledCount, 1, 'Only verified PAID order is counted in unfulfilled queue');
  const queueRes = await listFulfillmentQueueOrders(db, { search: 'سارا' });
  assert.equal(queueRes.total, 1);
  assert.equal(queueRes.orders[0].public_id, paidIdentity.publicId);

  // =========================================================================
  // SCENARIO 4: Unauthorized admin (support_viewer) cannot save or publish delivery
  // =========================================================================
  const unauthorizedSave = await saveOrderItemDeliveryDraft(db, {
    actor: supportViewer,
    orderId: paidOrder.id,
    orderItemId: item1.id,
    sections: [{ type: 'gift_card_code', title: 'کد', value: 'STEAM-0000' }],
  });
  assert.equal(unauthorizedSave.ok, false);
  assert.equal(unauthorizedSave.status, 403);

  // =========================================================================
  // SCENARIO 5 & 6: Admin creates & edits draft delivery; customer CANNOT see draft
  // =========================================================================
  const draft1Res = await saveOrderItemDeliveryDraft(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
    sections: [
      {
        type: 'gift_card_code',
        title: 'کد گیفت کارت استیم (پیش‌نویس اول)',
        value: 'STEAM-DRAFT-1111-2222',
        copyable: true,
      },
    ],
    customerNote: 'پیام آزمایشی پیش‌نویس',
    adminNote: 'یادداشت محرمانه اپراتور — نباید به مشتری نمایش داده شود',
    assignedAdmin: 'اپراتور علی',
  });
  assert.equal(draft1Res.ok, true);

  // Edit draft before publishing
  const draft1EditRes = await saveOrderItemDeliveryDraft(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
    sections: [
      {
        type: 'gift_card_code',
        title: 'کد گیفت کارت ۲۰ دلاری استیم (آمریکا)',
        value: 'STEAM-FINAL-8888-9999',
        instructions: 'در بخش Activate a Product on Steam وارد شود.',
        copyable: true,
      },
      {
        type: 'activation_link',
        title: 'لینک فعال‌سازی استیم',
        url: 'https://store.steampowered.com/account/registerkey',
        linkLabel: 'ورود به استیم',
      },
    ],
    customerNote: 'کد شما آماده و تست شده است.',
    adminNote: 'خریداری‌شده از تامین‌کننده اصلی #771',
    markReadyForDelivery: true,
  });
  assert.equal(draft1EditRes.ok, true);

  // Check customer view while still in draft/ready_for_delivery (unpublished)
  const orderAfterDraft = await db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .bind(paidOrder.id)
    .first();
  const customerViewBeforePublish = await getCustomerOrderDeliveryView(db, orderAfterDraft);
  assert.equal(customerViewBeforePublish.items[0].isPublished, false);
  assert.equal(
    customerViewBeforePublish.items[0].sections.length,
    0,
    'Customer must NOT see unpublished draft sections',
  );
  assert.equal(
    customerViewBeforePublish.items[0].customerNote,
    null,
    'Customer must NOT see unpublished customerNote',
  );
  const serializedViewBefore = JSON.stringify(customerViewBeforePublish);
  assert.equal(
    serializedViewBefore.includes('STEAM-FINAL-8888-9999'),
    false,
    'Draft gift card code must never leak in customer view',
  );
  assert.equal(
    serializedViewBefore.includes('تامین‌کننده اصلی'),
    false,
    'Internal admin note must never leak in customer view',
  );

  // =========================================================================
  // SCENARIO 7: Upload private attachment & reject invalid file types
  // =========================================================================
  const badExeBytes = new TextEncoder().encode('MZ-fake-executable');
  const badUploadRes = await uploadOrderItemDeliveryAttachment(db, storage, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
    fileBytes: badExeBytes,
    fileName: 'trojan.exe',
    mimeType: 'application/octet-stream',
  });
  assert.equal(badUploadRes.ok, false, 'Executable upload must be rejected');

  const validPdfBytes = new TextEncoder().encode('%PDF-1.7\n%GarGift Activation Guide\n1 0 obj\n<<>>\nendobj\n');
  const pdfUploadRes = await uploadOrderItemDeliveryAttachment(db, storage, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
    fileBytes: validPdfBytes,
    fileName: 'steam-activation-guide.pdf',
    mimeType: 'application/pdf',
  });
  assert.equal(pdfUploadRes.ok, true);
  const attachmentPublicId = pdfUploadRes.attachment.public_id;

  // Customer cannot download unpublished attachment even with valid token
  const unpublishedDownloadAttempt = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    guestToken: paidIdentity.accessToken,
  });
  assert.equal(
    unpublishedDownloadAttempt.ok,
    false,
    'Customer must NOT be able to download unpublished draft attachment',
  );

  // =========================================================================
  // SCENARIO 8 & 9: Publish Item 1 -> Partial Fulfillment + Customer Visibility
  // =========================================================================
  const publishItem1Res = await publishOrderItemDelivery(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
  });
  assert.equal(publishItem1Res.ok, true);
  assert.equal(publishItem1Res.idempotent, false);
  assert.equal(publishItem1Res.versionNumber, 1);
  assert.equal(
    publishItem1Res.orderFulfillmentStatus,
    'partially_fulfilled',
    'Multi-item order with 1 of 2 items published must be partially_fulfilled',
  );

  // Verify customer now sees Item 1 published delivery + attachment, while Item 2 remains unpublished
  const orderAfterItem1 = await db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .bind(paidOrder.id)
    .first();
  const customerViewPartial = await getCustomerOrderDeliveryView(db, orderAfterItem1);
  assert.equal(customerViewPartial.fulfillmentStatus, 'partially_fulfilled');
  assert.equal(customerViewPartial.items[0].isPublished, true);
  assert.equal(customerViewPartial.items[0].sections.length, 2);
  assert.equal(customerViewPartial.items[0].sections[0].value, 'STEAM-FINAL-8888-9999');
  assert.equal(customerViewPartial.items[0].attachments.length, 1);
  assert.equal(customerViewPartial.items[1].isPublished, false);
  assert.equal(customerViewPartial.items[1].sections.length, 0);
  // Ensure adminNote still never leaks after publish
  assert.equal(
    JSON.stringify(customerViewPartial).includes('تامین‌کننده اصلی'),
    false,
    'Admin internal note must never leak after publish',
  );

  // =========================================================================
  // SCENARIO 10: Repeated publish click is idempotent (no duplicate version or notification)
  // =========================================================================
  const repeatPublishRes = await publishOrderItemDelivery(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
  });
  assert.equal(repeatPublishRes.ok, true);
  assert.equal(repeatPublishRes.idempotent, true, 'Identical publish must be idempotent');
  assert.equal(repeatPublishRes.versionNumber, 1);
  assert.equal(repeatPublishRes.queuedOutboxKinds.length, 0, 'No duplicate outbox notification queued');

  // =========================================================================
  // SCENARIO 11: Authorized Customer & Guest Token Download vs. IDOR / Cross-Customer Rejection
  // =========================================================================
  // 11a. Valid guest capability token download succeeds
  const guestDownloadOk = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    guestToken: paidIdentity.accessToken,
  });
  assert.equal(guestDownloadOk.ok, true, 'Guest with valid capability token can download published attachment');
  assert.equal(guestDownloadOk.attachment.file_name, 'steam-activation-guide.pdf');

  // 11b. Valid authenticated customer download succeeds
  const customerDownloadOk = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    orderPublicId: paidIdentity.publicId,
    authenticatedCustomer: {
      id: buyerCustomer.id,
      email: 'buyer@example.com',
    },
  });
  assert.equal(customerDownloadOk.ok, true, 'Order owner customer can download published attachment');

  // 11c. Invalid guest token is rejected
  const invalidTokenDownload = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    guestToken: 'otk_wrongtoken00000000000000',
  });
  assert.equal(invalidTokenDownload.ok, false);

  // 11d. Another authenticated customer (IDOR attempt) is rejected
  const crossCustomerDownload = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    orderPublicId: paidIdentity.publicId,
    authenticatedCustomer: {
      id: 99999,
      email: 'intruder@example.com',
    },
  });
  assert.equal(crossCustomerDownload.ok, false, 'Cross-customer attachment download must be blocked');

  // 11e. Mismatched orderPublicId is rejected
  const wrongOrderDownload = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    orderPublicId: reviewIdentity.publicId,
    authenticatedCustomer: {
      id: buyerCustomer.id,
      email: 'buyer@example.com',
    },
  });
  assert.equal(wrongOrderDownload.ok, false, 'Attachment download under wrong orderPublicId must be blocked');

  // =========================================================================
  // SCENARIO 12: Editing a published delivery requires `orders.edit_published_delivery`
  // and creates Version 2 with change_reason & audit log
  // =========================================================================
  const operatorEditPublishedAttempt = await publishOrderItemDelivery(db, {
    actor: operatorOnly, // lacks orders.edit_published_delivery
    orderId: paidOrder.id,
    orderItemId: item1.id,
    sections: [{ type: 'gift_card_code', title: 'کد جدید', value: 'STEAM-HACK-0000' }],
  });
  assert.equal(operatorEditPublishedAttempt.ok, false);
  assert.equal(operatorEditPublishedAttempt.status, 403);

  const managerEditPublished = await publishOrderItemDelivery(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item1.id,
    sections: [
      {
        type: 'gift_card_code',
        title: 'کد گیفت کارت ۲۰ دلاری استیم (نسخه اصلاح‌شده)',
        value: 'STEAM-V2-5555-7777',
        copyable: true,
      },
    ],
    customerNote: 'کد جایگزین نسخه ۲ برای شما ثبت شد.',
    changeReason: 'اصلاح کد به درخواست مشتری',
  });
  assert.equal(managerEditPublished.ok, true);
  assert.equal(managerEditPublished.versionNumber, 2);

  const versionsAfterV2 = await listDeliveryVersionsForOrder(db, paidOrder.id);
  assert.equal(versionsAfterV2.length, 2, 'Both version 1 and version 2 are preserved in delivery_versions');
  assert.equal(versionsAfterV2[0].version_number, 2);
  assert.equal(versionsAfterV2[0].change_reason, 'اصلاح کد به درخواست مشتری');

  // =========================================================================
  // SCENARIO 13: Publish Item 2 -> Full Order Fulfillment (`fulfilled`)
  // =========================================================================
  const publishItem2Res = await publishOrderItemDelivery(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    orderItemId: item2.id,
    sections: [
      {
        type: 'rich_instructions',
        title: 'تایید فعال‌سازی اشتراک ChatGPT Plus',
        value: '1. اشتراک یک‌ماهه ChatGPT Plus روی ایمیل `sara.ai@example.com` فعال شد.\n2. لطفاً یک‌بار از حساب خارج و مجدداً وارد شوید.',
      },
    ],
    customerNote: 'اشتراک شما فعال گردید.',
  });
  assert.equal(publishItem2Res.ok, true);
  assert.equal(publishItem2Res.orderFulfillmentStatus, 'fulfilled');

  const finalOrderRow = await db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .bind(paidOrder.id)
    .first();
  assert.equal(finalOrderRow.fulfillment_status, 'fulfilled');
  assert.ok(finalOrderRow.fulfilled_at, 'fulfilled_at timestamp must be set when all items are fulfilled');

  // Check status history and notification events
  const statusHistory = await listOrderStatusHistory(db, paidOrder.id);
  assert.ok(statusHistory.length >= 4, 'Status transitions recorded in order_status_history');

  const notifEvents = await listDeliveryNotificationEvents(db, paidOrder.id);
  assert.ok(notifEvents.some((e) => e.event_type === 'partial_delivery'));
  assert.ok(notifEvents.some((e) => e.event_type === 'order_fulfilled'));

  // Check audit logs do NOT contain any secret gift card codes
  const allAuditLogs = (
    await db.prepare('SELECT * FROM admin_audit_logs ORDER BY id ASC').all()
  ).results;
  assert.ok(allAuditLogs.length >= 4, 'All fulfillment actions are recorded in admin_audit_logs');
  const serializedLogs = JSON.stringify(allAuditLogs);
  assert.equal(
    serializedLogs.includes('STEAM-FINAL-8888-9999'),
    false,
    'Audit logs must never store raw gift card codes',
  );
  assert.equal(
    serializedLogs.includes('STEAM-V2-5555-7777'),
    false,
    'Audit logs must never store raw gift card codes',
  );

  // =========================================================================
  // SCENARIO 14: Removing attachment deletes from R2 and blocks further download
  // =========================================================================
  const removeAttRes = await removeOrderItemDeliveryAttachment(db, storage, {
    actor: superAdmin,
    orderId: paidOrder.id,
    attachmentPublicId,
    reason: 'حذف فایل آزمایشی',
  });
  assert.equal(removeAttRes.ok, true);
  const activeAttachments = await listDeliveryAttachmentsForOrder(db, paidOrder.id, false);
  assert.equal(activeAttachments.length, 0);

  const downloadAfterRemove = await authorizeAndLoadCustomerAttachment(db, {
    attachmentPublicId,
    guestToken: paidIdentity.accessToken,
  });
  assert.equal(downloadAfterRemove.ok, false, 'Removed attachment cannot be downloaded');

  // Update metadata check
  const metaRes = await updateOrderFulfillmentMetadata(db, {
    actor: superAdmin,
    orderId: paidOrder.id,
    assignedAdmin: 'سارا مدیر تحویل',
    internalNotes: 'تحویل سفارش به صورت کامل انجام و تایید شد.',
  });
  assert.equal(metaRes.ok, true);

  console.log('fulfillment integration: all assertions passed');
} finally {
  await mf.dispose();
}
