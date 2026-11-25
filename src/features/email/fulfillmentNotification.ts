import { formatPrice, getConfig } from '../../config';
import type { Order } from '../orders/db';
import { orderReference } from '../orders/number';
import type { EmailMessage } from './provider';
import { emailButton, emailLabel, emailShell, escapeHtml, PALETTE } from './layout';

export type FulfillmentEmailEventType =
  | 'order_accepted'
  | 'processing_started'
  | 'ready_for_delivery'
  | 'partial_delivery'
  | 'delivery_published'
  | 'order_fulfilled';

export interface ParsedFulfillmentNotificationKind {
  eventType: FulfillmentEmailEventType;
  itemPublicId: string | null;
  versionNumber: number | null;
}

/**
 * پارس کردن کلید Outbox مربوط به اعلان‌های تحویل سفارش:
 * - fulfillment-accepted
 * - fulfillment-processing
 * - fulfillment-ready
 * - fulfillment-partial:<itemPublicId>:v<version>
 * - fulfillment-published:<itemPublicId>:v<version>
 * - fulfillment-completed:v<version>
 */
export function parseFulfillmentNotificationKind(
  kind: string,
): ParsedFulfillmentNotificationKind | null {
  if (!kind.startsWith('fulfillment-')) return null;
  if (kind === 'fulfillment-accepted') {
    return { eventType: 'order_accepted', itemPublicId: null, versionNumber: null };
  }
  if (kind === 'fulfillment-processing') {
    return { eventType: 'processing_started', itemPublicId: null, versionNumber: null };
  }
  if (kind === 'fulfillment-ready') {
    return { eventType: 'ready_for_delivery', itemPublicId: null, versionNumber: null };
  }

  const partialMatch = /^fulfillment-partial:([a-z0-9_-]+):v(\d+)$/i.exec(kind);
  if (partialMatch) {
    return {
      eventType: 'partial_delivery',
      itemPublicId: partialMatch[1],
      versionNumber: Number(partialMatch[2]),
    };
  }

  const publishedMatch = /^fulfillment-published:([a-z0-9_-]+):v(\d+)$/i.exec(kind);
  if (publishedMatch) {
    return {
      eventType: 'delivery_published',
      itemPublicId: publishedMatch[1],
      versionNumber: Number(publishedMatch[2]),
    };
  }

  const completedMatch = /^fulfillment-completed:v(\d+)$/i.exec(kind);
  if (completedMatch) {
    return {
      eventType: 'order_fulfilled',
      itemPublicId: null,
      versionNumber: Number(completedMatch[1]),
    };
  }

  return null;
}

