import { describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { resolveAdminActor } from './actor';
import { ADMIN_ACTOR_COOKIE, signAdminActorCookie } from '../auth/rbac';
import { toMinorUnits, toMajorUnits, currencyDecimals } from '../../money';

function mockDb(adminRow?: {
  id: number;
  public_id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  custom_permissions_json: string | null;
  is_active: number;
  password_hash: string | null;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM admin_users') && adminRow) {
                const target = String(args[0] ?? '');
                if (target === adminRow.public_id || target === adminRow.email || target === adminRow.username) {
                  return adminRow as unknown as T;
                }
              }
              if (sql.includes("key = 'admin_password_hash'")) {
                return { value: 'salt:hash' } as unknown as T;
              }
              return null;
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              return { success: true, meta: { changes: 0 } };
            },
          };
        },
        async first<T>() {
          return null as unknown as T;
        },
      };
    },
  } as unknown as D1Database;
}

describe('resolveAdminActor RBAC hardening', () => {
  it('blocks x-admin-role header spoofing when an admin_actor cookie is present', async () => {
    const signingKey = 'test-signing-key-2026';
    const row = {
      id: 7,
      public_id: 'adm_viewer01',
      username: 'viewer01',
      email: 'viewer01@test.local',
      display_name: 'پشتیبان تست',
      role: 'support_viewer',
      custom_permissions_json: null,
      is_active: 1,
      password_hash: 'salt:hash',
    };
    const token = await signAdminActorCookie(signingKey, row as never, 3600, Date.now() / 1000);
    const db = mockDb(row);

    const req = new Request('http://localhost/api/admin/products', {
      method: 'POST',
      headers: { 'x-admin-role': 'super_admin' },
    });

    const actor = await resolveAdminActor(db, {
      request: req,
      signingSecret: signingKey,
      cookies: {
        get(name: string) {
          return name === ADMIN_ACTOR_COOKIE ? { value: token } : undefined;
        },
      } as never,
    });

    expect(actor.role).toBe('support_viewer');
    expect(actor.permissions.has('products.manage')).toBe(false);
    expect(actor.permissions.has('admins.manage')).toBe(false);
  });

  it('keeps IRT zero-decimal scaling intact for refund/shipping inputs', () => {
    expect(currencyDecimals('irt')).toBe(0);
    expect(toMinorUnits(250000, 'irt')).toBe(250000);
    expect(toMajorUnits(250000, 'irt')).toBe(250000);
    expect(toMinorUnits(12.5, 'usd')).toBe(1250);
  });
});
