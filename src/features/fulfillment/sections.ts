/**
 * انواع محتوای تحویل دیجیتال، اعتبارسنجی، پاک‌سازی ایمن (بدون اجرای HTML/JS)
 * و تولید اثرانگشت (Hash) جهت تضمین Idempotency انتشار تحویل.
 */

export const DELIVERY_SECTION_TYPES = [
  'gift_card_code',
  'license_key',
  'activation_link',
  'custom_text',
  'rich_instructions',
] as const;

export type DeliverySectionType = (typeof DELIVERY_SECTION_TYPES)[number];

export const DELIVERY_SECTION_TYPE_LABELS: Record<DeliverySectionType, string> = {
  gift_card_code: 'کد گیفت‌کارت (Gift Card Code)',
  license_key: 'لایسنس / کلید فعال‌سازی (License Key)',
  activation_link: 'لینک فعال‌سازی / دعوت‌نامه (Activation Link)',
  custom_text: 'متن اختصاصی تحویل (Custom Text)',
  rich_instructions: 'راهنمای گام‌به‌گام و دستورالعمل (Rich Instructions)',
};

export interface DeliverySection {
  id: string;
  type: DeliverySectionType;
  title: string;
  /** مقدار کد گیفت‌کارت، کلید لایسنس، یا متن تحویل */
  value?: string;
  /** آدرس اینترنتی برای نوع activation_link */
  url?: string;
  /** متن دکمه لینک برای نوع activation_link */
  linkLabel?: string;
  /** توضیحات یا دستورالعمل‌های تکمیلی */
  instructions?: string;
  /** آیا دکمه کپی برای مشتری نمایش داده شود؟ */
  copyable?: boolean;
}

export interface ParsedDeliverySectionsResult {
  ok: boolean;
  sections: DeliverySection[];
  error?: string;
}

/**
 * پاک‌سازی کاراکترهای کنترلی غیرمجاز بدون دستکاری متن فارسی یا انگلیسی
 */
function cleanText(input: unknown, maxLength = 8000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * بررسی ایمن بودن آدرس لینک فعال‌سازی (فقط http: و https: مجاز است)
 */
export function isSafeActivationUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Escape کامل HTML تا هیچ تگ یا اسکریپتی اجرا نشود.
 */
export function escapeHtmlSafe(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * تبدیل متن راهنمای چندخطی به HTML کاملاً امن (پشتیبانی از بولت‌پوینت، مراحل شماره‌دار و خطوط جدید)
 * بدون اجازه اجرای هیچ‌گونه HTML خام یا جاوااسکریپت.
 */
export function renderSafeInstructionsHtml(raw: string | null | undefined): string {
  const cleaned = cleanText(raw ?? '', 10000);
  if (!cleaned) return '';

  const lines = cleaned.split('\n');
  const htmlBlocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      htmlBlocks.push(
        `<ul class="my-2 list-disc space-y-1 ps-5 text-xs leading-relaxed">${listItems.join('')}</ul>`,
      );
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
      const itemText = escapeHtmlSafe(line.slice(2).trim());
      listItems.push(`<li>${itemText}</li>`);
    } else {
      flushList();
      const escaped = escapeHtmlSafe(line);
      htmlBlocks.push(`<p class="my-1.5 text-xs leading-relaxed">${escaped}</p>`);
    }
  }
  flushList();

  return htmlBlocks.join('\n');
}

/**
 * اعتبارسنجی و نرمال‌سازی بخش‌های محتوای تحویل یک آیتم سفارش
 */
