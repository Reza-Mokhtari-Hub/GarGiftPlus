import type { D1Database } from '@cloudflare/workers-types';
import { recordAdminAuditLog } from '../audit/db.ts';
import { queueNotification } from '../email/outboxStore.ts';
import { generatePublicId, withPublicId } from '../ids/publicId.ts';
import { isAccessToken } from '../ids/token.ts';
import { resolveAccessToken } from '../orders/guestAccess.ts';
import { getOrder, getOrderByPublicId, listOrderItems, type Order, type OrderItem } from '../orders/db.ts';
import type { StorageProvider } from '../storage/provider.ts';
import {
  buildDeliveryAttachmentKey,
  validateDeliveryAttachmentBytes,
} from './files.ts';
import {
  requireAdminPermission,
  type AdminActor,
} from './permissions.ts';
import {
  computeDeliveryPayloadHash,
  parseAndValidateDeliverySections,
  parseStoredDeliverySections,
  summarizeSectionsForAudit,
  type DeliverySection,
} from './sections.ts';
import {
  canOrderBeFulfilled,
  deriveAggregateOrderFulfillmentStatus,
  resolveOrderPaymentState,
  toDbItemFulfillmentStatus,
  toDbOrderFulfillmentStatus,
  type DbItemFulfillmentStatus,
  type DbOrderFulfillmentStatus,
  type OrderPaymentState,
} from './status.ts';

export type FulfillmentEmailEventType =
  | 'order_accepted'
  | 'processing_started'
  | 'ready_for_delivery'
  | 'partial_delivery'
  | 'delivery_published'
  | 'order_fulfilled';

export function buildFulfillmentOutboxKind(input: {
  eventType: FulfillmentEmailEventType;
  itemPublicId?: string | null;
  versionNumber?: number | null;
}): string {
  const v = input.versionNumber && input.versionNumber > 0 ? input.versionNumber : 1;
  switch (input.eventType) {
    case 'order_accepted':
      return 'fulfillment-accepted';
    case 'processing_started':
      return 'fulfillment-processing';
    case 'ready_for_delivery':
      return 'fulfillment-ready';
    case 'partial_delivery':
      return `fulfillment-partial:${input.itemPublicId ?? 'item'}:v${v}`;
    case 'delivery_published':
      return `fulfillment-published:${input.itemPublicId ?? 'item'}:v${v}`;
    case 'order_fulfilled':
      return `fulfillment-completed:v${v}`;
  }
}

export interface OrderItemDeliveryRow {
  id: number;
  public_id: string;
  order_id: number;
  order_item_id: number;
  status: 'draft' | 'ready_for_delivery' | 'published' | 'cancelled';
  current_version: number;
  draft_sections_json: string | null;
  published_sections_json: string | null;
  published_payload_hash: string | null;
  customer_note: string | null;
  admin_note: string | null;
  assigned_admin: string | null;
  created_by: string;
  updated_by: string;
  published_by: string | null;
  published_at: string | null;
  last_notified_version: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryVersionRow {
  id: number;
  public_id: string;
  delivery_id: number;
  order_id: number;
  order_item_id: number;
  version_number: number;
  sections_json: string;
  payload_hash: string;
  customer_note: string | null;
  change_reason: string | null;
  published_by: string;
  published_at: string;
}

export interface DeliveryAttachmentRow {
  id: number;
  public_id: string;
  delivery_id: number;
  order_id: number;
  order_item_id: number;
  version_number: number | null;
  is_published: number;
  removed_at: string | null;
  file_name: string;
  r2_object_key: string;
  mime_type: string;
  size_bytes: number;
  sha256_hex: string | null;
  download_count: number;
  uploaded_by: string;
  created_at: string;
}

export interface OrderStatusHistoryRow {
  id: number;
  public_id: string;
  order_id: number;
  order_item_id: number | null;
  status_type: 'payment' | 'fulfillment' | 'item_fulfillment';
  from_status: string | null;
  to_status: string;
  actor: string;
  note: string | null;
  is_customer_visible: number;
  created_at: string;
}

export interface DeliveryNotificationEventRow {
  id: number;
  public_id: string;
  order_id: number;
  order_item_id: number | null;
  delivery_id: number | null;
  version_number: number | null;
  event_type: FulfillmentEmailEventType;
  channel: string;
  outbox_kind: string;
  idempotency_key: string;
  actor: string;
  created_at: string;
}

/**
 * خواندن آخرین وضعیت تراکنش پرداخت برای یک سفارش (در صورت وجود)
 */
async function getLatestOrderPaymentTxInfo(
  db: D1Database,
  orderPublicId: string | null | undefined,
): Promise<{ status: string; method: string; receipt_status?: string | null; ref_id?: string | null; amount?: number } | null> {
  if (!orderPublicId) return null;
  const tx = await db
    .prepare(
      `SELECT pt.status, pt.method, pt.ref_id, pt.amount,
              (SELECT btr.status FROM bank_transfer_receipts btr WHERE btr.payment_tx_id = pt.id ORDER BY btr.id DESC LIMIT 1) AS receipt_status
         FROM payment_transactions pt
        WHERE pt.target_type = 'order' AND pt.target_public_id = ?
        ORDER BY pt.id DESC LIMIT 1`,
    )
    .bind(orderPublicId)
    .first<{
      status: string;
      method: string;
      receipt_status: string | null;
      ref_id: string | null;
      amount: number;
    }>();
  return tx ?? null;
}

export async function recordOrderStatusTransition(
  db: D1Database,
  input: {
    orderId: number;
    orderItemId?: number | null;
    statusType: 'payment' | 'fulfillment' | 'item_fulfillment';
    fromStatus?: string | null;
    toStatus: string;
    actor: string;
    note?: string | null;
    isCustomerVisible?: boolean;
  },
): Promise<string> {
  return withPublicId('orderStatusHistory', async (publicId) => {
    await db
      .prepare(
        `INSERT INTO order_status_history
           (public_id, order_id, order_item_id, status_type, from_status, to_status, actor, note, is_customer_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        publicId,
        input.orderId,
        input.orderItemId ?? null,
        input.statusType,
        input.fromStatus ?? null,
        input.toStatus,
        input.actor,
        input.note?.trim() || null,
        input.isCustomerVisible === false ? 0 : 1,
      )
      .run();
    return publicId;
  });
}

/**
 * محاسبه مجدد و به‌روزرسانی وضعیت تجمیعی تحویل سفارش بر اساس وضعیت آیتم‌های آن
 */
export async function recalculateAndSyncOrderFulfillmentStatus(
  db: D1Database,
  orderId: number,
  actor: string,
  note?: string | null,
): Promise<DbOrderFulfillmentStatus> {
  const order = await getOrder(db, orderId);
  if (!order) return 'unfulfilled';

  const items = await listOrderItems(db, orderId);
  const itemStatuses: DbItemFulfillmentStatus[] = items.map((it) =>
    toDbItemFulfillmentStatus(it.fulfillment_status),
  );
  const currentStatus = toDbOrderFulfillmentStatus(order.fulfillment_status);
  const nextStatus = deriveAggregateOrderFulfillmentStatus(itemStatuses, currentStatus);

  if (nextStatus !== currentStatus) {
    const nowSql = "datetime('now')";
    if (nextStatus === 'fulfilled') {
      await db
        .prepare(
          `UPDATE orders
              SET fulfillment_status = 'fulfilled',
                  fulfilled_at = COALESCE(fulfilled_at, ${nowSql}),
                  processing_started_at = COALESCE(processing_started_at, ${nowSql}),
                  ready_for_delivery_at = COALESCE(ready_for_delivery_at, ${nowSql})
            WHERE id = ?`,
        )
        .bind(orderId)
        .run();
    } else if (nextStatus === 'ready_for_delivery' || nextStatus === 'partially_fulfilled') {
      await db
        .prepare(
          `UPDATE orders
              SET fulfillment_status = ?,
                  processing_started_at = COALESCE(processing_started_at, ${nowSql}),
                  ready_for_delivery_at = COALESCE(ready_for_delivery_at, ${nowSql}),
                  fulfilled_at = NULL
            WHERE id = ?`,
        )
        .bind(nextStatus, orderId)
        .run();
    } else if (nextStatus === 'processing') {
      await db
        .prepare(
          `UPDATE orders
              SET fulfillment_status = 'processing',
                  processing_started_at = COALESCE(processing_started_at, ${nowSql}),
                  fulfilled_at = NULL
            WHERE id = ?`,
        )
        .bind(orderId)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE orders
              SET fulfillment_status = ?,
                  fulfilled_at = NULL
            WHERE id = ?`,
        )
        .bind(nextStatus, orderId)
        .run();
    }

    await recordOrderStatusTransition(db, {
      orderId,
      statusType: 'fulfillment',
      fromStatus: currentStatus,
      toStatus: nextStatus,
      actor,
      note: note ?? null,
      isCustomerVisible: true,
    });
  }

  return nextStatus;
}

export async function getDeliveryForOrderItem(
  db: D1Database,
  orderItemId: number,
): Promise<OrderItemDeliveryRow | null> {
  return db
    .prepare('SELECT * FROM order_item_deliveries WHERE order_item_id = ?')
    .bind(orderItemId)
    .first<OrderItemDeliveryRow>();
}

export async function listDeliveriesForOrder(
  db: D1Database,
  orderId: number,
): Promise<OrderItemDeliveryRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM order_item_deliveries WHERE order_id = ? ORDER BY order_item_id ASC')
    .bind(orderId)
    .all<OrderItemDeliveryRow>();
  return results ?? [];
}

