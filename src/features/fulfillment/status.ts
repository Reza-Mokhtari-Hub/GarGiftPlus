/**
 * مدیریت مستقل وضعیت پرداخت و وضعیت تحویل دستی سفارش در GarGift+
 *
 * ماژول خالص بدون وابستگی به Cloudflare Runtime تا در تست‌های واحد،
 * اسکریپت‌های یکپارچگی D1 و لایه UI استفاده شود.
 */

export type OrderPaymentState =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_REVIEW'
  | 'PAYMENT_REJECTED'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'REFUNDED';

export type OrderFulfillmentState =
  | 'UNFULFILLED'
  | 'PROCESSING'
  | 'READY_FOR_DELIVERY'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'CANCELLED';

/** مقادیر ذخیره‌شده در ستون fulfillment_status جدول orders (سازگار با MinShop) */
export type DbOrderFulfillmentStatus =
  | 'unfulfilled'
  | 'processing'
  | 'ready_for_delivery'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'cancelled';

/** مقادیر ذخیره‌شده در ستون fulfillment_status جدول order_items */
export type DbItemFulfillmentStatus =
  | 'unfulfilled'
  | 'processing'
  | 'ready_for_delivery'
  | 'fulfilled'
  | 'cancelled';

export const PAYMENT_STATE_LABELS: Record<OrderPaymentState, string> = {
  PENDING_PAYMENT: 'در انتظار پرداخت',
  PAYMENT_REVIEW: 'در انتظار تایید فیش واریزی',
  PAYMENT_REJECTED: 'پرداخت رد شده',
  PAID: 'پرداخت تایید شده',
  PAYMENT_FAILED: 'پرداخت ناموفق',
  REFUNDED: 'مسترد شده',
};

export const ORDER_PAYMENT_STATE_LABELS = PAYMENT_STATE_LABELS;

export const FULFILLMENT_STATE_LABELS: Record<DbOrderFulfillmentStatus | OrderFulfillmentState, string> = {
  unfulfilled: 'در انتظار پردازش',
  processing: 'در حال آماده‌سازی',
  ready_for_delivery: 'آماده تحویل',
  partially_fulfilled: 'تحویل ناقص',
  fulfilled: 'تحویل‌شده',
  cancelled: 'لغو شده',
  UNFULFILLED: 'در انتظار پردازش',
  PROCESSING: 'در حال آماده‌سازی',
  READY_FOR_DELIVERY: 'آماده تحویل',
  PARTIALLY_FULFILLED: 'تحویل ناقص',
  FULFILLED: 'تحویل‌شده',
  CANCELLED: 'لغو شده',
};

export const ITEM_FULFILLMENT_STATE_LABELS: Record<DbItemFulfillmentStatus, string> = {
  unfulfilled: 'در انتظار پردازش',
  processing: 'در حال آماده‌سازی (پیش‌نویس)',
  ready_for_delivery: 'آماده انتشار تحویل',
  fulfilled: 'تحویل داده شده',
  cancelled: 'لغو شده',
};

export const CUSTOMER_FULFILLMENT_MESSAGES: Record<DbOrderFulfillmentStatus | OrderFulfillmentState, string> = {
  unfulfilled: 'سفارش شما ثبت شد و پرداخت شما تأیید شد. سفارش در نوبت بررسی کارشناس قرار دارد.',
  processing: 'سفارش شما در حال پردازش و آماده‌سازی توسط کارشناس است.',
  ready_for_delivery: 'اطلاعات خرید شما آماده تحویل است و به‌زودی منتشر می‌شود.',
  partially_fulfilled: 'بخشی از اقلام سفارش شما تحویل داده شد و سایر اقلام در حال تکمیل هستند.',
  fulfilled: 'محصول شما تحویل داده شد. اطلاعات و فایل‌های خرید در پایین همین صفحه قابل مشاهده است.',
  cancelled: 'این سفارش لغو شده است.',
  UNFULFILLED: 'سفارش شما ثبت شد و پرداخت شما تأیید شد. سفارش در نوبت بررسی کارشناس قرار دارد.',
  PROCESSING: 'سفارش شما در حال پردازش و آماده‌سازی توسط کارشناس است.',
  READY_FOR_DELIVERY: 'اطلاعات خرید شما آماده تحویل است و به‌زودی منتشر می‌شود.',
  PARTIALLY_FULFILLED: 'بخشی از اقلام سفارش شما تحویل داده شد و سایر اقلام در حال تکمیل هستند.',
  FULFILLED: 'محصول شما تحویل داده شد. اطلاعات و فایل‌های خرید در پایین همین صفحه قابل مشاهده است.',
  CANCELLED: 'این سفارش لغو شده است.',
};

