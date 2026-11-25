import type { D1Database } from '@cloudflare/workers-types';
import { hashPassword, verifyPassword } from './password';
import { signSession, verifySession } from './session';
import { withPublicId } from '../ids/publicId';
import {
  createAdminActor,
  parseStrictAdminRole,
  parseCustomPermissionsJson,
  type AdminActor,
  type AdminPermission,
  type AdminRole,
} from '../fulfillment/permissions';

export interface AdminUserRow {
  id: number;
  public_id: string;
  username: string;
  email: string;
  display_name: string;
  role: AdminRole;
  custom_permissions_json: string | null;
  password_hash: string | null;
  is_active: number;
  last_login_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicAdminUser = Omit<AdminUserRow, 'id' | 'password_hash'> & {
  custom_permissions: AdminPermission[];
  has_password: boolean;
};

export const ADMIN_ACTOR_COOKIE = 'admin_actor';

export function toPublicAdminUser(row: AdminUserRow): PublicAdminUser {
  return {
    public_id: row.public_id,
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    role: parseStrictAdminRole(row.role) ?? 'none',
    custom_permissions_json: row.custom_permissions_json,
    custom_permissions: parseCustomPermissionsJson(row.custom_permissions_json),
    has_password: Boolean(row.password_hash),
    is_active: row.is_active,
    last_login_at: row.last_login_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listAdminUsers(db: D1Database): Promise<PublicAdminUser[]> {
  try {
    const { results } = await db
      .prepare('SELECT * FROM admin_users ORDER BY is_active DESC, role = \'super_admin\' DESC, created_at ASC, id ASC')
      .all<AdminUserRow>();
    return (results ?? []).map(toPublicAdminUser);
  } catch {
    return [];
  }
}

export async function getAdminUserByPublicId(
  db: D1Database,
  publicId: string,
): Promise<AdminUserRow | null> {
  try {
    return await db
      .prepare('SELECT * FROM admin_users WHERE public_id = ?')
      .bind(publicId)
      .first<AdminUserRow>();
  } catch {
    return null;
  }
}

export async function findAdminUserByIdentifier(
  db: D1Database,
  identifier: string,
): Promise<AdminUserRow | null> {
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;
  try {
    return await db
      .prepare('SELECT * FROM admin_users WHERE LOWER(email) = ? OR LOWER(username) = ?')
      .bind(clean, clean)
      .first<AdminUserRow>();
  } catch {
    return null;
  }
}

export async function countActiveSuperAdmins(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM admin_users WHERE role = 'super_admin' AND is_active = 1`)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function createAdminUser(
  db: D1Database,
  input: {
    username: string;
    email: string;
    displayName: string;
    role: AdminRole;
    password?: string | null;
    customPermissions?: AdminPermission[];
    createdBy?: string | null;
  },
): Promise<PublicAdminUser> {
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const pwHash = input.password && input.password.trim() ? await hashPassword(input.password) : null;
  const customJson =
    input.customPermissions && input.customPermissions.length > 0
      ? JSON.stringify(input.customPermissions)
      : null;

  const created = await withPublicId('adminUser', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO admin_users
           (public_id, username, email, display_name, role, custom_permissions_json, password_hash, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
         RETURNING *`,
      )
      .bind(publicId, username, email, displayName, input.role, customJson, pwHash, input.createdBy ?? null)
      .first<AdminUserRow>();
    if (!row) throw new Error('ایجاد کاربر مدیر ناموفق بود.');
    return row;
  });
  return toPublicAdminUser(created);
}

export async function updateAdminUser(
  db: D1Database,
  publicId: string,
  input: {
    displayName?: string;
    role?: AdminRole;
    isActive?: boolean;
    customPermissions?: AdminPermission[];
    password?: string | null;
  },
): Promise<PublicAdminUser | null> {
  const existing = await getAdminUserByPublicId(db, publicId);
  if (!existing) return null;

  const nextDisplayName = input.displayName !== undefined ? input.displayName.trim() : existing.display_name;
  const nextRole = input.role ?? (parseStrictAdminRole(existing.role) ?? 'none');
  const nextActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active;
  const nextCustomJson =
    input.customPermissions !== undefined
      ? input.customPermissions.length > 0
        ? JSON.stringify(input.customPermissions)
        : null
      : existing.custom_permissions_json;
  const nextHash =
    input.password && input.password.trim()
      ? await hashPassword(input.password)
      : existing.password_hash;

  const updated = await db
    .prepare(
      `UPDATE admin_users
          SET display_name = ?,
              role = ?,
              is_active = ?,
              custom_permissions_json = ?,
              password_hash = ?,
              updated_at = datetime('now')
        WHERE public_id = ?
        RETURNING *`,
    )
    .bind(nextDisplayName, nextRole, nextActive, nextCustomJson, nextHash, publicId)
    .first<AdminUserRow>();
  return updated ? toPublicAdminUser(updated) : null;
}

export async function touchAdminUserLogin(db: D1Database, publicId: string): Promise<void> {
  try {
    await db
      .prepare(`UPDATE admin_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE public_id = ?`)
      .bind(publicId)
      .run();
  } catch {
    // Non-fatal bookkeeping
  }
}

export async function verifyAdminUserPassword(
  row: AdminUserRow,
  password: string,
): Promise<boolean> {
  if (!row.password_hash || row.is_active !== 1) return false;
  return verifyPassword(password, row.password_hash);
}

/**
 * توکن امضاشده کوکی اپراتور برای احراز هویت چندمدیره:
 * فرمت: `<publicId>|<sessionToken>`
 * Credential tag بر اساس `password_hash + role + is_active` محاسبه می‌شود تا با تغییر رمز یا تعلیق اپراتور، نشست فوری ابطال گردد.
 */
export function adminUserCredentialTagSource(row: Pick<AdminUserRow, 'public_id' | 'password_hash' | 'role' | 'is_active'>): string {
  return `${row.public_id}:${row.role}:${row.is_active}:${row.password_hash ?? ''}`;
}

export async function signAdminActorCookie(
  signingKey: string,
  row: AdminUserRow,
  ttlSeconds: number,
  nowSeconds: number,
): Promise<string> {
  const token = await signSession(
    signingKey,
    adminUserCredentialTagSource(row),
    ttlSeconds,
    nowSeconds,
  );
  return `${row.public_id}|${token}`;
}

export async function verifyAdminActorCookie(
  db: D1Database,
  cookieValue: string | null | undefined,
  signingKey: string,
  nowSeconds: number,
): Promise<AdminActor | null> {
  if (!cookieValue) return null;
  const sep = cookieValue.indexOf('|');
  if (sep <= 0) return null;
  const publicId = cookieValue.slice(0, sep);
  const token = cookieValue.slice(sep + 1);
  if (!publicId.startsWith('adm_')) return null;

  const user = await getAdminUserByPublicId(db, publicId);
  if (!user || user.is_active !== 1) return null;

  const ok = await verifySession(token, signingKey, adminUserCredentialTagSource(user), nowSeconds);
  if (!ok) return null;

  return adminRowToActor(user);
}

export function adminRowToActor(user: AdminUserRow): AdminActor {
  return createAdminActor(user.email || user.username, parseStrictAdminRole(user.role) ?? 'none', {
    publicId: user.public_id,
    displayName: user.display_name,
    email: user.email,
    isPrimaryOwner: false,
    customPermissions: parseCustomPermissionsJson(user.custom_permissions_json),
  });
}