export async function listDeliveryVersionsForOrder(
  db: D1Database,
  orderId: number,
): Promise<DeliveryVersionRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM delivery_versions WHERE order_id = ? ORDER BY version_number DESC, id DESC',
    )
    .bind(orderId)
    .all<DeliveryVersionRow>();
  return results ?? [];
}

export async function listDeliveryAttachmentsForOrder(
  db: D1Database,
  orderId: number,
  includeRemoved = false,
): Promise<DeliveryAttachmentRow[]> {
  const sql = includeRemoved
    ? 'SELECT * FROM delivery_attachments WHERE order_id = ? ORDER BY id ASC'
    : 'SELECT * FROM delivery_attachments WHERE order_id = ? AND removed_at IS NULL ORDER BY id ASC';
  const { results } = await db.prepare(sql).bind(orderId).all<DeliveryAttachmentRow>();
  return results ?? [];
}

export async function listOrderStatusHistory(
  db: D1Database,
  orderId: number,
  customerOnly = false,
): Promise<OrderStatusHistoryRow[]> {
  const sql = customerOnly
    ? 'SELECT * FROM order_status_history WHERE order_id = ? AND is_customer_visible = 1 ORDER BY created_at ASC, id ASC'
    : 'SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC, id ASC';
  const { results } = await db.prepare(sql).bind(orderId).all<OrderStatusHistoryRow>();
  return results ?? [];
}

export async function listDeliveryNotificationEvents(
  db: D1Database,
  orderId: number,
): Promise<DeliveryNotificationEventRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM delivery_notification_events WHERE order_id = ? ORDER BY created_at DESC, id DESC',
    )
    .bind(orderId)
    .all<DeliveryNotificationEventRow>();
  return results ?? [];
}

/**
 * ثبت رویداد اعلان تحویل و صف‌بندی در Outbox به‌صورت Idempotent.
 * اگر همان idempotencyKey قبلاً ثبت شده باشد، هیچ ردیف یا ایمیل تکراری ایجاد نمی‌کند.
 */