export function buildFulfillmentNotificationKind(input: {
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

/**
 * ساخت ایمیل اطلاع‌رسانی فارسی تحویل سفارش.
 *
 * امنیت: به صورت پیش‌فرض و اجباری هیچ‌گاه کد گیفت‌کارت، لایسنس، کلید فعال‌سازی
 * یا اطلاعات محرمانه در متن ایمیل قرار نمی‌گیرد؛ مشتری صرفاً از طریق لینک امن سفارش
 * وارد صفحه اختصاصی خود می‌شود.
 */
export function buildFulfillmentNotificationEmail(input: {
  order: Order;
  storeName: string;
  eventType: FulfillmentEmailEventType;
  secureOrderUrl: string | null;
  itemName?: string | null;
}): EmailMessage {
  const { order, storeName, eventType, secureOrderUrl, itemName } = input;
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const totalFormatted = formatPrice(order.amount_total_cents, order.currency);

  let subjectTitle = 'به‌روزرسانی وضعیت سفارش';
  let heading = 'وضعیت سفارش شما به‌روزرسانی شد';
  let mainMessage =
    'سفارش شما آماده تحویل است. برای مشاهده اطلاعات خرید وارد صفحه سفارش خود شوید.';

  switch (eventType) {
    case 'order_accepted':
      subjectTitle = 'پذیرش سفارش در صف پردازش';
      heading = 'سفارش شما تایید و در صف پردازش قرار گرفت';
      mainMessage =
        'پرداخت سفارش شما تایید شده و سفارش در نوبت آماده‌سازی توسط کارشناسان GarGift+ قرار گرفته است.';
      break;
    case 'processing_started':
      subjectTitle = 'آغاز پردازش و آماده‌سازی سفارش';
      heading = 'سفارش شما در حال پردازش است';
      mainMessage =
        'کارشناسان واحد تحویل در حال آماده‌سازی محصول دیجیتال یا انجام سفارش شما هستند. به محض تکمیل، اطلاع‌رسانی خواهد شد.';
      break;
    case 'ready_for_delivery':
      subjectTitle = 'آماده تحویل بودن سفارش';
      heading = 'اطلاعات خرید شما آماده تحویل است';
      mainMessage =
        'سفارش شما آماده تحویل است. برای مشاهده اطلاعات خرید وارد صفحه سفارش خود شوید.';
      break;
    case 'partial_delivery':
      subjectTitle = 'تحویل بخشی از سفارش';
      heading = 'بخشی از سفارش شما تحویل داده شد';
      mainMessage = itemName
        ? `آیتم «${itemName}» از سفارش شما آماده و تحویل داده شد. برای مشاهده اطلاعات خرید وارد صفحه سفارش خود شوید. سایر اقلام سفارش نیز در حال تکمیل هستند.`
        : 'بخشی از اقلام سفارش شما آماده تحویل است. برای مشاهده اطلاعات خرید وارد صفحه سفارش خود شوید.';
      break;
    case 'delivery_published':
      subjectTitle = 'آماده شدن اطلاعات خرید';
      heading = 'سفارش شما آماده تحویل است';
      mainMessage = itemName
        ? `اطلاعات خرید آیتم «${itemName}» منتشر شد. سفارش شما آماده تحویل است. برای مشاهده اطلاعات خرید وارد صفحه سفارش خود شوید.`
        : 'سفارش شما آماده تحویل است. برای مشاهده اطلاعات خرید وارد صفحه سفارش خود شوید.';
      break;
    case 'order_fulfilled':
      subjectTitle = 'تحویل کامل سفارش';
      heading = 'محصول شما تحویل داده شد';
      mainMessage =
        'سفارش شما آماده تحویل است و تمامی اقلام آن تکمیل گردید. برای مشاهده اطلاعات خرید و دانلود فایل‌ها وارد صفحه سفارش خود شوید.';
      break;
  }

  const securityNote =
    'به‌منظور حفظ امنیت حساب شما، کدهای گیفت‌کارت، کلیدهای فعال‌سازی و فایل‌های پیوست در متن ایمیل ارسال نمی‌شوند و فقط از طریق صفحه امن سفارش قابل مشاهده هستند.';

  const textLines = [
    `${heading} — ${storeName}`,
    ``,
    `شماره سفارش: #${num}`,
    `مبلغ سفارش: ${totalFormatted}`,
    ...(itemName ? [`محصول: ${itemName}`] : []),
    ``,
    mainMessage,
    ``,
    securityNote,
    ...(secureOrderUrl ? [``, `مشاهده صفحه امن سفارش: ${secureOrderUrl}`] : []),
  ];

  const htmlBody =
    emailLabel('جزئیات سفارش') +
    `<p dir="rtl" style="margin:0 0 14px;font-size:14px;line-height:1.8;text-align:right;">
      شماره سفارش: <strong>#${escapeHtml(String(num))}</strong><br>
      مبلغ کل: <strong>${escapeHtml(totalFormatted)}</strong>
      ${itemName ? `<br>آیتم: <strong>${escapeHtml(itemName)}</strong>` : ''}
    </p>` +
    `<p dir="rtl" style="margin:0 0 14px;font-size:14px;line-height:1.8;text-align:right;">${escapeHtml(mainMessage)}</p>` +
    `<p dir="rtl" style="margin:0 0 18px;padding:12px;border-radius:8px;background:${PALETTE.paper};font-size:12px;line-height:1.7;color:${PALETTE.muted};text-align:right;">${escapeHtml(securityNote)}</p>` +
    (secureOrderUrl ? emailButton(secureOrderUrl, 'مشاهده اطلاعات خرید در صفحه سفارش') : '');

  return {
    to: order.email!,
    subject: `${subjectTitle} #${num} - ${storeName}`,
    html: emailShell({
      storeName,
      heading,
      subheading: `سفارش #${num}`,
      body: htmlBody,
      footer: 'این پیام به‌صورت خودکار از سامانه تحویل سفارش GarGift+ ارسال شده است.',
    }),
    text: textLines.join('\n'),
  };
}
