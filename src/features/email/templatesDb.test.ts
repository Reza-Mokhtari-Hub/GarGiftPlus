import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EMAIL_TEMPLATES,
  isEmailTemplateEventKey,
  interpolateEmailCopy,
  renderEmailTemplatePreview,
} from './templatesDb';

describe('email templates helpers', () => {
  it('validates supported email event keys', () => {
    expect(isEmailTemplateEventKey('order_confirmed')).toBe(true);
    expect(isEmailTemplateEventKey('fulfillment_ready')).toBe(true);
    expect(isEmailTemplateEventKey('wallet_topup')).toBe(true);
    expect(isEmailTemplateEventKey('login_link')).toBe(true);
    expect(isEmailTemplateEventKey('marketing_spam')).toBe(false);
  });

  it('interpolates known placeholders and leaves unknown tokens intact', () => {
    const out = interpolateEmailCopy('سفارش #{orderRef} در {storeName} و {unknown}', {
      orderRef: 'GG-204',
      storeName: 'گرگیفت+',
    });
    expect(out).toBe('سفارش #GG-204 در گرگیفت+ و {unknown}');
  });

  it('renders safe preview from template definition', () => {
    const preview = renderEmailTemplatePreview(DEFAULT_EMAIL_TEMPLATES.wallet_topup, {
      amount: '۲۵۰٬۰۰۰ تومان',
      storeName: 'گرگیفت+',
    });
    expect(preview.subject).toContain('۲۵۰٬۰۰۰ تومان');
    expect(preview.intro).toContain('گرگیفت+');
  });
});