export async function queueFulfillmentNotification(
  db: D1Database,
  input: {
    orderId: number;
    orderItemId?: number | null;
    deliveryId?: number | null;
    versionNumber?: number | null;
    eventType: FulfillmentEmailEventType;
    itemPublicId?: string | null;
    idempotencyKey: string;
    actor: string;
  },
): Promise<{ queued: boolean; outboxKind: string }> {
  const outboxKind = buildFulfillmentOutboxKind({
    eventType: input.eventType,
    itemPublicId: input.itemPublicId,
    versionNumber: input.versionNumber,
  });

  const existing = await db
    .prepare('SELECT id FROM delivery_notification_events WHERE idempotency_key = ?')
    .bind(input.idempotencyKey)
    .first<{ id: number }>();

  if (existing) {
    return { queued: false, outboxKind };
  }

  const eventPublicId = generatePublicId('deliveryNotification');
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO delivery_notification_events
         (public_id, order_id, order_item_id, delivery_id, version_number, event_type, channel, outbox_kind, idempotency_key, actor)
       VALUES (?, ?, ?, ?, ?, ?, 'email', ?, ?, ?)`,
    )
    .bind(
      eventPublicId,
      input.orderId,
      input.orderItemId ?? null,
      input.deliveryId ?? null,
      input.versionNumber ?? null,
      input.eventType,
      outboxKind,
      input.idempotencyKey,
      input.actor,
    )
    .run();

  if ((inserted.meta?.changes ?? 0) === 0) {
    return { queued: false, outboxKind };
  }

  // صف‌بندی در جدول order_notifications برای تحویل توسط Outbox
  await queueNotification(db, input.orderId, outboxKind as Parameters<typeof queueNotification>[2]);

  await recordAdminAuditLog(db, {
    action: 'delivery.notification_queued',
    targetType: 'order',
    targetId: String(input.orderId),
    actor: input.actor,
    details: {
      orderId: input.orderId,
      orderItemId: input.orderItemId ?? null,
      deliveryId: input.deliveryId ?? null,
      versionNumber: input.versionNumber ?? null,
      eventType: input.eventType,
      outboxKind,
    },
  });

  return { queued: true, outboxKind };
}

/**
 * ذخیره پیش‌نویس تحویل (Draft) برای یک آیتم سفارش.
 * - پیش‌نویس در D1 ذخیره می‌شود اما برای مشتری قابل مشاهده نیست.
 * - هیچ اعلان تحویلی برای مشتری ارسال نمی‌شود.
 * - سفارش‌های پرداخت‌نشده یا در انتظار بررسی فیش رد می‌شوند.
 */
export async function saveOrderItemDeliveryDraft(
  db: D1Database,
  input: {
    actor: AdminActor;
    orderId: number;
    orderItemId: number;
    sections: unknown;
    customerNote?: string | null;
    adminNote?: string | null;
    assignedAdmin?: string | null;
    markReadyForDelivery?: boolean;
  },
): Promise<
  | { ok: true; delivery: OrderItemDeliveryRow; orderFulfillmentStatus: DbOrderFulfillmentStatus }
  | { ok: false; status: number; error: string }
> {
  const perm = requireAdminPermission(input.actor, 'orders.fulfill');
  if (!perm.ok) return perm;

  const order = await getOrder(db, input.orderId);
  const latestTx = await getLatestOrderPaymentTxInfo(db, order?.public_id);
  const gate = canOrderBeFulfilled(order, latestTx);
  if (!gate.allowed || !order) {
    return {
      ok: false,
      status: 400,
      error: gate.reason ?? 'این سفارش مجاز به تحویل نیست.',
    };
  }

  const items = await listOrderItems(db, order.id);
  const item = items.find((it) => it.id === input.orderItemId);
  if (!item) {
    return { ok: false, status: 404, error: 'ردیف سفارش مورد نظر یافت نشد.' };
  }

  const parsedSections = parseAndValidateDeliverySections(input.sections);
  if (!parsedSections.ok) {
    return {
      ok: false,
      status: 400,
      error: parsedSections.error ?? 'بخش‌های تحویل نامعتبر است.',
    };
  }

  const sectionsJson = JSON.stringify(parsedSections.sections);
  const existing = await getDeliveryForOrderItem(db, item.id);
  const customerNote = input.customerNote?.trim() || null;
  const adminNote = input.adminNote?.trim() || null;
  const assignedAdmin = input.assignedAdmin?.trim() || existing?.assigned_admin || input.actor.id;

  let delivery: OrderItemDeliveryRow | null = null;
  let auditAction = 'delivery.draft_updated';

  if (!existing) {
    auditAction = 'delivery.draft_created';
    const nextStatus = input.markReadyForDelivery ? 'ready_for_delivery' : 'draft';
    await withPublicId('delivery', async (publicId) => {
      await db
        .prepare(
          `INSERT INTO order_item_deliveries
             (public_id, order_id, order_item_id, status, current_version, draft_sections_json,
              customer_note, admin_note, assigned_admin, created_by, updated_by)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          publicId,
          order.id,
          item.id,
          nextStatus,
          sectionsJson,
          customerNote,
          adminNote,
          assignedAdmin,
          input.actor.id,
          input.actor.id,
        )
        .run();
    });
    delivery = await getDeliveryForOrderItem(db, item.id);
  } else {
    // اگر قبلاً منتشر شده باشد، وضعیت published حفظ می‌شود و فقط پیش‌نویس ویرایش بعدی ذخیره می‌گردد
    const nextDeliveryStatus =
      existing.status === 'published'
        ? 'published'
        : input.markReadyForDelivery
          ? 'ready_for_delivery'
          : 'draft';
    await db
      .prepare(
        `UPDATE order_item_deliveries
            SET status = ?,
                draft_sections_json = ?,
                customer_note = ?,
                admin_note = ?,
                assigned_admin = ?,
                updated_by = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(
        nextDeliveryStatus,
        sectionsJson,
        customerNote,
        adminNote,
        assignedAdmin,
        input.actor.id,
        existing.id,
      )
      .run();
    delivery = await getDeliveryForOrderItem(db, item.id);
  }

  if (!delivery) {
    return { ok: false, status: 500, error: 'ذخیره پیش‌نویس تحویل با خطا مواجه شد.' };
  }

  // اگر آیتم هنوز تحویل نشده است، وضعیت آن را به processing یا ready_for_delivery تغییر می‌دهیم
  const prevItemStatus = toDbItemFulfillmentStatus(item.fulfillment_status);
  if (prevItemStatus !== 'fulfilled') {
    const targetItemStatus: DbItemFulfillmentStatus = input.markReadyForDelivery
      ? 'ready_for_delivery'
      : 'processing';
    if (prevItemStatus !== targetItemStatus) {
      await db
        .prepare('UPDATE order_items SET fulfillment_status = ? WHERE id = ?')
        .bind(targetItemStatus, item.id)
        .run();
      await recordOrderStatusTransition(db, {
        orderId: order.id,
        orderItemId: item.id,
        statusType: 'item_fulfillment',
        fromStatus: prevItemStatus,
        toStatus: targetItemStatus,
        actor: input.actor.id,
        note: `پیش‌نویس تحویل آیتم «${item.name}» ذخیره شد`,
        isCustomerVisible: true,
      });
    }
  }

  const orderFulfillmentStatus = await recalculateAndSyncOrderFulfillmentStatus(
    db,
    order.id,
    input.actor.id,
  );

  // ثبت لاگ حسابرسی بدون افشای مقادیر کد یا لایسنس
  await recordAdminAuditLog(db, {
    action: auditAction,
    targetType: 'order_item_delivery',
    targetId: delivery.public_id,
    actor: input.actor.id,
    details: {
      orderId: order.id,
      orderPublicId: order.public_id,
      orderItemId: item.id,
      orderItemPublicId: item.public_id,
      deliveryPublicId: delivery.public_id,
      status: delivery.status,
      ...summarizeSectionsForAudit(parsedSections.sections),
    },
  });

  return { ok: true, delivery, orderFulfillmentStatus };
}

/**
 * بارگذاری فایل پیوست خصوصی تحویل در باکت خصوصی R2 (`env.FILES`)
 */
export async function uploadOrderItemDeliveryAttachment(
  db: D1Database,
  storage: StorageProvider,
  input: {
    actor: AdminActor;
    orderId: number;
    orderItemId: number;
    fileBytes: Uint8Array;
    fileName: string;
    mimeType?: string | null;
  },
): Promise<
  | { ok: true; attachment: DeliveryAttachmentRow; delivery: OrderItemDeliveryRow }
  | { ok: false; status: number; error: string }
> {
  const perm = requireAdminPermission(input.actor, 'orders.fulfill');
  if (!perm.ok) return perm;

  const order = await getOrder(db, input.orderId);
  const latestTx = await getLatestOrderPaymentTxInfo(db, order?.public_id);
  const gate = canOrderBeFulfilled(order, latestTx);
  if (!gate.allowed || !order) {
    return {
      ok: false,
      status: 400,
      error: gate.reason ?? 'بارگذاری پیوست برای سفارش پرداخت‌نشده مجاز نیست.',
    };
  }

  const items = await listOrderItems(db, order.id);
  const item = items.find((it) => it.id === input.orderItemId);
  if (!item) {
    return { ok: false, status: 404, error: 'ردیف سفارش مورد نظر یافت نشد.' };
  }

  const validation = await validateDeliveryAttachmentBytes(
    input.fileBytes,
    input.fileName,
    input.mimeType,
  );
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }

  // اطمینان از وجود رکورد order_item_deliveries (ایجاد پیش‌نویس اولیه در صورت نبود)
  let delivery = await getDeliveryForOrderItem(db, item.id);
  if (!delivery) {
    const draftRes = await saveOrderItemDeliveryDraft(db, {
      actor: input.actor,
      orderId: order.id,
      orderItemId: item.id,
      sections: [],
    });
    if (!draftRes.ok) return draftRes;
    delivery = draftRes.delivery;
  }

  const attachmentPublicId = generatePublicId('deliveryAttachment');
  const objectKey = buildDeliveryAttachmentKey(
    order.public_id ?? String(order.id),
    item.public_id ?? String(item.id),
    attachmentPublicId,
    validation.sniffed.ext,
  );

  await storage.put(
    objectKey,
    input.fileBytes.buffer.slice(
      input.fileBytes.byteOffset,
      input.fileBytes.byteOffset + input.fileBytes.byteLength,
    ) as ArrayBuffer,
    validation.sniffed.mime,
    { cacheControl: 'private, no-store' },
  );

  try {
    await db
      .prepare(
        `INSERT INTO delivery_attachments
           (public_id, delivery_id, order_id, order_item_id, version_number, is_published,
            file_name, r2_object_key, mime_type, size_bytes, sha256_hex, uploaded_by)
         VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        attachmentPublicId,
        delivery.id,
        order.id,
        item.id,
        validation.safeFileName,
        objectKey,
        validation.sniffed.mime,
        input.fileBytes.byteLength,
        validation.sha256Hex,
        input.actor.id,
      )
      .run();
  } catch (err) {
    await storage.delete(objectKey).catch(() => {});
    throw err;
  }

  const attachment = await db
    .prepare('SELECT * FROM delivery_attachments WHERE public_id = ?')
    .bind(attachmentPublicId)
    .first<DeliveryAttachmentRow>();

  if (!attachment) {
    return { ok: false, status: 500, error: 'خطا در ثبت اطلاعات فایل پیوست در دیتابیس.' };
  }

  await recordAdminAuditLog(db, {
    action: 'delivery.attachment_uploaded',
    targetType: 'delivery_attachment',
    targetId: attachment.public_id,
    actor: input.actor.id,
    details: {
      orderId: order.id,
      orderPublicId: order.public_id,
      orderItemId: item.id,
      deliveryPublicId: delivery.public_id,
      attachmentPublicId: attachment.public_id,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
      sizeBytes: attachment.size_bytes,
      sha256Hex: attachment.sha256_hex,
    },
  });

  return { ok: true, attachment, delivery };
}

