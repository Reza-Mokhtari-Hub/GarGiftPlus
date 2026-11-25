import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FIELD_TYPES,
  customerInputsFingerprint,
  parseCheckoutFieldsForm,
  parseFaqForm,
  parseFaqJson,
  parseStoredCustomerInputs,
  validateCustomerInputs,
  validateFieldType,
  type ProductCheckoutField,
} from './customFields';

const makeField = (overrides: Partial<ProductCheckoutField> = {}): ProductCheckoutField => ({
  id: 1,
  public_id: 'pfld_0123456789',
  product_id: 10,
  field_key: 'player_id',
  label: 'آیدی بازیکن',
  field_type: 'text',
  placeholder: 'مثال: 5123456789',
  help_text: null,
  options_json: null,
  is_required: 1,
  min_length: null,
  max_length: null,
  sort_order: 0,
  is_active: 1,
  ...overrides,
});

describe('custom checkout field types & security rules', () => {
  it('allows only text, email, number, select, and textarea', () => {
    expect(ALLOWED_FIELD_TYPES).toEqual(['text', 'email', 'number', 'select', 'textarea']);
    for (const type of ALLOWED_FIELD_TYPES) {
      expect(validateFieldType(type)).toEqual({ ok: true, type });
    }
  });

  it('strictly rejects password and non-allowlisted types', () => {
    const pwd = validateFieldType('password');
    expect(pwd.ok).toBe(false);
    if (!pwd.ok) expect(pwd.error).toContain('password');

    const upperPwd = validateFieldType(' PASSWORD ');
    expect(upperPwd.ok).toBe(false);

    expect(validateFieldType('hidden').ok).toBe(false);
    expect(validateFieldType('file').ok).toBe(false);
  });
});

describe('parseCheckoutFieldsForm', () => {
  it('parses valid JSON builder definitions and normalizes sort order', () => {
    const form = new FormData();
    form.set(
      'checkout_fields_json',
      JSON.stringify([
        {
          field_key: 'region_server',
          label: 'سرور بازی',
          field_type: 'select',
          options: 'Global\nEurope, Middle East',
          is_required: true,
          sort_order: 2,
          is_active: true,
        },
        {
          field_key: 'player_uid',
          label: 'آیدی بازیکن',
          field_type: 'number',
          min_length: '5',
          max_length: '15',
          is_required: true,
          sort_order: 1,
          is_active: true,
        },
      ]),
    );

    const parsed = parseCheckoutFieldsForm(form);
    expect('fields' in parsed).toBe(true);
    if (!('fields' in parsed)) return;

    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0].field_key).toBe('player_uid');
    expect(parsed.fields[0].sort_order).toBe(0);
    expect(parsed.fields[1].field_key).toBe('region_server');
    expect(parsed.fields[1].options).toEqual(['Global', 'Europe', 'Middle East']);
    expect(parsed.fields[1].sort_order).toBe(1);
  });

  it('rejects password type, duplicate keys, missing select options, and HTML markup', () => {
    const withPassword = new FormData();
    withPassword.set(
      'checkout_fields_json',
      JSON.stringify([{ field_key: 'acct_pass', label: 'رمز اکانت', field_type: 'password' }]),
    );
    expect('error' in parseCheckoutFieldsForm(withPassword)).toBe(true);

    const withHtml = new FormData();
    withHtml.set(
      'checkout_fields_json',
      JSON.stringify([{ field_key: 'uid', label: '<script>alert(1)</script>', field_type: 'text' }]),
    );
    expect('error' in parseCheckoutFieldsForm(withHtml)).toBe(true);

    const dupKeys = new FormData();
    dupKeys.set(
      'checkout_fields_json',
      JSON.stringify([
        { field_key: 'uid', label: 'آیدی ۱', field_type: 'text' },
        { field_key: 'uid', label: 'آیدی ۲', field_type: 'text' },
      ]),
    );
    expect('error' in parseCheckoutFieldsForm(dupKeys)).toBe(true);

    const emptySelect = new FormData();
    emptySelect.set(
      'checkout_fields_json',
      JSON.stringify([{ field_key: 'srv', label: 'سرور', field_type: 'select', options: '' }]),
    );
    expect('error' in parseCheckoutFieldsForm(emptySelect)).toBe(true);
  });
});

