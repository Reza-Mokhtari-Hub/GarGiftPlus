import { describe, expect, it } from 'vitest';
import { fa } from './fa';

describe('Persian localization dictionary', () => {
  it('defines all required namespaces', () => {
    const requiredNamespaces = [
      'common',
      'navigation',
      'home',
      'catalog',
      'product',
      'cart',
      'checkout',
      'payment',
      'orders',
      'orderStatus',
      'account',
      'wallet',
      'admin',
      'validation',
      'errors',
      'notifications',
      'email',
      'SEO',
    ] as const;

    for (const ns of requiredNamespaces) {
      expect(fa[ns]).toBeDefined();
      expect(typeof fa[ns]).toBe('object');
    }
  });

  it('covers all 10 GarGift+ order lifecycle statuses in Persian', () => {
    const statuses = Object.values(fa.orderStatus);
    expect(statuses.length).toBe(10);
    for (const label of statuses) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it('provides dynamic message builders without empty results', () => {
    expect(fa.catalog.resultsCount(4)).toContain('4');
    expect(fa.validation.minLength(8)).toContain('8');
    expect(fa.email.orderConfirmedSubject('1042')).toContain('1042');
  });
});