/**
 * حذف ایمن فایل پیوست تحویل:
 * - اگر پیوست هنوز منتشر نشده باشد (is_published = 0)، شیء از باکت خصوصی R2 نیز حذف می‌شود.
 * - اگر پیوست قبلاً در نسخه منتشرشده قرار گرفته باشد (is_published = 1)، برای حفظ تاریخچه
 *   فقط removed_at پر می‌شود تا در نسخه‌های جدید فعال نباشد و مرجع تاریخی حفظ گردد.
 */
export async function removeOrderItemDeliveryAttachment(
  db: D1Database,
  storage: StorageProvider,
  input: {
    actor: AdminActor;
    orderId: number;
    attachmentPublicId: string;
    reason?: string | null;
  },
): Promise<{ ok: true; wasPublished: boolean } | { ok: false; status: number; error: string }> {
  const attachment = await db
    .prepare(
      'SELECT * FROM delivery_attachments WHERE public_id = ? AND order_id = ? AND removed_at IS NULL',
    )
    .bind(input.attachmentPublicId, input.orderId)
    .first<DeliveryAttachmentRow>();

  if (!attachment) {
    return { ok: false, status: 404, error: 'فایل پیوست مورد نظر یافت نشد یا قبلاً حذف شده است.' };
  }

  const requiredPerm =
    attachment.is_published === 1 ? 'orders.edit_published_delivery' : 'orders.fulfill';
  const perm = requireAdminPermission(input.actor, requiredPerm);
  if (!perm.ok) return perm;

  await db
    .prepare("UPDATE delivery_attachments SET removed_at = datetime('now') WHERE id = ?")
    .bind(attachment.id)
    .run();

  if (attachment.is_published === 0) {
    await storage.delete(attachment.r2_object_key).catch(() => {});
  }

  await recordAdminAuditLog(db, {
    action: 'delivery.attachment_removed',
    targetType: 'delivery_attachment',
    targetId: attachment.public_id,
    actor: input.actor.id,
    reason: input.reason ?? null,
    details: {
      orderId: attachment.order_id,
      orderItemId: attachment.order_item_id,
      attachmentPublicId: attachment.public_id,
      fileName: attachment.file_name,
      wasPublished: attachment.is_published === 1,
    },
  });

  return { ok: true, wasPublished: attachment.is_published === 1 };
}

/**
 * انتشار نهایی تحویل برای یک آیتم سفارش (Publish) یا ثبت ویرایش نسخه منتشرشده (Revision):
 * 1. بررسی مجوز مدیر (`orders.fulfill` برای انتشار اولیه؛ `orders.edit_published_delivery` برای ویرایش تحویل منتشرشده)
 * 2. بررسی تایید قطعی پرداخت سفارش (`PAID`)
 * 3. بررسی وجود حداقل یک بخش محتوایی معتبر یا یک فایل پیوست فعال
 * 4. بررسی Idempotency بر اساس هش محتوا (درخواست تکراری بدون تغییر، نسخه یا اعلان تکراری نمی‌سازد)
 * 5. ثبت نسخه غیرقابل‌تغییر در `delivery_versions`
 * 6. به‌روزرسانی وضعیت آیتم به `fulfilled` و محاسبه وضعیت کل سفارش (`partially_fulfilled` یا `fulfilled`)
 * 7. ثبت تاریخچه وضعیت و لاگ حسابرسی
 * 8. صف‌بندی اعلان ایمیل در Outbox
 */
export async function publishOrderItemDelivery(
  db: D1Database,
  input: {
    actor: AdminActor;
    orderId: number;
    orderItemId: number;
    sections?: unknown;
    customerNote?: string | null;
    adminNote?: string | null;
    changeReason?: string | null;
  },
): Promise<
  | {
      ok: true;
      idempotent: boolean;
      versionNumber: number;
      delivery: OrderItemDeliveryRow;
      orderFulfillmentStatus: DbOrderFulfillmentStatus;
      queuedOutboxKinds: string[];
    }
  | { ok: false; status: number; error: string }
