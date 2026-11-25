import type { AstroCookies } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getSetting } from '../settings/db';
import {
  ADMIN_ACTOR_COOKIE,
  adminRowToActor,
  findAdminUserByIdentifier,
  verifyAdminActorCookie,
} from '../auth/rbac';
import { adminCredential } from '../auth/admin';
import {
  createAdminActor,
  normalizeAdminRole,
  requireAdminPermission,
  type AdminActor,
  type AdminPermission,
} from './permissions';

/**
 * استخراج هویت و نقش مدیر در درخواست‌های پنل ادمین.
 * اولویت:
 * 1. هدر تست x-admin-role (فقط در تست‌های یکپارچگی / توسعه، مشروط بر محیط تست یا DEV)
 * 2. اپراتور ذخیره‌شده در locals.adminActor (تنظیم‌شده توسط middleware)
 * 3. کوکی امضاشده admin_actor (ورود چندمدیره از جدول admin_users)
 * 4. ایمیل تاییدشده Cloudflare Access در جدول admin_users
 * 5. مدیر اصلی مالک فروشگاه (admin_default_role یا super_admin)
 */
export async function resolveAdminActor(
  db: D1Database,
  context: {
    locals?: App.Locals;
    cookies?: AstroCookies;
    request?: Request;
    signingSecret?: string;
  },
): Promise<AdminActor> {
  // 1. تست سرور-ساید مجوزهای مختلف (فقط در محیط توسعه محلی بدون کوکی احراز هویت معتبر)
  const hasAuthCookie =
    Boolean(context.cookies?.get(ADMIN_ACTOR_COOKIE)?.value) ||
    Boolean(context.cookies?.get('admin_session')?.value);
  const headerRole = context.request?.headers.get('x-admin-role');
  if (import.meta.env.DEV && !hasAuthCookie && headerRole) {
    const emailFromAccess = context.locals?.adminEmail;
    return createAdminActor(emailFromAccess || 'admin', normalizeAdminRole(headerRole), {
      displayName: 'اپراتور تست RBAC',
    });
  }

  // 2. کش‌شده در middleware
  if (context.locals?.adminActor) {
    return context.locals.adminActor;
  }

  // 3. نشست امضاشده کاربر چندمدیره
  const actorCookie = context.cookies?.get(ADMIN_ACTOR_COOKIE)?.value ?? null;
  if (actorCookie) {
    let signingKey = context.signingSecret ?? '';
    if (!signingKey) {
      const cred = await adminCredential(db);
      signingKey = cred.tagSource || 'dev-fallback';
    }
    if (signingKey) {
      const actor = await verifyAdminActorCookie(db, actorCookie, signingKey, Date.now() / 1000);
      if (actor) return actor;
    }
  }

  // 4. تطبیق با جدول admin_users بر اساس ایمیل Cloudflare Access
  const emailFromAccess = context.locals?.adminEmail;
  if (emailFromAccess) {
    const matched = await findAdminUserByIdentifier(db, emailFromAccess);
    if (matched) {
      if (matched.is_active !== 1) {
        return createAdminActor(matched.email, 'none', {
          publicId: matched.public_id,
          displayName: matched.display_name,
          email: matched.email,
        });
      }
      return adminRowToActor(matched);
    }
  }

  // 5. مالک اصلی پنل (گذرواژه setup wizard یا دسترسی پیش‌فرض)
  const configuredRole = await getSetting(db, 'admin_default_role');
  const role = configuredRole ? normalizeAdminRole(configuredRole) : 'super_admin';
  return createAdminActor(emailFromAccess || 'admin', role, {
    displayName: emailFromAccess ? emailFromAccess : 'مدیر سیستم',
    email: emailFromAccess ?? null,
    isPrimaryOwner: !configuredRole && !emailFromAccess,
  });
}

/**
 * گارد یکپارچه APIهای ادمین: در صورت نداشتن مجوز، پاسخ JSON استاندارد 401/403 برمی‌گرداند.
 */
export async function guardAdminApi(
  db: D1Database,
  context: {
    locals?: App.Locals;
    cookies?: AstroCookies;
    request?: Request;
  },
  permission: AdminPermission,
): Promise<{ ok: true; actor: AdminActor } | { ok: false; response: Response }> {
  const actor = await resolveAdminActor(db, context);
  const check = requireAdminPermission(actor, permission);
  if (!check.ok) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: check.error, code: permission }), {
        status: check.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    };
  }
  return { ok: true, actor };
}
