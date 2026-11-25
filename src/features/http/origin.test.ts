import { describe, expect, it } from 'vitest';
import {
  gatewayCallbackOrigin,
  isSecureRequest,
  publicOrigin,
  resolveEffectiveRequestUrl,
} from './origin';

describe('publicOrigin', () => {
  it('uses the request origin when a fresh deployment has no canonical origin', () => {
    expect(publicOrigin('https://new-store.example.workers.dev', undefined)).toBe(
      'https://new-store.example.workers.dev',
    );
  });

  it('uses and normalizes the configured HTTPS origin', () => {
    expect(publicOrigin('https://alternate.example', ' https://demo.minshop.dev/ ')).toBe(
      'https://demo.minshop.dev',
    );
  });

  it.each([
    '',
    'http://demo.minshop.dev',
    'https://demo.minshop.dev/store',
    'https://demo.minshop.dev/?preview=1',
    'https://demo.minshop.dev/#top',
    'https://user:pass@demo.minshop.dev',
  ])('rejects an unsafe configured value: %j', (configured) => {
    expect(() => publicOrigin('https://fallback.example', configured)).toThrow(
      /CANONICAL_ORIGIN/,
    );
  });
});

describe('resolveEffectiveRequestUrl', () => {
  it('applies valid x-forwarded-proto and x-forwarded-host headers', () => {
    const url = new URL('http://127.0.0.1:3000/admin/login');
    const headers = new Headers({
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'gargift.ir, proxy.internal',
    });
    const effective = resolveEffectiveRequestUrl(url, headers);
    expect(effective.origin).toBe('https://gargift.ir');
    expect(effective.pathname).toBe('/admin/login');
  });

  it.each([
    ['javascript', 'gargift.ir'],
    ['data', 'gargift.ir'],
    ['https', 'bad host name'],
    ['https', 'user:pass@evil.example'],
    ['https', 'evil.example/path'],
    ['https', 'evil.example?a=1'],
  ])('ignores malformed forwarded headers (%s / %s) without throwing', (proto, host) => {
    const url = new URL('https://shop.example/checkout');
    const headers = new Headers({
      'x-forwarded-proto': proto,
      'x-forwarded-host': host,
    });
    const effective = resolveEffectiveRequestUrl(url, headers);
    expect(effective.origin).toBe('https://shop.example');
  });
});

describe('isSecureRequest', () => {
  it('returns true for HTTPS URLs and proxied HTTPS requests', () => {
    expect(isSecureRequest(new Request('https://gargift.ir/cart'), new URL('https://gargift.ir/cart'))).toBe(true);
    expect(
      isSecureRequest(
        new Request('http://127.0.0.1:3000/cart', { headers: { 'x-forwarded-proto': 'https' } }),
        new URL('http://127.0.0.1:3000/cart'),
      ),
    ).toBe(true);
  });

  it('returns false for plain HTTP local requests', () => {
    expect(
      isSecureRequest(
        new Request('http://127.0.0.1:8791/cart'),
        new URL('http://127.0.0.1:8791/cart'),
      ),
    ).toBe(false);
  });
});

describe('gatewayCallbackOrigin', () => {
  it('uses CANONICAL_ORIGIN for non-loopback hosts and preserves loopback for local testing', () => {
    expect(
      gatewayCallbackOrigin(new URL('https://temp.workers.dev/api/checkout'), 'https://gargift.ir'),
    ).toBe('https://gargift.ir');
    expect(
      gatewayCallbackOrigin(new URL('http://127.0.0.1:8791/api/checkout'), 'https://canonical.example'),
    ).toBe('http://127.0.0.1:8791');
  });
});

