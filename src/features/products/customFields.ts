import { toEnglishDigits } from '../../lib/format.ts';

/**
 * Custom product checkout fields & FAQ definitions + strict validation.
 *
 * Pure (no Cloudflare/D1 imports) so it can be thoroughly unit-tested and used
 * consistently across admin field authoring, storefront rendering, cart/express
 * validation, and immutable order snapshots.
 *
 * SECURITY RULE: `'password'` (and any non-allowlisted type) is strictly
 * rejected at every layer so merchants can never collect customer account passwords.
 */

export const ALLOWED_FIELD_TYPES = ['text', 'email', 'number', 'select', 'textarea'] as const;
export type CheckoutFieldType = (typeof ALLOWED_FIELD_TYPES)[number];

export interface ProductCheckoutField {
  id: number;
  public_id: string | null;
  product_id: number;
  field_key: string;
  label: string;
  field_type: CheckoutFieldType;
  placeholder: string | null;
  help_text: string | null;
  options_json: string | null;
  is_required: number;
  min_length: number | null;
  max_length: number | null;
  sort_order: number;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProductCheckoutFieldInput {
  public_id: string | null;
  field_key: string;
  label: string;
  field_type: CheckoutFieldType;
  placeholder: string | null;
  help_text: string | null;
  options: string[];
  is_required: number;
  min_length: number | null;
  max_length: number | null;
  sort_order: number;
  is_active: number;
}

export interface NormalizedCustomerInput {
  key: string;
  label: string;
  type: CheckoutFieldType;
  value: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const HTML_TAG_RE = /<\/?[a-zA-Z!/?][^>]*>/;
const DANGEROUS_SCHEME_RE = /(?:javascript|data|vbscript)\s*:/i;

export function hasForbiddenMarkup(value: string): boolean {
  return HTML_TAG_RE.test(value) || DANGEROUS_SCHEME_RE.test(value);
}

/** Reject NUL bytes and unsafe ASCII control chars while keeping newlines/tabs for textarea. */
export function cleanControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function isAllowedFieldType(value: unknown): value is CheckoutFieldType {
  return typeof value === 'string' && (ALLOWED_FIELD_TYPES as readonly string[]).includes(value);
}

export function validateFieldType(rawType: unknown): { ok: true; type: CheckoutFieldType } | { ok: false; error: string } {
  const normalized = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
  if (normalized === 'password') {
    return {
      ok: false,
      error: 'استفاده از فیلد رمز عبور (password) در فیلدهای سفارشی محصول مجاز نیست.',
    };
  }
  if (!isAllowedFieldType(normalized)) {
    return {
      ok: false,
      error: `نوع فیلد «${normalized || 'نامشخص'}» مجاز نیست. انواع مجاز: متن، ایمیل، عدد، لیست انتخابی، متن چندخطی.`,
    };
  }
  return { ok: true, type: normalized };
}

export function parseFieldOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((item) => cleanControlChars(String(item ?? '')).trim()).filter(Boolean))];
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parseFieldOptions(parsed);
      } catch {
        // Fallback to line/comma splitting below
      }
    }
    return [
      ...new Set(
        trimmed
          .split(/[\n,،]+/)
          .map((item) => cleanControlChars(item).trim())
          .filter(Boolean),
      ),
    ];
  }
  return [];
}

