import type { D1Database } from '@cloudflare/workers-types';

export const EMAIL_TEMPLATE_EVENTS = [
  'order_confirmed',
  'fulfillment_ready',
  'wallet_topup',
  'login_link',
] as const;

export type EmailTemplateEventKey = (typeof EMAIL_TEMPLATE_EVENTS)[number];

export interface EmailTemplateRow {
  id?: number;
  event_key: EmailTemplateEventKey;
  title: string;
  subject: string;
  heading: string;
  intro: string;
  cta_label: string;
  footer_note: string;
  is_active: number;
  updated_by?: string | null;
  updated_at?: string;
}

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateEventKey, EmailTemplateRow> = {
  order_confirmed: {
    event_key: 'order_confirmed',
    title: 'تایید ثبت و پرداخت سفارش',
    subject: 'تایید سفارش #{orderRef} در {storeName}',
    heading: 'سفارش شما با موفقیت ثبت شد',
    intro:
      'از خرید شما در {storeName} سپاسگزاریم. سفارش شما در صف پردازش قرار گرفته و پس از آماده‌سازی توسط تیم تحویل، اطلاع‌رسانی خواهد شد.',
    cta_label: 'مشاهده و پیگیری سفارش',
    footer_note:
      'برای پیگیری وضعیت سفارش در هر زمان می‌توانید از دکمه بالا یا پنل حساب کاربری خود استفاده کنید.',
    is_active: 1,
  },
  fulfillment_ready: {
    event_key: 'fulfillment_ready',
    title: 'اعلان تکمیل و آماده بودن تحویل سفارش',
    subject: 'سفارش #{orderRef} آماده تحویل است — {storeName}',
    heading: 'اطلاعات سفارش شما آماده است',
    intro:
      'سفارش شما توسط تیم تحویل {storeName} پردازش و تکمیل شد. به منظور حفظ امنیت، کدها و فایل‌های پیوست فقط از طریق صفحه امن سفارش قابل مشاهده هستند.',
    cta_label: 'مشاهده اطلاعات تحویل',
    footer_note: 'هرگز اطلاعات محرمانه خود را در اختیار دیگران قرار ندهید.',
    is_active: 1,
  },
  wallet_topup: {
    event_key: 'wallet_topup',
    title: 'تایید شارژ کیف پول کاربری',
    subject: 'شارژ کیف پول به مبلغ {amount} تایید شد — {storeName}',
    heading: 'کیف پول شما شارژ شد',
    intro:
      'مبلغ {amount} با موفقیت به کیف پول شما در {storeName} افزوده شد و هم‌اکنون قابل استفاده در خریدهای شما است.',
    cta_label: 'مشاهده کیف پول',
    footer_note: 'تاریخچه کامل تراکنش‌های کیف پول در حساب کاربری شما در دسترس است.',
    is_active: 1,
  },
  login_link: {
    event_key: 'login_link',
    title: 'لینک ورود به حساب کاربری',
    subject: 'لینک ورود یک‌بارمصرف به {storeName}',
    heading: 'ورود امن به حساب کاربری',
    intro:
      'برای ورود به حساب کاربری خود در {storeName} روی دکمه زیر کلیک کنید. این لینک تا ۱۵ دقیقه معتبر است و فقط یک‌بار قابل استفاده خواهد بود.',
    cta_label: 'ورود به حساب کاربری',
    footer_note: 'اگر شما این درخواست را ثبت نکرده‌اید، این ایمیل را نادیده بگیرید.',
    is_active: 1,
  },
};

export function isEmailTemplateEventKey(val: string): val is EmailTemplateEventKey {
  return (EMAIL_TEMPLATE_EVENTS as readonly string[]).includes(val);
}

/**
 * جایگزینی امن متغیرها در قالب ایمیل (بدون امکان اجرای اسکریپت یا HTML خام).
 */
export function interpolateEmailCopy(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return full;
    const val = vars[key];
    return val == null ? '' : String(val);
  });
}

export function renderEmailTemplatePreview(
  tpl: Pick<EmailTemplateRow, 'subject' | 'heading' | 'intro' | 'cta_label' | 'footer_note'>,
  vars: Record<string, string | number | null | undefined>,
): {
  subject: string;
  heading: string;
  intro: string;
  ctaLabel: string;
  footerNote: string;
} {
  return {
    subject: interpolateEmailCopy(tpl.subject, vars),
    heading: interpolateEmailCopy(tpl.heading, vars),
    intro: interpolateEmailCopy(tpl.intro, vars),
    ctaLabel: interpolateEmailCopy(tpl.cta_label, vars),
    footerNote: interpolateEmailCopy(tpl.footer_note, vars),
  };
}

export async function listEmailTemplates(db: D1Database): Promise<EmailTemplateRow[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM email_templates ORDER BY id ASC')
      .all<EmailTemplateRow>();
    const byKey = new Map((results ?? []).map((r) => [r.event_key, r]));
    return EMAIL_TEMPLATE_EVENTS.map((key) => byKey.get(key) ?? DEFAULT_EMAIL_TEMPLATES[key]);
  } catch {
    return EMAIL_TEMPLATE_EVENTS.map((key) => DEFAULT_EMAIL_TEMPLATES[key]);
  }
}

export async function upsertEmailTemplate(
  db: D1Database,
  input: {
    eventKey: EmailTemplateEventKey;
    subject: string;
    heading: string;
    intro: string;
    ctaLabel: string;
    footerNote: string;
    isActive: boolean;
    updatedBy: string;
  },
): Promise<void> {
  const base = DEFAULT_EMAIL_TEMPLATES[input.eventKey];
  await db
    .prepare(
      `INSERT INTO email_templates
         (event_key, title, subject, heading, intro, cta_label, footer_note, is_active, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(event_key) DO UPDATE SET
         subject = excluded.subject,
         heading = excluded.heading,
         intro = excluded.intro,
         cta_label = excluded.cta_label,
         footer_note = excluded.footer_note,
         is_active = excluded.is_active,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    )
    .bind(
      input.eventKey,
      base.title,
      input.subject.trim().slice(0, 180),
      input.heading.trim().slice(0, 180),
      input.intro.trim().slice(0, 1500),
      input.ctaLabel.trim().slice(0, 80),
      input.footerNote.trim().slice(0, 500),
      input.isActive ? 1 : 0,
      input.updatedBy,
    )
    .run();
}
