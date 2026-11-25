import { describe, expect, it } from 'vitest';
import {
  buildCustomerOrderTimeline,
  canOrderBeFulfilled,
  deriveAggregateOrderFulfillmentStatus,
  toDbItemFulfillmentStatus,
  toDbOrderFulfillmentStatus,
  toOrderFulfillmentState,
} from './status';
import {
  computeDeliveryPayloadHash,
  isSafeActivationUrl,
  parseAndValidateDeliverySections,
  renderSafeInstructionsHtml,
  summarizeSectionsForAudit,
} from './sections';
import {
  buildDeliveryAttachmentKey,
  buildPrivateDownloadHeaders,
  sanitizeAttachmentFileName,
  validateDeliveryAttachmentBytes,
} from './files';
import {
  getPermissionsForRole,
  hasAdminPermission,
  requireAdminPermission,
  resolveAdminRole,
  type AdminActor,
} from './permissions';
import {
  buildFulfillmentNotificationEmail,
  buildFulfillmentNotificationKind,
  parseFulfillmentNotificationKind,
} from '../email/fulfillmentNotification';

describe('Phase 3 — Payment vs. Fulfillment State Separation', () => {
  it('resolves payment states accurately and never allows unpaid or review orders to be fulfilled', () => {
    // 1. Unpaid order (no order row yet)
    const unpaidGate = canOrderBeFulfilled(null, {
      status: 'INITIATED',
      method: 'zarinpal',
    });
    expect(unpaidGate.allowed).toBe(false);
    expect(unpaidGate.paymentState).toBe('PENDING_PAYMENT');

    // 2. Bank transfer receipt awaiting admin approval (PAYMENT_REVIEW)
    const reviewGate = canOrderBeFulfilled(null, {
      status: 'PENDING_VERIFICATION',
      method: 'bank_transfer',
      receipt_status: 'submitted',
    });
    expect(reviewGate.allowed).toBe(false);
    expect(reviewGate.paymentState).toBe('PAYMENT_REVIEW');

    // 3. Rejected bank transfer receipt (PAYMENT_REJECTED)
    const rejectedGate = canOrderBeFulfilled(null, {
      status: 'REJECTED',
      method: 'bank_transfer',
      receipt_status: 'rejected',
    });
    expect(rejectedGate.allowed).toBe(false);
    expect(rejectedGate.paymentState).toBe('PAYMENT_REJECTED');

    // 4. Failed gateway payment (PAYMENT_FAILED)
    const failedGate = canOrderBeFulfilled(null, {
      status: 'FAILED',
      method: 'zibal',
    });
    expect(failedGate.allowed).toBe(false);
    expect(failedGate.paymentState).toBe('PAYMENT_FAILED');

    // 5. Refunded order (REFUNDED)
    const refundedGate = canOrderBeFulfilled(
      {
        status: 'refunded',
        amount_total_cents: 500_000,
        refunded_cents: 500_000,
      },
      null,
    );
    expect(refundedGate.allowed).toBe(false);
    expect(refundedGate.paymentState).toBe('REFUNDED');

    // 6. Settled paid order (PAID / VERIFIED)
    const paidGate = canOrderBeFulfilled(
      {
        status: 'paid',
        payment_status: 'VERIFIED',
        amount_total_cents: 500_000,
        refunded_cents: 0,
      },
      { status: 'VERIFIED', method: 'wallet' },
    );
    expect(paidGate.allowed).toBe(true);
    expect(paidGate.paymentState).toBe('PAID');
  });

  it('derives aggregate order fulfillment status from per-item statuses accurately', () => {
    expect(deriveAggregateOrderFulfillmentStatus(['unfulfilled', 'unfulfilled'])).toBe('unfulfilled');
    expect(deriveAggregateOrderFulfillmentStatus(['processing', 'unfulfilled'])).toBe('processing');
    expect(deriveAggregateOrderFulfillmentStatus(['ready_for_delivery', 'unfulfilled'])).toBe('processing');
    expect(deriveAggregateOrderFulfillmentStatus(['ready_for_delivery', 'ready_for_delivery'])).toBe(
      'ready_for_delivery',
    );
    expect(deriveAggregateOrderFulfillmentStatus(['fulfilled', 'unfulfilled'])).toBe(
      'partially_fulfilled',
    );
    expect(deriveAggregateOrderFulfillmentStatus(['fulfilled', 'processing'])).toBe(
      'partially_fulfilled',
    );
    expect(deriveAggregateOrderFulfillmentStatus(['fulfilled', 'fulfilled'])).toBe('fulfilled');
    expect(deriveAggregateOrderFulfillmentStatus(['cancelled', 'cancelled'])).toBe('cancelled');
  });

  it('maps between DB status values and canonical fulfillment states', () => {
    expect(toOrderFulfillmentState('partially_fulfilled')).toBe('PARTIALLY_FULFILLED');
    expect(toOrderFulfillmentState('ready_for_delivery')).toBe('READY_FOR_DELIVERY');
    expect(toDbOrderFulfillmentStatus('PARTIALLY_FULFILLED')).toBe('partially_fulfilled');
    expect(toDbItemFulfillmentStatus('READY_FOR_DELIVERY')).toBe('ready_for_delivery');
  });

  it('builds a 5-step Persian customer order timeline', () => {
    const timeline = buildCustomerOrderTimeline({
      createdAt: '2026-04-01 10:00:00',
      paymentState: 'PAID',
      fulfillmentStatus: 'partially_fulfilled',
      processingStartedAt: '2026-04-01 10:05:00',
      readyForDeliveryAt: '2026-04-01 10:15:00',
      fulfilledAt: null,
    });
    expect(timeline).toHaveLength(5);
    expect(timeline[0].state).toBe('completed');
    expect(timeline[1].state).toBe('completed');
    expect(timeline[2].state).toBe('completed');
    expect(timeline[3].state).toBe('current');
    expect(timeline[4].state).toBe('upcoming');
  });
});

