import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, withPublicId } from '../ids/publicId';
import { toEnglishDigits } from '../../lib/format';

export interface CustomerAccount {
  id: number;
  public_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  status?: 'active' | 'suspended';
  admin_notes?: string | null;
  is_verified?: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeIranPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = toEnglishDigits(raw).replace(/[\s()-]+/g, '').trim();
  if (!digits) return null;
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^\+989\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^989\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  return null;
}

export async function getCustomerByEmail(
  db: D1Database,
  email: string,
): Promise<CustomerAccount | null> {
  const addr = normalizeCustomerEmail(email);
  return db
    .prepare('SELECT * FROM customers WHERE email = ?')
    .bind(addr)
    .first<CustomerAccount>();
}

export async function getCustomerById(
  db: D1Database,
  id: number,
): Promise<CustomerAccount | null> {
  return db.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<CustomerAccount>();
}

export async function ensureCustomerByEmail(
  db: D1Database,
  email: string,
  touchLogin = false,
): Promise<CustomerAccount> {
  const addr = normalizeCustomerEmail(email);
  const existing = await getCustomerByEmail(db, addr);
  if (existing) {
    if (touchLogin) {
      await db
        .prepare(
          `UPDATE customers
              SET last_login_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(existing.id)
        .run();
      return (await getCustomerById(db, existing.id)) ?? existing;
    }
    return existing;
  }

  await withPublicId('customer', async (publicId) => {
    await db
      .prepare(
        `INSERT INTO customers (public_id, email, last_login_at)
         VALUES (?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
         ON CONFLICT(email) DO UPDATE SET
           updated_at = datetime('now'),
           last_login_at = CASE WHEN ? = 1 THEN datetime('now') ELSE customers.last_login_at END`,
      )
      .bind(publicId, addr, touchLogin ? 1 : 0, touchLogin ? 1 : 0)
      .run();
  });

  const created = await getCustomerByEmail(db, addr);
  if (!created) {
    throw new Error(`Failed to ensure customer record for ${addr}`);
  }

  // Ensure a wallet exists for this customer as well
  await db
    .prepare(
      `INSERT INTO wallets (public_id, customer_id, balance, currency)
       VALUES (?, ?, 0, 'irt')
       ON CONFLICT(customer_id) DO NOTHING`,
    )
    .bind(generatePublicId('wallet'), created.id)
    .run();

  return created;
}

export async function updateCustomerProfile(
  db: D1Database,
  customerId: number,
  input: { fullName: string | null; phone: string | null },
): Promise<CustomerAccount | null> {
  const cleanName = input.fullName ? input.fullName.trim().slice(0, 120) : null;
  const cleanPhone = input.phone ? normalizeIranPhone(input.phone) : null;
  await db
    .prepare(
      `UPDATE customers
          SET full_name = ?,
              phone = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(cleanName || null, cleanPhone, customerId)
    .run();
  return getCustomerById(db, customerId);
}

export async function updateCustomerAdmin(
  db: D1Database,
  customerId: number,
  input: {
    status?: 'active' | 'suspended';
    adminNotes?: string | null;
    fullName?: string | null;
    phone?: string | null;
  },
): Promise<CustomerAccount | null> {
  const existing = await getCustomerById(db, customerId);
  if (!existing) return null;

  const status = input.status ?? (existing.status === 'suspended' ? 'suspended' : 'active');
  const notes =
    input.adminNotes !== undefined
      ? input.adminNotes?.trim().slice(0, 1500) || null
      : existing.admin_notes ?? null;
  const fullName =
    input.fullName !== undefined
      ? input.fullName?.trim().slice(0, 120) || null
      : existing.full_name;
  const phone =
    input.phone !== undefined
      ? input.phone
        ? normalizeIranPhone(input.phone)
        : null
      : existing.phone;

  await db
    .prepare(
      `UPDATE customers
          SET status = ?,
              admin_notes = ?,
              full_name = ?,
              phone = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(status, notes, fullName, phone, customerId)
    .run();

  return getCustomerById(db, customerId);
}

export function customerDisplayName(customer: CustomerAccount | null, email: string): string {
  if (customer?.full_name && customer.full_name.trim()) {
    return customer.full_name.trim();
  }
  const local = email.split('@')[0] ?? email;
  return local.slice(0, 28);
}

export function customerInitials(customer: CustomerAccount | null, email: string): string {
  const name = customer?.full_name?.trim();
  if (name && name.length > 0) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ''}\u200c${parts[1][0] ?? ''}`;
    }
    return parts[0].slice(0, 2);
  }
  return (email.trim()[0] ?? 'کاربر').toUpperCase();
}

export async function listCustomersAdmin(
  db: D1Database,
  limit = 50,
  offset = 0,
  search?: string,
  status?: string,
): Promise<CustomerAccount[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (search && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(email) LIKE ? OR LOWER(COALESCE(full_name, '')) LIKE ? OR COALESCE(phone, '') LIKE ? OR LOWER(public_id) LIKE ?)`,
    );
    params.push(q, q, q, q);
  }
  if (status === 'active' || status === 'suspended') {
    clauses.push(`COALESCE(status, 'active') = ?`);
    params.push(status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    const { results } = await db
      .prepare(
        `SELECT * FROM customers ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all<CustomerAccount>();
    return results ?? [];
  } catch {
    const { results } = await db
      .prepare('SELECT * FROM customers ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<CustomerAccount>();
    return results ?? [];
  }
}