export function parseAndValidateDeliverySections(
  rawInput: unknown,
): ParsedDeliverySectionsResult {
  let rawArray: unknown[];
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) return { ok: true, sections: [] };
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { ok: false, sections: [], error: 'ساختار بخش‌های تحویل نامعتبر است.' };
      }
      rawArray = parsed;
    } catch {
      return { ok: false, sections: [], error: 'فرمت JSON بخش‌های تحویل معتبر نیست.' };
    }
  } else if (Array.isArray(rawInput)) {
    rawArray = rawInput;
  } else if (rawInput == null) {
    return { ok: true, sections: [] };
  } else {
    return { ok: false, sections: [], error: 'ساختار بخش‌های تحویل نامعتبر است.' };
  }

  if (rawArray.length > 25) {
    return {
      ok: false,
      sections: [],
      error: 'حداکثر ۲۵ بخش محتوایی برای هر ردیف سفارش مجاز است.',
    };
  }

  const validated: DeliverySection[] = [];

  for (let i = 0; i < rawArray.length; i++) {
    const entry = rawArray[i];
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const rawType = String(obj.type ?? '').trim() as DeliverySectionType;
    if (!(DELIVERY_SECTION_TYPES as readonly string[]).includes(rawType)) {
      return {
        ok: false,
        sections: [],
        error: `نوع بخش تحویل در ردیف ${i + 1} معتبر نیست.`,
      };
    }

    const defaultTitle = DELIVERY_SECTION_TYPE_LABELS[rawType].split(' (')[0];
    const title = cleanText(obj.title, 160) || defaultTitle;
    const value = cleanText(obj.value, 6000);
    const url = cleanText(obj.url, 2000);
    const linkLabel = cleanText(obj.linkLabel, 140);
    const instructions = cleanText(obj.instructions, 8000);
    const id = cleanText(obj.id, 64) || `sec_${i + 1}`;

    // نادیده‌گرفتن ردیف‌های کاملاً خالی در فرم
    if (!value && !url && !instructions) {
      continue;
    }

    if (rawType === 'gift_card_code') {
      if (!value) {
        return {
          ok: false,
          sections: [],
          error: `مقدار کد گیفت‌کارت در بخش «${title}» نمی‌تواند خالی باشد.`,
        };
      }
      validated.push({
        id,
        type: 'gift_card_code',
        title,
        value,
        instructions: instructions || undefined,
        copyable: true,
      });
    } else if (rawType === 'license_key') {
      if (!value) {
        return {
          ok: false,
          sections: [],
          error: `مقدار لایسنس یا کلید فعال‌سازی در بخش «${title}» نمی‌تواند خالی باشد.`,
        };
      }
      validated.push({
        id,
        type: 'license_key',
        title,
        value,
        instructions: instructions || undefined,
        copyable: true,
      });
    } else if (rawType === 'activation_link') {
      if (!url || !isSafeActivationUrl(url)) {
        return {
          ok: false,
          sections: [],
          error: `آدرس لینک فعال‌سازی در بخش «${title}» باید یک آدرس معتبر با پروتکل https:// یا http:// باشد.`,
        };
      }
      validated.push({
        id,
        type: 'activation_link',
        title,
        url,
        linkLabel: linkLabel || 'ورود به لینک فعال‌سازی',
        instructions: instructions || undefined,
        copyable: Boolean(obj.copyable ?? true),
      });
    } else if (rawType === 'custom_text') {
      const textVal = value || instructions;
      if (!textVal) {
        return {
          ok: false,
          sections: [],
          error: `متن اختصاصی تحویل در بخش «${title}» نمی‌تواند خالی باشد.`,
        };
      }
      validated.push({
        id,
        type: 'custom_text',
        title,
        value: textVal,
        instructions: value && instructions ? instructions : undefined,
        copyable: Boolean(obj.copyable ?? false),
      });
    } else if (rawType === 'rich_instructions') {
      const bodyVal = instructions || value;
      if (!bodyVal) {
        return {
          ok: false,
          sections: [],
          error: `متن راهنما در بخش «${title}» نمی‌تواند خالی باشد.`,
        };
      }
      validated.push({
        id,
        type: 'rich_instructions',
        title,
        instructions: bodyVal,
        copyable: false,
      });
    }
  }

  return { ok: true, sections: validated };
}

/**
 * پارس امن JSON ذخیره‌شده در دیتابیس برای نمایش
 */
export function parseStoredDeliverySections(json: string | null | undefined): DeliverySection[] {
  if (!json) return [];
  const res = parseAndValidateDeliverySections(json);
  return res.ok ? res.sections : [];
}

/**
 * محاسبه هش قطعی (SHA-256) از محتوای تحویل + یادداشت مشتری + لیست فایل‌های پیوست
 * برای تشخیص انتشار تکراری (Idempotent Publish) و جلوگیری از ایجاد نسخه یا ایمیل تکراری.
 */
export async function computeDeliveryPayloadHash(input: {
  sections: readonly DeliverySection[];
  customerNote?: string | null;
  attachmentPublicIds?: readonly string[];
}): Promise<string> {
  const canonical = JSON.stringify({
    sections: input.sections.map((s) => ({
      type: s.type,
      title: s.title,
      value: s.value ?? '',
      url: s.url ?? '',
      linkLabel: s.linkLabel ?? '',
      instructions: s.instructions ?? '',
      copyable: Boolean(s.copyable),
    })),
    customerNote: (input.customerNote ?? '').trim(),
    attachments: [...(input.attachmentPublicIds ?? [])].sort(),
  });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * ساخت خلاصه امن و بدون افشای کد/لایسنس برای ثبت در لاگ حسابرسی (Audit Log)
 * هرگز مقدار واقعی کد گیفت‌کارت یا کلید لایسنس در لاگ‌ها ذخیره نمی‌شود.
 */
export function summarizeSectionsForAudit(sections: readonly DeliverySection[]): {
  sectionCount: number;
  sectionTypes: DeliverySectionType[];
  titles: string[];
} {
  return {
    sectionCount: sections.length,
    sectionTypes: sections.map((s) => s.type),
    titles: sections.map((s) => s.title),
  };
}