export function fieldOptionsOf(field: Pick<ProductCheckoutField, 'options_json'>): string[] {
  if (!field.options_json) return [];
  try {
    const parsed = JSON.parse(field.options_json);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function slugifyFieldKey(labelOrKey: string): string {
  const base = labelOrKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  return /^[a-z]/.test(base) ? base.slice(0, 50) : `f_${base}`.slice(0, 50);
}

/**
 * Parse and validate custom checkout fields submitted via either:
 * 1) JSON string `checkout_fields_json` (from interactive builder), OR
 * 2) Parallel form arrays `cf_id[]`, `cf_key[]`, `cf_label[]`, `cf_type[]`, ...
 */
export function parseCheckoutFieldsForm(
  form: FormData,
): { fields: ProductCheckoutFieldInput[] } | { error: string } {
  const jsonRaw = form.get('checkout_fields_json');
  interface RawRow {
    public_id?: unknown;
    field_key?: unknown;
    label?: unknown;
    field_type?: unknown;
    placeholder?: unknown;
    help_text?: unknown;
    options?: unknown;
    is_required?: unknown;
    min_length?: unknown;
    max_length?: unknown;
    sort_order?: unknown;
    is_active?: unknown;
    remove?: unknown;
  }

  let rows: RawRow[] = [];
  if (typeof jsonRaw === 'string' && jsonRaw.trim() !== '') {
    try {
      const parsed = JSON.parse(jsonRaw);
      if (!Array.isArray(parsed)) {
        return { error: 'ساختار فیلدهای سفارشی معتبر نیست.' };
      }
      rows = parsed as RawRow[];
    } catch {
      return { error: 'فرمت JSON فیلدهای سفارشی نامعتبر است.' };
    }
  } else {
    const str = (name: string) => form.getAll(name).map((v) => String(v));
    const keys = str('cf_key');
    const labels = str('cf_label');
    const types = str('cf_type');
    const placeholders = str('cf_placeholder');
    const helps = str('cf_help');
    const options = str('cf_options');
    const requireds = str('cf_required');
    const actives = str('cf_active');
    const mins = str('cf_min_len');
    const maxs = str('cf_max_len');
    const sorts = str('cf_sort');
    const publicIds = str('cf_public_id');
    const removed = new Set(str('cf_remove').map((s) => s.trim()).filter(Boolean));

    const total = Math.max(keys.length, labels.length, types.length);
    for (let i = 0; i < total; i++) {
      const pid = (publicIds[i] ?? '').trim();
      if (pid && removed.has(pid)) continue;
      const key = (keys[i] ?? '').trim();
      const label = (labels[i] ?? '').trim();
      if (!key && !label) continue;
      rows.push({
        public_id: pid || null,
        field_key: key,
        label,
        field_type: types[i] ?? 'text',
        placeholder: placeholders[i] ?? '',
        help_text: helps[i] ?? '',
        options: options[i] ?? '',
        is_required: requireds[i] ?? '1',
        min_length: mins[i] ?? '',
        max_length: maxs[i] ?? '',
        sort_order: sorts[i] ?? String(i),
        is_active: actives[i] ?? '1',
      });
    }
  }

  const seenKeys = new Set<string>();
  const out: ProductCheckoutFieldInput[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.remove === true || row.remove === '1' || row.remove === 'on') continue;

    const label = cleanControlChars(String(row.label ?? '')).trim();
    const rawKey = cleanControlChars(String(row.field_key ?? '')).trim().toLowerCase();
    if (!label && !rawKey) continue;

    const idx = i + 1;
    if (!label) {
      return { error: `فیلد سفارشی ${idx}: عنوان فیلد الزامی است.` };
    }
    if (hasForbiddenMarkup(label)) {
      return { error: `فیلد سفارشی «${label}»: استفاده از تگ HTML یا اسکریپت در عنوان مجاز نیست.` };
    }

    const fieldKey = rawKey || slugifyFieldKey(label);
    if (!FIELD_KEY_RE.test(fieldKey)) {
      return {
        error: `فیلد «${label}»: کلید فیلد باید با حرف کوچک انگلیسی شروع شود و فقط شامل حروف انگلیسی کوچک، عدد و _ باشد (حداکثر ۵۰ کاراکتر).`,
      };
    }
    if (seenKeys.has(fieldKey)) {
      return { error: `کلید فیلد «${fieldKey}» تکراری است.` };
    }
    seenKeys.add(fieldKey);

    const typeResult = validateFieldType(row.field_type);
    if (!typeResult.ok) return { error: typeResult.error };

    const placeholder = cleanControlChars(String(row.placeholder ?? '')).trim() || null;
    const helpText = cleanControlChars(String(row.help_text ?? '')).trim() || null;
    if ((placeholder && hasForbiddenMarkup(placeholder)) || (helpText && hasForbiddenMarkup(helpText))) {
      return { error: `فیلد «${label}»: متن راهنما یا placeholder نمی‌تواند شامل کد HTML باشد.` };
    }

    const options = parseFieldOptions(row.options);
    if (options.some((opt) => hasForbiddenMarkup(opt))) {
      return { error: `فیلد «${label}»: گزینه‌های انتخابی نمی‌توانند شامل کد HTML باشند.` };
    }
    if (typeResult.type === 'select' && options.length === 0) {
      return { error: `فیلد «${label}»: برای نوع لیست انتخابی باید حداقل یک گزینه تعریف کنید.` };
    }

    const minRaw = String(row.min_length ?? '').trim();
    const maxRaw = String(row.max_length ?? '').trim();
    let minLen: number | null = null;
    let maxLen: number | null = null;
    if (minRaw !== '') {
      const n = Number(toEnglishDigits(minRaw));
      if (!Number.isInteger(n) || n < 0 || n > 5000) {
        return { error: `فیلد «${label}»: حداقل طول باید عدد صحیح نامنفی باشد.` };
      }
      minLen = n;
    }
    if (maxRaw !== '') {
      const n = Number(toEnglishDigits(maxRaw));
      if (!Number.isInteger(n) || n < 1 || n > 5000) {
        return { error: `فیلد «${label}»: حداکثر طول باید عدد صحیح مثبت باشد.` };
      }
      maxLen = n;
    }
    if (minLen !== null && maxLen !== null && minLen > maxLen) {
      return { error: `فیلد «${label}»: حداقل طول نمی‌تواند از حداکثر طول بیشتر باشد.` };
    }

    const parseFlag = (v: unknown, def: number) => {
      if (v === undefined || v === null || v === '') return def;
      if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') return 1;
      return 0;
    };

    const sortRaw = Number(toEnglishDigits(String(row.sort_order ?? i)));
    const sortOrder = Number.isInteger(sortRaw) ? sortRaw : i;

    const pidRaw = typeof row.public_id === 'string' ? row.public_id.trim().toLowerCase() : '';
    const publicId = /^pfld_[0-9abcdefghjkmnpqrstvwxyz]{10}$/.test(pidRaw) ? pidRaw : null;

    out.push({
      public_id: publicId,
      field_key: fieldKey,
      label,
      field_type: typeResult.type,
      placeholder,
      help_text: helpText,
      options: typeResult.type === 'select' ? options : [],
      is_required: parseFlag(row.is_required, 1),
      min_length: minLen,
      max_length: maxLen,
      sort_order: sortOrder,
      is_active: parseFlag(row.is_active, 1),
    });
  }

  out.sort((a, b) => a.sort_order - b.sort_order);
  return {
    fields: out.map((f, index) => ({ ...f, sort_order: index })),
  };
}

export type CustomerInputSource = FormData | URLSearchParams | Record<string, unknown>;

function readInputFromSource(source: CustomerInputSource, fieldKey: string): string {
  const formKey = `cf_${fieldKey}`;
  if (typeof FormData !== 'undefined' && source instanceof FormData) {
    const val = source.get(formKey) ?? source.get(fieldKey);
    return val == null ? '' : String(val);
  }
  if (source instanceof URLSearchParams) {
    const val = source.get(formKey) ?? source.get(fieldKey);
    return val == null ? '' : String(val);
  }
  const obj = source as Record<string, unknown>;
  const val = obj[fieldKey] ?? obj[formKey];
  return val == null ? '' : String(val);
}

/**
 * Validate customer-submitted values against a product's active custom fields.
 * Enforces allowlisted types, required/optional, length bounds, email/number/select,
 * and rejects HTML/script injection attempts.
 */
export function validateCustomerInputs(
  fields: ProductCheckoutField[],
  source: CustomerInputSource,
):
  | { ok: true; values: NormalizedCustomerInput[] }
  | { ok: false; error: string; fieldErrors: Record<string, string> } {
  const activeFields = [...fields]
    .filter((f) => f.is_active === 1)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  const values: NormalizedCustomerInput[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const field of activeFields) {
    const typeCheck = validateFieldType(field.field_type);
    if (!typeCheck.ok) {
      fieldErrors[field.field_key] = typeCheck.error;
      continue;
    }

    const raw = cleanControlChars(readInputFromSource(source, field.field_key)).trim();
    if (!raw) {
      if (field.is_required === 1) {
        fieldErrors[field.field_key] = `تکمیل فیلد «${field.label}» الزامی است.`;
      }
      continue;
    }

    if (hasForbiddenMarkup(raw)) {
      fieldErrors[field.field_key] = `مقدار «${field.label}» نباید شامل کد HTML یا اسکریپت باشد.`;
      continue;
    }

    let normalized = raw;
    if (field.field_type === 'number') {
      const latin = toEnglishDigits(raw).replace(/\s+/g, '');
      if (!NUMBER_RE.test(latin)) {
        fieldErrors[field.field_key] = `فیلد «${field.label}» باید یک عدد معتبر باشد.`;
        continue;
      }
      normalized = latin;
    } else if (field.field_type === 'email') {
      const lowered = toEnglishDigits(raw).toLowerCase();
      if (!EMAIL_RE.test(lowered)) {
        fieldErrors[field.field_key] = `لطفاً یک ایمیل معتبر برای «${field.label}» وارد کنید.`;
        continue;
      }
      normalized = lowered;
    } else if (field.field_type === 'select') {
      const opts = fieldOptionsOf(field);
      if (!opts.includes(raw)) {
        fieldErrors[field.field_key] = `گزینه انتخاب‌شده برای «${field.label}» معتبر نیست.`;
        continue;
      }
    }

    if (field.min_length != null && normalized.length < field.min_length) {
      fieldErrors[field.field_key] =
        `«${field.label}» باید حداقل ${field.min_length} کاراکتر باشد.`;
      continue;
    }
    if (field.max_length != null && normalized.length > field.max_length) {
      fieldErrors[field.field_key] =
        `«${field.label}» نباید بیشتر از ${field.max_length} کاراکتر باشد.`;
      continue;
    }

    values.push({
      key: field.field_key,
      label: field.label,
      type: field.field_type,
      value: normalized,
    });
  }

  const firstError = Object.values(fieldErrors)[0];
  if (firstError) {
    return { ok: false, error: firstError, fieldErrors };
  }
  return { ok: true, values };
}

/** Canonical deterministic fingerprint for grouping identical cart lines vs splitting different inputs. */
export function customerInputsFingerprint(values: NormalizedCustomerInput[]): string {
  const sorted = [...values]
    .map((v) => ({ k: v.key, v: v.value }))
    .sort((a, b) => a.k.localeCompare(b.k));
  return JSON.stringify(sorted);
}

/** Safely parse stored JSON from order_items.customer_inputs_json or cart_line_inputs.inputs_json. */
export function parseStoredCustomerInputs(raw: string | null | undefined): NormalizedCustomerInput[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        key: String(item.key ?? ''),
        label: String(item.label ?? item.key ?? ''),
        type: isAllowedFieldType(item.type) ? item.type : 'text',
        value: cleanControlChars(String(item.value ?? '')),
      }))
      .filter((item) => item.key !== '' && item.value !== '');
  } catch {
    return [];
  }
}