> {
  const basePerm = requireAdminPermission(input.actor, 'orders.fulfill');
  if (!basePerm.ok) return basePerm;

  const order = await getOrder(db, input.orderId);
  const latestTx = await getLatestOrderPaymentTxInfo(db, order?.public_id);
  const gate = canOrderBeFulfilled(order, latestTx);
  if (!gate.allowed || !order) {
    return {
      ok: false,
      status: 400,
      error: gate.reason ?? 'امکان انتشار تحویل برای سفارش پرداخت‌نشده وجود ندارد.',
    };
  }

  const items = await listOrderItems(db, order.id);
  const item = items.find((it) => it.id === input.orderItemId);
  if (!item) {
    return { ok: false, status: 404, error: 'ردیف سفارش مورد نظر یافت نشد.' };
  }

  let delivery = await getDeliveryForOrderItem(db, item.id);
  const isAlreadyPublished = delivery?.status === 'published' && delivery.current_version > 0;

  if (isAlreadyPublished) {
    const editPerm = requireAdminPermission(input.actor, 'orders.edit_published_delivery');
    if (!editPerm.ok) return editPerm;
  }

  // اگر بخش‌های جدید همراه درخواست ارسال شده باشد ابتدا اعتبارسنجی می‌کنیم، در غیر این صورت از پیش‌نویس فعلی می‌خوانیم
  const rawSectionsSource =
    input.sections !== undefined
      ? input.sections
      : delivery?.draft_sections_json ?? delivery?.published_sections_json ?? '[]';

  const parsedSections = parseAndValidateDeliverySections(rawSectionsSource);
  if (!parsedSections.ok) {
    return {
      ok: false,
      status: 400,
      error: parsedSections.error ?? 'بخش‌های تحویل نامعتبر است.',
    };
  }

  // اگر هنوز رکورد delivery وجود نداشت، آن را ایجاد می‌کنیم
  const customerNote =
    input.customerNote !== undefined
      ? input.customerNote?.trim() || null
      : delivery?.customer_note ?? null;
  const adminNote =
    input.adminNote !== undefined
      ? input.adminNote?.trim() || null
      : delivery?.admin_note ?? null;

  if (!delivery) {
    const draftRes = await saveOrderItemDeliveryDraft(db, {
      actor: input.actor,
      orderId: order.id,
      orderItemId: item.id,
      sections: parsedSections.sections,
      customerNote,
      adminNote,
    });
    if (!draftRes.ok) return draftRes;
    delivery = draftRes.delivery;
  }

  const activeAttachments = await db
    .prepare(
      'SELECT * FROM delivery_attachments WHERE delivery_id = ? AND removed_at IS NULL ORDER BY id ASC',
    )
    .bind(delivery.id)
    .all<DeliveryAttachmentRow>();
  const attachmentRows = activeAttachments.results ?? [];

  if (parsedSections.sections.length === 0 && attachmentRows.length === 0) {
    return {
      ok: false,
      status: 400,
      error:
        'برای انتشار تحویل، باید حداقل یک بخش اطلاعاتی (کد، لینک، متن یا راهنما) یا حداقل یک فایل پیوست ثبت شده باشد.',
    };
  }

  const payloadHash = await computeDeliveryPayloadHash({
    sections: parsedSections.sections,
    customerNote,
    attachmentPublicIds: attachmentRows.map((a) => a.public_id),
  });

  // بررسی Idempotency: اگر دقیقاً همین محتوا قبلاً منتشر شده باشد، عملیات تکراری انجام نمی‌شود
  if (
    delivery.status === 'published' &&
    delivery.current_version > 0 &&
    delivery.published_payload_hash === payloadHash
  ) {
    const currentOrderStatus = toDbOrderFulfillmentStatus(order.fulfillment_status);
    return {
      ok: true,
      idempotent: true,
      versionNumber: delivery.current_version,
      delivery,
      orderFulfillmentStatus: currentOrderStatus,
      queuedOutboxKinds: [],
    };
  }

  const nextVersion = delivery.current_version + 1;
  const sectionsJson = JSON.stringify(parsedSections.sections);
  const changeReason =
    input.changeReason?.trim() ||
    (nextVersion === 1 ? 'انتشار اولیه اطلاعات تحویل سفارش' : 'به‌روزرسانی و اصلاح اطلاعات تحویل');

  const versionPublicId = generatePublicId('deliveryVersion');

  await db.batch([
    db
      .prepare(
        `UPDATE order_item_deliveries
            SET status = 'published',
                current_version = ?,
                draft_sections_json = ?,
                published_sections_json = ?,
                published_payload_hash = ?,
                customer_note = ?,
                admin_note = ?,
                updated_by = ?,
                published_by = ?,
                published_at = datetime('now'),
                last_notified_version = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(
        nextVersion,
        sectionsJson,
        sectionsJson,
        payloadHash,
        customerNote,
        adminNote,
        input.actor.id,
        input.actor.id,
        nextVersion,
        delivery.id,
      ),
    db
      .prepare(
        `INSERT INTO delivery_versions
           (public_id, delivery_id, order_id, order_item_id, version_number,
            sections_json, payload_hash, customer_note, change_reason, published_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        versionPublicId,
        delivery.id,
        order.id,
        item.id,
        nextVersion,
        sectionsJson,
        payloadHash,
        customerNote,
        changeReason,
        input.actor.id,
      ),
    db
      .prepare(
        `UPDATE delivery_attachments
            SET is_published = 1,
                version_number = COALESCE(version_number, ?)
          WHERE delivery_id = ? AND removed_at IS NULL`,
      )
      .bind(nextVersion, delivery.id),
    db
      .prepare(
        `UPDATE order_items
            SET fulfillment_status = 'fulfilled',
                fulfilled_at = COALESCE(fulfilled_at, datetime('now')),
                fulfilled_by = ?
          WHERE id = ?`,
      )
      .bind(input.actor.id, item.id),
  ]);

  const updatedDelivery = (await getDeliveryForOrderItem(db, item.id))!;
  const prevItemStatus = toDbItemFulfillmentStatus(item.fulfillment_status);
  if (prevItemStatus !== 'fulfilled') {
    await recordOrderStatusTransition(db, {
      orderId: order.id,
      orderItemId: item.id,
      statusType: 'item_fulfillment',
      fromStatus: prevItemStatus,
      toStatus: 'fulfilled',
      actor: input.actor.id,
      note: `آیتم «${item.name}» تحویل داده شد (نسخه ${nextVersion})`,
      isCustomerVisible: true,
    });
  }

  const orderFulfillmentStatus = await recalculateAndSyncOrderFulfillmentStatus(
    db,
    order.id,
    input.actor.id,
    order.fulfillment_status !== 'fulfilled'
      ? `به‌روزرسانی وضعیت سفارش پس از انتشار تحویل آیتم «${item.name}»`
      : null,
  );

  // ثبت لاگ حسابرسی (بدون ذخیره مقادیر حساس کد یا لایسنس)
  await recordAdminAuditLog(db, {
    action: nextVersion === 1 ? 'delivery.published' : 'delivery.revised',
    targetType: 'order_item_delivery',
    targetId: updatedDelivery.public_id,
    actor: input.actor.id,
    reason: changeReason,
    details: {
      orderId: order.id,
      orderPublicId: order.public_id,
      orderItemId: item.id,
      orderItemPublicId: item.public_id,
      deliveryPublicId: updatedDelivery.public_id,
      versionNumber: nextVersion,
      versionPublicId,
      attachmentCount: attachmentRows.length,
      orderFulfillmentStatus,
      ...summarizeSectionsForAudit(parsedSections.sections),
    },
  });

  // صف‌بندی اعلان ایمیل در Outbox
  const queuedOutboxKinds: string[] = [];
  const itemEventType: FulfillmentEmailEventType =
    orderFulfillmentStatus === 'partially_fulfilled' ? 'partial_delivery' : 'delivery_published';

  const itemNotif = await queueFulfillmentNotification(db, {
    orderId: order.id,
    orderItemId: item.id,
    deliveryId: updatedDelivery.id,
    versionNumber: nextVersion,
    eventType: itemEventType,
    itemPublicId: item.public_id ?? String(item.id),
    idempotencyKey: `publish:${updatedDelivery.public_id}:v${nextVersion}`,
    actor: input.actor.id,
  });
  if (itemNotif.queued) queuedOutboxKinds.push(itemNotif.outboxKind);

  if (orderFulfillmentStatus === 'fulfilled') {
    const completedNotif = await queueFulfillmentNotification(db, {
      orderId: order.id,
      deliveryId: updatedDelivery.id,
      versionNumber: nextVersion,
      eventType: 'order_fulfilled',
      idempotencyKey: `order_fulfilled:${order.public_id ?? order.id}:v${nextVersion}`,
      actor: input.actor.id,
    });
    if (completedNotif.queued) queuedOutboxKinds.push(completedNotif.outboxKind);
  }

  return {
    ok: true,
    idempotent: false,
    versionNumber: nextVersion,
    delivery: updatedDelivery,
    orderFulfillmentStatus,
    queuedOutboxKinds,
  };
}

/**
 * به‌روزرسانی وضعیت پردازش کلی سفارش، اپراتور مسئول و یادداشت داخلی مدیر
 */
export async function updateOrderFulfillmentMetadata(
  db: D1Database,
  input: {
    actor: AdminActor;
    orderId: number;
    fulfillmentStatus?: DbOrderFulfillmentStatus | null;
    assignedAdmin?: string | null;
    internalNotes?: string | null;
    sendNotification?: boolean;
  },
): Promise<{ ok: true; fulfillmentStatus: DbOrderFulfillmentStatus } | { ok: false; status: number; error: string }> {
  const perm = requireAdminPermission(input.actor, 'orders.fulfill');
  if (!perm.ok) return perm;

  const order = await getOrder(db, input.orderId);
  const latestTx = await getLatestOrderPaymentTxInfo(db, order?.public_id);
  const gate = canOrderBeFulfilled(order, latestTx);
  if (!order) {
    return { ok: false, status: 404, error: 'سفارش مورد نظر یافت نشد.' };
  }

  const currentStatus = toDbOrderFulfillmentStatus(order.fulfillment_status);
  const requestedStatus = input.fulfillmentStatus
    ? toDbOrderFulfillmentStatus(input.fulfillmentStatus)
    : currentStatus;

  // جلوگیری از تغییر وضعیت به processing/ready/fulfilled برای سفارش‌های پرداخت‌نشده
  if (requestedStatus !== 'unfulfilled' && requestedStatus !== 'cancelled' && !gate.allowed) {
    return {
      ok: false,
      status: 400,
      error: gate.reason ?? 'این سفارش هنوز پرداخت نشده است.',
    };
  }

  // جلوگیری از علامت‌گذاری کل سفارش به عنوان fulfilled زمانی که آیتم‌های تحویل‌نشده وجود دارد
  if (requestedStatus === 'fulfilled') {
    const items = await listOrderItems(db, order.id);
    const allItemsFulfilled =
      items.length > 0 &&
      items.every((it) => toDbItemFulfillmentStatus(it.fulfillment_status) === 'fulfilled');
    if (!allItemsFulfilled) {
      return {
        ok: false,
        status: 400,
        error:
          'تا زمانی که تحویل تمامی آیتم‌های سفارش منتشر نشده است، نمی‌توان وضعیت کل سفارش را «تحویل‌شده» قرار داد.',
      };
    }
  }

  const nextAssigned =
    input.assignedAdmin !== undefined ? input.assignedAdmin?.trim() || null : order.assigned_admin ?? null;
  const nextNotes =
    input.internalNotes !== undefined ? input.internalNotes?.trim() || null : order.internal_notes ?? null;

  await db
    .prepare(
      `UPDATE orders
          SET fulfillment_status = ?,
              assigned_admin = ?,
              internal_notes = ?,
              processing_started_at = CASE
                WHEN ? IN ('processing', 'ready_for_delivery', 'partially_fulfilled', 'fulfilled')
                THEN COALESCE(processing_started_at, datetime('now'))
                ELSE processing_started_at
              END,
              ready_for_delivery_at = CASE
                WHEN ? IN ('ready_for_delivery', 'partially_fulfilled', 'fulfilled')
                THEN COALESCE(ready_for_delivery_at, datetime('now'))
                ELSE ready_for_delivery_at
              END
        WHERE id = ?`,
    )
    .bind(
      requestedStatus,
      nextAssigned,
      nextNotes,
      requestedStatus,
      requestedStatus,
      order.id,
    )
    .run();

  if (requestedStatus !== currentStatus) {
    await recordOrderStatusTransition(db, {
      orderId: order.id,
      statusType: 'fulfillment',
      fromStatus: currentStatus,
      toStatus: requestedStatus,
      actor: input.actor.id,
      note:
        requestedStatus === 'processing'
          ? 'آغاز بررسی و آماده‌سازی سفارش توسط کارشناس'
          : requestedStatus === 'ready_for_delivery'
            ? 'آماده تحویل شدن سفارش'
            : requestedStatus === 'cancelled'
              ? 'لغو تحویل سفارش'
              : null,
      isCustomerVisible: true,
    });
  }

  await recordAdminAuditLog(db, {
    action:
      requestedStatus === 'cancelled'
        ? 'delivery.cancelled'
        : 'delivery.order_metadata_updated',
    targetType: 'order',
    targetId: order.public_id ?? String(order.id),
    actor: input.actor.id,
    details: {
      orderId: order.id,
      fromStatus: currentStatus,
      toStatus: requestedStatus,
      assignedAdmin: nextAssigned,
      hasInternalNotes: Boolean(nextNotes),
    },
  });

  if (input.sendNotification && requestedStatus !== currentStatus) {
    if (requestedStatus === 'processing') {
      await queueFulfillmentNotification(db, {
        orderId: order.id,
        eventType: 'processing_started',
        idempotencyKey: `status_processing:${order.public_id ?? order.id}`,
        actor: input.actor.id,
      });
    } else if (requestedStatus === 'ready_for_delivery') {
      await queueFulfillmentNotification(db, {
        orderId: order.id,
        eventType: 'ready_for_delivery',
        idempotencyKey: `status_ready:${order.public_id ?? order.id}`,
        actor: input.actor.id,
      });
    }
  }

  return { ok: true, fulfillmentStatus: requestedStatus };
}

/**
 * ثبت لاگ حسابرسی هنگام مشاهده محتوای حساس تحویل توسط مدیر
 */
export async function recordAdminViewedSensitiveDelivery(
  db: D1Database,
  actor: AdminActor,
  order: Order,
): Promise<void> {
  await recordAdminAuditLog(db, {
    action: 'delivery.sensitive_viewed',
    targetType: 'order',
    targetId: order.public_id ?? String(order.id),
    actor: actor.id,
    details: {
      orderId: order.id,
      orderPublicId: order.public_id,
      role: actor.role,
    },
  });
}

/**
 * واکشی اطلاعات منتشرشده تحویل سفارش برای نمایش امن به مشتری.
 * هرگز پیش‌نویس‌ها (draft_sections_json)، یادداشت‌های داخلی مدیر (admin_note / internal_notes)،
 * فایل‌های پیوست منتشرنشده یا لاگ‌های حسابرسی را برنمی‌گرداند.
 */
export interface CustomerPublishedItemDelivery {
  orderItemId: number;
  orderItemPublicId: string | null;
  itemName: string;
  itemFulfillmentStatus: DbItemFulfillmentStatus;
  isPublished: boolean;
  versionNumber: number;
  publishedAt: string | null;
  customerNote: string | null;
  sections: DeliverySection[];
  attachments: Array<{
    publicId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}

export interface CustomerOrderDeliveryView {
  orderId: number;
  orderPublicId: string | null;
  paymentState: OrderPaymentState;
  fulfillmentStatus: DbOrderFulfillmentStatus;
  processingStartedAt: string | null;
  readyForDeliveryAt: string | null;
  fulfilledAt: string | null;
  items: CustomerPublishedItemDelivery[];
  history: Array<{
    statusType: string;
    toStatus: string;
    note: string | null;
    createdAt: string;
  }>;
}

export async function getCustomerOrderDeliveryView(
  db: D1Database,
  order: Order,
  items?: OrderItem[],
): Promise<CustomerOrderDeliveryView> {
  const orderItems = items ?? (await listOrderItems(db, order.id));
  const latestTx = await getLatestOrderPaymentTxInfo(db, order.public_id);
  const paymentState = resolveOrderPaymentState(order, latestTx);
  const fulfillmentStatus = toDbOrderFulfillmentStatus(order.fulfillment_status);

  const deliveries = await listDeliveriesForOrder(db, order.id);
  const deliveryByItemId = new Map(deliveries.map((d) => [d.order_item_id, d]));

  const allAttachments = await listDeliveryAttachmentsForOrder(db, order.id, false);
  const publishedAttachmentsByDelivery = new Map<number, DeliveryAttachmentRow[]>();
  for (const att of allAttachments) {
    if (att.is_published !== 1 || att.removed_at !== null) continue;
    const list = publishedAttachmentsByDelivery.get(att.delivery_id) ?? [];
    list.push(att);
    publishedAttachmentsByDelivery.set(att.delivery_id, list);
  }

  const historyRows = await listOrderStatusHistory(db, order.id, true);

  const isPaidAndActive = paymentState === 'PAID';

  const customerItems: CustomerPublishedItemDelivery[] = orderItems.map((it) => {
    const del = deliveryByItemId.get(it.id);
    const isPublished =
      isPaidAndActive && del?.status === 'published' && Boolean(del.published_sections_json);
    const sections = isPublished ? parseStoredDeliverySections(del!.published_sections_json) : [];
    const attachments =
      isPaidAndActive && del?.status === 'published'
        ? (publishedAttachmentsByDelivery.get(del.id) ?? []).map((a) => ({
            publicId: a.public_id,
            fileName: a.file_name,
            mimeType: a.mime_type,
            sizeBytes: a.size_bytes,
          }))
        : [];

    return {
      orderItemId: it.id,
      orderItemPublicId: it.public_id,
      itemName: it.name,
      itemFulfillmentStatus: toDbItemFulfillmentStatus(it.fulfillment_status),
      isPublished: Boolean(isPublished || attachments.length > 0),
      versionNumber: isPaidAndActive && del?.status === 'published' ? del.current_version : 0,
      publishedAt: isPaidAndActive && del?.status === 'published' ? del.published_at : null,
      customerNote: isPaidAndActive && del?.status === 'published' ? del.customer_note : null,
      sections,
      attachments,
    };
  });

  return {
    orderId: order.id,
    orderPublicId: order.public_id,
    paymentState,
    fulfillmentStatus,
    processingStartedAt: order.processing_started_at ?? null,
    readyForDeliveryAt: order.ready_for_delivery_at ?? null,
    fulfilledAt: order.fulfilled_at ?? null,
    items: customerItems,
    history: historyRows.map((h) => ({
      statusType: h.status_type,
      toStatus: h.to_status,
      note: h.note,
      createdAt: h.created_at,
    })),
  };
}

/**
 * احراز هویت و بررسی دقیق مجوز دانلود فایل پیوست خصوصی تحویل برای مشتری یا مهمان (ضد IDOR):
 * 1. بررسی مالکیت حساب کاربری مشتری یا اعتبار توکن مهمان (`otk_...`)
 * 2. بررسی وجود پیوست و عدم حذف آن (`removed_at IS NULL`)
 * 3. بررسی تعلق پیوست به تحویل (`delivery_id`) و تعلق تحویل به همان سفارش (`order_id`)
 * 4. بررسی منتشر بودن تحویل (`delivery.status === 'published'`) و منتشر بودن پیوست (`is_published === 1`)
 * 5. بررسی وضعیت پرداخت سفارش (`PAID` و مستردنشده)
 */
export async function authorizeAndLoadCustomerAttachment(
  db: D1Database,
  input: {
    attachmentPublicId: string;
    guestToken?: string | null;
    orderPublicId?: string | null;
    authenticatedCustomer?: { id: number; email: string } | null;
  },
): Promise<
  | { ok: true; attachment: DeliveryAttachmentRow; order: Order }
  | { ok: false; status: 403 | 404; error: string }
> {
  const attId = input.attachmentPublicId.trim().toLowerCase();
  if (!attId.startsWith('datt_')) {
    return { ok: false, status: 404, error: 'فایل مورد نظر یافت نشد.' };
  }

  let authorizedOrder: Order | null = null;

  if (input.guestToken) {
    const token = input.guestToken.trim();
    if (!isAccessToken(token)) {
      return { ok: false, status: 404, error: 'لینک سفارش معتبر نیست.' };
    }
    const access = await resolveAccessToken(db, token);
    if (!access) {
      return { ok: false, status: 404, error: 'لینک سفارش معتبر نیست یا منقضی شده است.' };
    }
    authorizedOrder = await getOrderByPublicId(db, access.order_public_id);
  } else if (input.authenticatedCustomer && input.orderPublicId) {
    const candidate = await getOrderByPublicId(db, input.orderPublicId.trim().toLowerCase());
    if (
      candidate &&
      (candidate.customer_id === input.authenticatedCustomer.id ||
        (candidate.email &&
          candidate.email.trim().toLowerCase() ===
            input.authenticatedCustomer.email.trim().toLowerCase()))
    ) {
      authorizedOrder = candidate;
    } else {
      return { ok: false, status: 403, error: 'شما مجوز دسترسی به فایل‌های این سفارش را ندارید.' };
    }
  }

  if (!authorizedOrder) {
    return { ok: false, status: 404, error: 'سفارش یافت نشد یا دسترسی مجاز نیست.' };
  }

  const latestTx = await getLatestOrderPaymentTxInfo(db, authorizedOrder.public_id);
  const gate = canOrderBeFulfilled(authorizedOrder, latestTx);
  if (!gate.allowed) {
    return { ok: false, status: 403, error: gate.reason ?? 'پرداخت سفارش تایید نشده است.' };
  }

  const row = await db
    .prepare(
      `SELECT da.*
         FROM delivery_attachments da
         JOIN order_item_deliveries oid ON oid.id = da.delivery_id
        WHERE da.public_id = ?
          AND da.order_id = ?
          AND oid.order_id = ?
          AND da.order_item_id = oid.order_item_id
          AND da.removed_at IS NULL
          AND da.is_published = 1
          AND oid.status = 'published'`,
    )
    .bind(attId, authorizedOrder.id, authorizedOrder.id)
    .first<DeliveryAttachmentRow>();

  if (!row) {
    return {
      ok: false,
      status: 404,
      error: 'فایل پیوست یافت نشد یا هنوز منتشر نشده است.',
    };
  }

  await db
    .prepare(
      'UPDATE delivery_attachments SET download_count = download_count + 1 WHERE id = ?',
    )
    .bind(row.id)
    .run();

  return { ok: true, attachment: row, order: authorizedOrder };
}

/**
 * آمار زنده داشبورد تحویل سفارش‌ها (`/admin/fulfillment`) مستقیماً از دیتابیس D1
 */
export interface FulfillmentDashboardStats {
  unfulfilledCount: number;
  processingCount: number;
  readyCount: number;
  partialCount: number;
  fulfilledCount: number;
  delayedCount: number;
}

const VERIFIED_ORDER_SQL_CONDITION = `o.status = 'paid' AND o.refunded_cents < o.amount_total_cents AND NOT EXISTS (
  SELECT 1 FROM payment_transactions pt
   WHERE pt.target_type = 'order'
     AND pt.target_public_id = o.public_id
     AND pt.id = (
       SELECT MAX(pt2.id) FROM payment_transactions pt2
        WHERE pt2.target_type = 'order' AND pt2.target_public_id = o.public_id
     )
     AND pt.status != 'VERIFIED'
)`;

export async function getFulfillmentDashboardStats(
  db: D1Database,
): Promise<FulfillmentDashboardStats> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN ${VERIFIED_ORDER_SQL_CONDITION} AND o.fulfillment_status = 'unfulfilled' THEN 1 ELSE 0 END), 0) AS unfulfilled_count,
         COALESCE(SUM(CASE WHEN ${VERIFIED_ORDER_SQL_CONDITION} AND o.fulfillment_status = 'processing' THEN 1 ELSE 0 END), 0) AS processing_count,
         COALESCE(SUM(CASE WHEN ${VERIFIED_ORDER_SQL_CONDITION} AND o.fulfillment_status = 'ready_for_delivery' THEN 1 ELSE 0 END), 0) AS ready_count,
         COALESCE(SUM(CASE WHEN ${VERIFIED_ORDER_SQL_CONDITION} AND o.fulfillment_status = 'partially_fulfilled' THEN 1 ELSE 0 END), 0) AS partial_count,
         COALESCE(SUM(CASE WHEN o.fulfillment_status = 'fulfilled' THEN 1 ELSE 0 END), 0) AS fulfilled_count,
         COALESCE(SUM(CASE WHEN ${VERIFIED_ORDER_SQL_CONDITION} AND o.fulfillment_status != 'fulfilled' AND o.fulfillment_status != 'cancelled' AND o.created_at <= datetime('now', '-2 hours') THEN 1 ELSE 0 END), 0) AS delayed_count
       FROM orders o`,
    )
    .first<{
      unfulfilled_count: number;
      processing_count: number;
      ready_count: number;
      partial_count: number;
      fulfilled_count: number;
      delayed_count: number;
    }>();

  return {
    unfulfilledCount: row?.unfulfilled_count ?? 0,
    processingCount: row?.processing_count ?? 0,
    readyCount: row?.ready_count ?? 0,
    partialCount: row?.partial_count ?? 0,
    fulfilledCount: row?.fulfilled_count ?? 0,
    delayedCount: row?.delayed_count ?? 0,
  };
}

export interface FulfillmentQueueFilters {
  q?: string | null;
  search?: string | null;
  customer?: string | null;
  product?: string | null;
  method?: string | null;
  fulfillment?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  delayedOnly?: boolean;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
}

export interface FulfillmentQueueOrderRow extends Order {
  item_count: number;
  fulfilled_item_count: number;
  items_summary: string | null;
  customer_name: string | null;
}

export function buildFulfillmentQueueWhere(filters: FulfillmentQueueFilters): {
  whereSql: string;
  params: (string | number)[];
} {
  // فقط سفارش‌های پرداخت‌شده و تاییدشده (PAID) و مستردنشده در صف تحویل قرار می‌گیرند
  const clauses: string[] = [VERIFIED_ORDER_SQL_CONDITION];
  const params: (string | number)[] = [];

  const q = (filters.q ?? filters.search ?? '').trim().replace(/^#/, '');
  if (q) {
    clauses.push(
      '(o.public_id LIKE ? OR CAST(o.id AS TEXT) = ? OR o.email LIKE ? OR EXISTS (SELECT 1 FROM customers c WHERE (c.id = o.customer_id OR lower(c.email) = lower(o.email)) AND (c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)))',
    );
    params.push(`%${q}%`, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const customer = (filters.customer ?? '').trim();
  if (customer) {
    clauses.push(
      '(o.email LIKE ? OR EXISTS (SELECT 1 FROM customers c WHERE (c.id = o.customer_id OR lower(c.email) = lower(o.email)) AND (c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)))',
    );
    params.push(`%${customer}%`, `%${customer}%`, `%${customer}%`, `%${customer}%`);
  }

  const product = (filters.product ?? '').trim();
  if (product) {
    clauses.push(
      'EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.name LIKE ?)',
    );
    params.push(`%${product}%`);
  }

  const method = (filters.method ?? '').trim();
  if (method) {
    clauses.push('o.payment_method = ?');
    params.push(method);
  }

  const fulfillment = (filters.fulfillment ?? '').trim();
  if (fulfillment === 'delayed') {
    clauses.push(
      "o.fulfillment_status NOT IN ('fulfilled', 'cancelled') AND o.created_at <= datetime('now', '-2 hours')",
    );
  } else if (
    fulfillment === 'unfulfilled' ||
    fulfillment === 'processing' ||
    fulfillment === 'ready_for_delivery' ||
    fulfillment === 'partially_fulfilled' ||
    fulfillment === 'fulfilled' ||
    fulfillment === 'cancelled'
  ) {
    clauses.push('o.fulfillment_status = ?');
    params.push(fulfillment);
  }

  if (filters.delayedOnly) {
    clauses.push(
      "o.fulfillment_status NOT IN ('fulfilled', 'cancelled') AND o.created_at <= datetime('now', '-2 hours')",
    );
  }

  const dateFrom = (filters.dateFrom ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    clauses.push('date(o.created_at) >= ?');
    params.push(dateFrom);
  }

  const dateTo = (filters.dateTo ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    clauses.push('date(o.created_at) <= ?');
    params.push(dateTo);
  }

  if (typeof filters.minAmount === 'number' && Number.isFinite(filters.minAmount) && filters.minAmount > 0) {
    clauses.push('o.amount_total_cents >= ?');
    params.push(Math.round(filters.minAmount));
  }

  if (typeof filters.maxAmount === 'number' && Number.isFinite(filters.maxAmount) && filters.maxAmount > 0) {
    clauses.push('o.amount_total_cents <= ?');
    params.push(Math.round(filters.maxAmount));
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    params,
  };
}

export async function listFulfillmentQueueOrders(
  db: D1Database,
  filters: FulfillmentQueueFilters,
  limit = 25,
  offset = 0,
): Promise<{ rows: FulfillmentQueueOrderRow[]; orders: FulfillmentQueueOrderRow[]; total: number }> {
  const { whereSql, params } = buildFulfillmentQueueWhere(filters);

  let orderBy = 'o.created_at DESC, o.id DESC';
  if (filters.sort === 'oldest') orderBy = 'o.created_at ASC, o.id ASC';
  else if (filters.sort === 'amount_desc') orderBy = 'o.amount_total_cents DESC, o.id DESC';
  else if (filters.sort === 'amount_asc') orderBy = 'o.amount_total_cents ASC, o.id ASC';

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM orders o ${whereSql}`)
    .bind(...params)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(
      `SELECT o.*,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.fulfillment_status = 'fulfilled') AS fulfilled_item_count,
              (SELECT GROUP_CONCAT(oi.name, '، ') FROM order_items oi WHERE oi.order_id = o.id) AS items_summary,
              (SELECT c.full_name FROM customers c WHERE c.id = o.customer_id OR lower(c.email) = lower(o.email) LIMIT 1) AS customer_name
         FROM orders o
         ${whereSql}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all<FulfillmentQueueOrderRow>();

  const rows = results ?? [];
  return {
    rows,
    orders: rows,
    total: countRow?.n ?? 0,
  };
}

export interface RecentDeliverySummary {
  delivery_public_id: string;
  order_public_id: string | null;
  order_id: number;
  customer_email: string | null;
  item_name: string;
  current_version: number;
  published_by: string | null;
  published_at: string;
}

export async function listRecentPublishedDeliveries(
  db: D1Database,
  limit = 8,
): Promise<RecentDeliverySummary[]> {
  const { results } = await db
    .prepare(
      `SELECT oid.public_id AS delivery_public_id,
              o.public_id AS order_public_id,
              o.id AS order_id,
              o.email AS customer_email,
              oi.name AS item_name,
              oid.current_version,
              oid.published_by,
              oid.published_at
         FROM order_item_deliveries oid
         JOIN orders o ON o.id = oid.order_id
         JOIN order_items oi ON oi.id = oid.order_item_id
        WHERE oid.status = 'published' AND oid.published_at IS NOT NULL
        ORDER BY oid.published_at DESC, oid.id DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<RecentDeliverySummary>();
  return results ?? [];
}