describe('validateCustomerInputs', () => {
  it('enforces required fields, length bounds, email format, Persian digits normalization, and select allowlist', () => {
    const fields: ProductCheckoutField[] = [
      makeField({ field_key: 'player_id', label: 'آیدی بازیکن', field_type: 'number', min_length: 4, max_length: 12 }),
      makeField({ id: 2, field_key: 'account_email', label: 'ایمیل اکانت', field_type: 'email' }),
      makeField({
        id: 3,
        field_key: 'server',
        label: 'سرور',
        field_type: 'select',
        options_json: JSON.stringify(['Global', 'Europe']),
      }),
      makeField({ id: 4, field_key: 'note', label: 'توضیحات', field_type: 'textarea', is_required: 0 }),
    ];

    const missing = validateCustomerInputs(fields, { cf_player_id: '' });
    expect(missing.ok).toBe(false);

    const badEmail = validateCustomerInputs(fields, {
      cf_player_id: '۱۲۳۴۵',
      cf_account_email: 'not-an-email',
      cf_server: 'Global',
    });
    expect(badEmail.ok).toBe(false);

    const badSelect = validateCustomerInputs(fields, {
      cf_player_id: '12345',
      cf_account_email: 'User@Example.COM',
      cf_server: 'Asia',
    });
    expect(badSelect.ok).toBe(false);

    const okRes = validateCustomerInputs(fields, {
      cf_player_id: '۵۱۲۳۴۵۶۷',
      cf_account_email: 'User@Example.COM',
      cf_server: 'Europe',
      cf_note: '',
    });
    expect(okRes.ok).toBe(true);
    if (!okRes.ok) return;
    expect(okRes.values).toEqual([
      { key: 'player_id', label: 'آیدی بازیکن', type: 'number', value: '51234567' },
      { key: 'account_email', label: 'ایمیل اکانت', type: 'email', value: 'user@example.com' },
      { key: 'server', label: 'سرور', type: 'select', value: 'Europe' },
    ]);
  });

  it('rejects HTML/script injection in customer inputs and skips inactive fields', () => {
    const fields: ProductCheckoutField[] = [
      makeField({ field_key: 'tag', label: 'تگ بازی', field_type: 'text' }),
      makeField({ id: 2, field_key: 'hidden_old', label: 'قدیمی', is_active: 0, is_required: 1 }),
    ];

    const xss = validateCustomerInputs(fields, { cf_tag: '<img src=x onerror=alert(1)>' });
    expect(xss.ok).toBe(false);

    const valid = validateCustomerInputs(fields, { cf_tag: 'Player#9988' });
    expect(valid.ok).toBe(true);
  });

  it('produces deterministic fingerprints and safely parses stored snapshots', () => {
    const a = customerInputsFingerprint([
      { key: 'b', label: 'B', type: 'text', value: '2' },
      { key: 'a', label: 'A', type: 'text', value: '1' },
    ]);
    const b = customerInputsFingerprint([
      { key: 'a', label: 'A', type: 'text', value: '1' },
      { key: 'b', label: 'B', type: 'text', value: '2' },
    ]);
    expect(a).toBe(b);
    expect(parseStoredCustomerInputs(JSON.stringify([{ key: 'a', label: 'A', type: 'email', value: 'x@y.z' }]))).toHaveLength(1);
    expect(parseStoredCustomerInputs('bad json')).toEqual([]);
  });
});

describe('FAQ form & JSON parsing', () => {
  it('validates FAQ pairs and rejects script injection', () => {
    const form = new FormData();
    form.append('faq_q', 'زمان تحویل چقدر است؟');
    form.append('faq_a', 'معمولا زیر ۳۰ دقیقه انجام می‌شود.');
    const parsed = parseFaqForm(form);
    expect('faqJson' in parsed).toBe(true);
    if ('faqJson' in parsed) {
      expect(parseFaqJson(parsed.faqJson)).toEqual([
        { q: 'زمان تحویل چقدر است؟', a: 'معمولا زیر ۳۰ دقیقه انجام می‌شود.' },
      ]);
    }

    const bad = new FormData();
    bad.append('faq_q', 'سوال <script>');
    bad.append('faq_a', 'پاسخ');
    expect('error' in parseFaqForm(bad)).toBe(true);
  });
});