/** Parse faq_json safely. */
export function parseFaqJson(raw: string | null | undefined): FaqItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        q: cleanControlChars(String(item.q ?? '')).trim(),
        a: cleanControlChars(String(item.a ?? '')).trim(),
      }))
      .filter((item) => item.q.length > 0 && item.a.length > 0 && !hasForbiddenMarkup(item.q) && !hasForbiddenMarkup(item.a));
  } catch {
    return [];
  }
}

/** Parse FAQ rows from admin product form (`faq_q[]` + `faq_a[]` or `faq_json`). */
export function parseFaqForm(form: FormData): { faqJson: string | null } | { error: string } {
  const jsonRaw = form.get('faq_json');
  const items: FaqItem[] = [];

  if (typeof jsonRaw === 'string' && jsonRaw.trim() !== '') {
    try {
      const parsed = JSON.parse(jsonRaw);
      if (!Array.isArray(parsed)) return { error: 'ساختار پرسش‌های متداول معتبر نیست.' };
      for (const row of parsed) {
        const q = cleanControlChars(String((row as { q?: unknown })?.q ?? '')).trim();
        const a = cleanControlChars(String((row as { a?: unknown })?.a ?? '')).trim();
        if (!q && !a) continue;
        if (!q || !a) return { error: 'در بخش پرسش‌های متداول، هر دو فیلد پرسش و پاسخ باید تکمیل شوند.' };
        if (hasForbiddenMarkup(q) || hasForbiddenMarkup(a)) {
          return { error: 'پرسش و پاسخ متداول نباید شامل تگ HTML یا اسکریپت باشد.' };
        }
        items.push({ q, a });
      }
    } catch {
      return { error: 'فرمت پرسش‌های متداول نامعتبر است.' };
    }
  } else {
    const qs = form.getAll('faq_q').map((v) => cleanControlChars(String(v)).trim());
    const as = form.getAll('faq_a').map((v) => cleanControlChars(String(v)).trim());
    const total = Math.max(qs.length, as.length);
    for (let i = 0; i < total; i++) {
      const q = qs[i] ?? '';
      const a = as[i] ?? '';
      if (!q && !a) continue;
      if (!q || !a) {
        return { error: 'در بخش پرسش‌های متداول، هر دو فیلد پرسش و پاسخ باید تکمیل شوند.' };
      }
      if (hasForbiddenMarkup(q) || hasForbiddenMarkup(a)) {
        return { error: 'پرسش و پاسخ متداول نباید شامل تگ HTML یا اسکریپت باشد.' };
      }
      items.push({ q, a });
    }
  }

  return { faqJson: items.length > 0 ? JSON.stringify(items) : null };
}