export function toUpperFulfillmentState(
  status: string | null | undefined,
): OrderFulfillmentState {
  const normalized = (status ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'processing':
      return 'PROCESSING';
    case 'ready_for_delivery':
      return 'READY_FOR_DELIVERY';
    case 'partially_fulfilled':
      return 'PARTIALLY_FULFILLED';
    case 'fulfilled':
      return 'FULFILLED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'UNFULFILLED';
  }
}

export const toOrderFulfillmentState = toUpperFulfillmentState;

export function toDbOrderFulfillmentStatus(
  state: string | null | undefined,
): DbOrderFulfillmentStatus {
  const normalized = (state ?? '').trim().toLowerCase();
  if (
    normalized === 'unfulfilled' ||
    normalized === 'processing' ||
    normalized === 'ready_for_delivery' ||
    normalized === 'partially_fulfilled' ||
    normalized === 'fulfilled' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'unfulfilled';
}

export function toDbItemFulfillmentStatus(
  state: string | null | undefined,
): DbItemFulfillmentStatus {
  const normalized = (state ?? '').trim().toLowerCase();
  if (
    normalized === 'unfulfilled' ||
    normalized === 'processing' ||
    normalized === 'ready_for_delivery' ||
    normalized === 'fulfilled' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'unfulfilled';
}

export interface PaymentStateInputOrder {
  status: string;
  payment_status?: string | null;
  amount_total_cents: number;
  refunded_cents: number;
  payment_method?: string | null;
}

export interface PaymentStateInputTx {
  status: string;
  method?: string | null;
  receipt_status?: string | null;
}

/**
 * استخراج وضعیت دقیق پرداخت سفارش بدون اختلاط با وضعیت تحویل.
 * صرف آپلود فیش بانکی (PAYMENT_REVIEW / PENDING_VERIFICATION) هرگز به معنای PAID نیست.
 */
export function resolveOrderPaymentState(
  order: PaymentStateInputOrder | null | undefined,
  latestTx?: PaymentStateInputTx | null,
): OrderPaymentState {
  if (!order) {
    if (!latestTx) return 'PENDING_PAYMENT';
    const txSt = latestTx.status.toUpperCase();
    if (txSt === 'PAYMENT_REVIEW' || txSt === 'PENDING_VERIFICATION') return 'PAYMENT_REVIEW';
    if (txSt === 'REJECTED') return 'PAYMENT_REJECTED';
    if (txSt === 'FAILED') {
      return latestTx.receipt_status === 'rejected' ? 'PAYMENT_REJECTED' : 'PAYMENT_FAILED';
    }
    if (txSt === 'CANCELLED' || txSt === 'EXPIRED') return 'PAYMENT_FAILED';
    if (txSt === 'VERIFIED') return 'PAID';
    return 'PENDING_PAYMENT';
  }

  if (order.amount_total_cents > 0 && order.refunded_cents >= order.amount_total_cents) {
    return 'REFUNDED';
  }

  const explicitPayment = (order.payment_status ?? '').trim().toUpperCase();
  if (explicitPayment === 'REFUNDED' || order.status === 'refunded') {
    return 'REFUNDED';
  }
  if (explicitPayment === 'PAYMENT_REVIEW' || explicitPayment === 'PENDING_VERIFICATION') {
    return 'PAYMENT_REVIEW';
  }
  if (explicitPayment === 'PAYMENT_REJECTED' || explicitPayment === 'REJECTED') {
    return 'PAYMENT_REJECTED';
  }
  if (explicitPayment === 'PAYMENT_FAILED') {
    return 'PAYMENT_FAILED';
  }
  if (explicitPayment === 'PENDING_PAYMENT' || order.status === 'pending') {
    return 'PENDING_PAYMENT';
  }

  if (latestTx) {
    const txSt = latestTx.status.toUpperCase();
    if (txSt === 'PAYMENT_REVIEW' || txSt === 'PENDING_VERIFICATION') return 'PAYMENT_REVIEW';
    if (txSt === 'REJECTED') return 'PAYMENT_REJECTED';
    if (txSt === 'CREATED' || txSt === 'INITIATED') return 'PENDING_PAYMENT';
    if (txSt === 'FAILED') {
      return latestTx.receipt_status === 'rejected' ? 'PAYMENT_REJECTED' : 'PAYMENT_FAILED';
    }
    if (txSt === 'EXPIRED' || txSt === 'CANCELLED') return 'PAYMENT_FAILED';
  }

  if (
    order.status === 'paid' &&
    (explicitPayment === '' || explicitPayment === 'PAID' || explicitPayment === 'VERIFIED')
  ) {
    return 'PAID';
  }

  return 'PENDING_PAYMENT';
}

/**
 * بررسی مجاز بودن ورود سفارش به چرخه تحویل و انتشار تحویل.
 * سفارش‌های پرداخت‌نشده، در انتظار بررسی فیش، ردشده یا مستردشده هرگز قابل تحویل نیستند.
 */
export function canOrderBeFulfilled(
  order: PaymentStateInputOrder | null | undefined,
  latestTx?: PaymentStateInputTx | null,
): { allowed: boolean; paymentState: OrderPaymentState; reason?: string } {
  const paymentState = resolveOrderPaymentState(order, latestTx);
  if (!order) {
    return {
      allowed: false,
      paymentState,
      reason: 'سفارش هنوز تسویه و ثبت نهایی نشده است.',
    };
  }
  if (paymentState === 'PAYMENT_REVIEW') {
    return {
      allowed: false,
      paymentState,
      reason: 'فیش بانکی این سفارش هنوز توسط واحد مالی تایید نشده است (PAYMENT_REVIEW).',
    };
  }
  if (paymentState === 'PAYMENT_REJECTED') {
    return {
      allowed: false,
      paymentState,
      reason: 'پرداخت این سفارش رد شده است و امکان تحویل وجود ندارد.',
    };
  }
  if (paymentState === 'PENDING_PAYMENT' || paymentState === 'PAYMENT_FAILED') {
    return {
      allowed: false,
      paymentState,
      reason: 'پرداخت این سفارش تایید نشده است. تحویل فقط برای سفارش‌های پرداخت‌شده مجاز است.',
    };
  }
  if (paymentState === 'REFUNDED') {
    return {
      allowed: false,
      paymentState,
      reason: 'مبلغ این سفارش به‌طور کامل مسترد شده است و امکان تحویل وجود ندارد.',
    };
  }
  return { allowed: true, paymentState: 'PAID' };
}

/**
 * محاسبه امن وضعیت کل تحویل سفارش بر اساس وضعیت تک‌تک آیتم‌های سفارش.
 * تا زمانی که تمام آیتم‌های الزامی تحویل نشده‌اند، کل سفارش هرگز FULFILLED نمی‌شود.
 */
export function deriveAggregateOrderFulfillmentStatus(
  itemStatuses: readonly DbItemFulfillmentStatus[],
  currentOrderStatus: DbOrderFulfillmentStatus = 'unfulfilled',
): DbOrderFulfillmentStatus {
  if (currentOrderStatus === 'cancelled') return 'cancelled';
  if (itemStatuses.length === 0) return currentOrderStatus;

  const nonCancelled = itemStatuses.filter((s) => s !== 'cancelled');
  if (nonCancelled.length === 0) return 'cancelled';

  const fulfilledCount = nonCancelled.filter((s) => s === 'fulfilled').length;
  const readyCount = nonCancelled.filter((s) => s === 'ready_for_delivery').length;
  const processingCount = nonCancelled.filter((s) => s === 'processing').length;

  // همه آیتم‌های فعال تحویل شده‌اند
  if (fulfilledCount === nonCancelled.length) {
    return 'fulfilled';
  }

  // بخشی از آیتم‌ها تحویل شده و بخشی هنوز باقی مانده‌اند
  if (fulfilledCount > 0 && fulfilledCount < nonCancelled.length) {
    return 'partially_fulfilled';
  }

  // همه آیتم‌ها آماده تحویل هستند
  if (readyCount === nonCancelled.length) {
    return 'ready_for_delivery';
  }

  // حداقل یک آیتم در حال آماده‌سازی یا آماده تحویل است
  if (processingCount > 0 || readyCount > 0) {
    return 'processing';
  }

  // اگر خود سفارش قبلاً در وضعیت processing قرار گرفته باشد، حفظ شود
  if (currentOrderStatus === 'processing' || currentOrderStatus === 'ready_for_delivery') {
    return currentOrderStatus;
  }

  return 'unfulfilled';
}

export interface TimelineStep {
  key: string;
  label: string;
  description: string;
  state: 'completed' | 'current' | 'upcoming' | 'cancelled';
  timestamp?: string | null;
}

/**
 * ساخت مراحل تایم‌لاین وضعیت سفارش برای نمایش به مشتری
 */
export function buildCustomerOrderTimeline(input: {
  createdAt?: string;
  orderCreatedAt?: string;
  paymentState: OrderPaymentState;
  fulfillmentStatus: DbOrderFulfillmentStatus;
  processingStartedAt?: string | null;
  readyForDeliveryAt?: string | null;
  fulfilledAt?: string | null;
}): TimelineStep[] {
  const {
    paymentState,
    fulfillmentStatus,
    processingStartedAt,
    readyForDeliveryAt,
    fulfilledAt,
  } = input;
  const createdAt = input.createdAt ?? input.orderCreatedAt ?? '';

  if (fulfillmentStatus === 'cancelled' || paymentState === 'REFUNDED') {
    return [
      {
        key: 'created',
        label: 'ثبت سفارش',
        description: 'سفارش شما ثبت شد.',
        state: 'completed',
        timestamp: createdAt,
      },
      {
        key: 'cancelled',
        label: paymentState === 'REFUNDED' ? 'بازگشت وجه سفارش' : 'لغو سفارش',
        description:
          paymentState === 'REFUNDED'
            ? 'مبلغ این سفارش مسترد شده است.'
            : 'این سفارش لغو شده است.',
        state: 'cancelled',
      },
    ];
  }

  const isPaid = paymentState === 'PAID';
  const rankMap: Record<DbOrderFulfillmentStatus, number> = {
    unfulfilled: 1,
    processing: 2,
    ready_for_delivery: 3,
    partially_fulfilled: 3,
    fulfilled: 4,
    cancelled: 0,
  };
  const currentRank = isPaid ? rankMap[fulfillmentStatus] : 0;

  return [
    {
      key: 'created',
      label: 'ثبت سفارش',
      description: 'سفارش شما ثبت شد.',
      state: 'completed',
      timestamp: createdAt,
    },
    {
      key: 'paid',
      label: 'تأیید پرداخت',
      description: isPaid
        ? 'پرداخت شما تأیید شد.'
        : PAYMENT_STATE_LABELS[paymentState],
      state: isPaid ? (currentRank === 1 ? 'current' : 'completed') : 'current',
      timestamp: isPaid ? createdAt : null,
    },
    {
      key: 'processing',
      label: 'در حال پردازش و آماده‌سازی',
      description:
        fulfillmentStatus === 'partially_fulfilled'
          ? 'بخشی از سفارش تحویل شد و سایر اقلام در حال آماده‌سازی هستند.'
          : 'سفارش شما در حال پردازش توسط کارشناس است.',
      state:
        currentRank > 2
          ? 'completed'
          : currentRank === 2
            ? 'current'
            : 'upcoming',
      timestamp: processingStartedAt ?? null,
    },
    {
      key: 'ready',
      label:
        fulfillmentStatus === 'partially_fulfilled'
          ? 'تحویل بخشی از اقلام'
          : 'آماده تحویل',
      description: 'اطلاعات خرید شما آماده تحویل است.',
      state:
        currentRank > 3
          ? 'completed'
          : currentRank === 3
            ? 'current'
            : 'upcoming',
      timestamp: readyForDeliveryAt ?? null,
    },
    {
      key: 'fulfilled',
      label: 'تحویل نهایی سفارش',
      description: 'محصول شما تحویل داده شد.',
      state: currentRank === 4 ? 'completed' : 'upcoming',
      timestamp: fulfilledAt ?? null,
    },
  ];
}