describe('Phase 3 — Delivery Sections Validation, Hashing & Safe Rendering', () => {
  it('validates structured delivery sections and rejects unsafe activation URLs', () => {
    expect(isSafeActivationUrl('https://store.steampowered.com/account/registerkey')).toBe(true);
    expect(isSafeActivationUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeActivationUrl('data:text/html,<script>alert(1)</script>')).toBe(false);

    const invalidUrlRes = parseAndValidateDeliverySections([
      {
        type: 'activation_link',
        title: 'لینک فعال‌سازی',
        url: 'javascript:alert(1)',
      },
    ]);
    expect(invalidUrlRes.ok).toBe(false);

    const validRes = parseAndValidateDeliverySections([
      {
        type: 'gift_card_code',
        title: 'کد گیفت کارت استیم',
        value: 'STEAM-XXXX-YYYY-ZZZZ',
        instructions: 'در بخش Activate a Product on Steam وارد نمایید.',
        copyable: true,
      },
      {
        type: 'activation_link',
        title: 'لینک فعال‌سازی مستقیم',
        url: 'https://store.steampowered.com/account/registerkey',
        linkLabel: 'صفحه فعال‌سازی استیم',
      },
    ]);
    expect(validRes.ok).toBe(true);
    if (validRes.ok) {
      expect(validRes.sections).toHaveLength(2);
      expect(validRes.sections[0].type).toBe('gift_card_code');
      expect(validRes.sections[0].value).toBe('STEAM-XXXX-YYYY-ZZZZ');
    }
  });

  it('escapes raw HTML/scripts in rich instructions while preserving paragraphs and bullet lists', () => {
    const raw = [
      '1. وارد حساب کاربری شوید <script>alert("xss")</script>',
      '2. گزینه Redeem Code را انتخاب کنید',
      '- ریجن اکانت باید US باشد',
    ].join('\n');

    const html = renderSafeInstructionsHtml(raw);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<p');
    expect(html).toContain('<ul');
    expect(html).toContain('Redeem Code');
  });

  it('redacts sensitive code and license values from audit log summaries', () => {
    const summary = summarizeSectionsForAudit([
      {
        id: 'sec_1',
        type: 'gift_card_code',
        title: 'کد پلی‌استیشن',
        value: 'SECRET-PSN-9999-8888',
        copyable: true,
      },
    ]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('SECRET-PSN-9999-8888');
    expect(summary.sectionCount).toBe(1);
    expect(summary.sectionTypes).toEqual(['gift_card_code']);
  });

  it('computes deterministic SHA-256 payload hashes for idempotency', async () => {
    const sections = [
      {
        id: 'sec_1',
        type: 'gift_card_code' as const,
        title: 'کد',
        value: 'ABC-123',
        copyable: true,
      },
    ];
    const h1 = await computeDeliveryPayloadHash({
      sections,
      customerNote: 'یادداشت مشتری',
      attachmentPublicIds: ['datt_1111111111'],
    });
    const h2 = await computeDeliveryPayloadHash({
      sections,
      customerNote: 'یادداشت مشتری',
      attachmentPublicIds: ['datt_1111111111'],
    });
    const h3 = await computeDeliveryPayloadHash({
      sections,
      customerNote: 'یادداشت متفاوت',
      attachmentPublicIds: ['datt_1111111111'],
    });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('Phase 3 — Private Attachment Magic Byte Validation & Headers', () => {
  it('accepts valid PDF, PNG, JPEG, WebP, GIF, and UTF-8 TXT files and rejects spoofed or executable files', async () => {
    // Valid PDF (%PDF-1.7)
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
    const pdfRes = await validateDeliveryAttachmentBytes(pdfBytes, 'voucher.pdf', 'application/pdf');
    expect(pdfRes.ok).toBe(true);

    // Valid PNG
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const pngRes = await validateDeliveryAttachmentBytes(pngBytes, 'qr-code.png', 'image/png');
    expect(pngRes.ok).toBe(true);

    // Spoofed executable or HTML disguised as .txt
    const htmlInTxt = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
    const htmlTxtRes = await validateDeliveryAttachmentBytes(htmlInTxt, 'guide.txt', 'text/plain');
    expect(htmlTxtRes.ok).toBe(false);

    // Extension mismatch (.pdf with PNG bytes)
    const mismatchRes = await validateDeliveryAttachmentBytes(pngBytes, 'fake.pdf', 'application/pdf');
    expect(mismatchRes.ok).toBe(false);

    // Disallowed extension (.exe)
    const exeRes = await validateDeliveryAttachmentBytes(pdfBytes, 'malware.exe', 'application/octet-stream');
    expect(exeRes.ok).toBe(false);
  });

  it('builds private non-guessable R2 object keys and strict private download headers', () => {
    const key = buildDeliveryAttachmentKey(
      'ord_abcdefghij',
      'oi_1234567890',
      'datt_9876543210',
      'pdf',
    );
    expect(key).toBe('deliveries/ord_abcdefghij/oi_1234567890/datt_9876543210.pdf');
    expect(sanitizeAttachmentFileName('../../etc/passwd.txt', 'txt')).toBe('.._.._etc_passwd.txt');

    const headers = buildPrivateDownloadHeaders('voucher-guide.pdf', 'application/pdf', 2048);
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-disposition']).toContain('attachment;');
  });
});

describe('Phase 3 — Granular Admin RBAC & Safe Email Notifications', () => {
  it('enforces granular admin permissions across roles', () => {
    expect(resolveAdminRole('super_admin')).toBe('super_admin');
    expect(resolveAdminRole('support_viewer')).toBe('support_viewer');

    const supportActor: AdminActor = {
      id: 'support@gargift.ir',
      role: 'support_viewer',
      permissions: getPermissionsForRole('support_viewer'),
    };
    expect(hasAdminPermission(supportActor, 'orders.view')).toBe(true);
    expect(hasAdminPermission(supportActor, 'orders.view_customer_inputs')).toBe(true);
    expect(hasAdminPermission(supportActor, 'orders.fulfill')).toBe(false);
    expect(requireAdminPermission(supportActor, 'orders.fulfill').ok).toBe(false);

    const operatorActor: AdminActor = {
      id: 'op@gargift.ir',
      role: 'fulfillment_operator',
      permissions: getPermissionsForRole('fulfillment_operator'),
    };
    expect(hasAdminPermission(operatorActor, 'orders.fulfill')).toBe(true);
    expect(hasAdminPermission(operatorActor, 'orders.edit_published_delivery')).toBe(false);
  });

  it('builds Persian fulfillment notification emails without leaking sensitive codes', () => {
    const kind = buildFulfillmentNotificationKind({
      eventType: 'delivery_published',
      itemPublicId: 'oi_1234567890',
      versionNumber: 1,
    });
    const parsed = parseFulfillmentNotificationKind(kind);
    expect(parsed).toEqual({
      eventType: 'delivery_published',
      itemPublicId: 'oi_1234567890',
      versionNumber: 1,
    });

    const msg = buildFulfillmentNotificationEmail({
      order: {
        id: 1042,
        public_id: 'ord_abcdefghij',
        provider_session_id: 'sess_1042',
        provider_payment_id: null,
        payment_method: 'wallet',
        status: 'paid',
        amount_total_cents: 2_000_000,
        currency: 'IRR',
        shipping_cents: 0,
        shipping_label: null,
        shipping_weight_grams: null,
        delivery_method: null,
        discount_cents: 0,
        tax_cents: 0,
        provider_refunded_cents: 0,
        external_refunded_cents: 0,
        refund_review_reason: null,
        refund_reviewed_at: null,
        refund_reviewed_by: null,
        refunded_cents: 0,
        email: 'buyer@example.com',
        ship_address: null,
        fulfillment_status: 'partially_fulfilled',
        tracking_carrier: null,
        tracking_number: null,
        label_url: null,
        fulfilled_at: null,
        created_at: '2026-04-01 10:00:00',
      },
      storeName: 'GarGift+',
      eventType: 'delivery_published',
      secureOrderUrl: 'https://gargift.example/order/otk_secret123',
      itemName: 'گیفت کارت استیم ۲۰ دلاری',
    });
    expect(msg.to).toBe('buyer@example.com');
    expect(msg.subject).toContain('GarGift+');
    expect(msg.html).toContain('https://gargift.example/order/otk_secret123');
    expect(msg.text).toContain('کدهای گیفت‌کارت');
  });
});
