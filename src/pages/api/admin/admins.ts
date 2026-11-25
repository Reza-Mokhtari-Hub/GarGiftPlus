import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import {
  ADMIN_ALL_PERMISSIONS,
  canAssignAdminRole,
  canModifyTargetAdmin,
  isAdminPermission,
  parseStrictAdminRole,
  type AdminPermission,
} from '../../../features/fulfillment/permissions';
import {
  countActiveSuperAdmins,
  createAdminUser,
  findAdminUserByIdentifier,
  getAdminUserByPublicId,
  updateAdminUser,
} from '../../../features/auth/rbac';
import { parsePublicId } from '../../../features/ids/publicId';

export const prerender = false;

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function extractPermissions(form: FormData, actorPermissions: ReadonlySet<AdminPermission>): AdminPermission[] {
  const out: AdminPermission[] = [];
  for (const raw of form.getAll('custom_permissions')) {
    const val = String(raw).trim();
    if (isAdminPermission(val) && actorPermissions.has(val)) {
      out.push(val);
    }
  }
  return Array.from(new Set(out));
}

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'admins.manage');
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const action = String(form.get('_action') ?? 'create').trim();
  const back = (params: Record<string, string>) =>
    redirect(`/admin/admins?${new URLSearchParams(params).toString()}`, 303);

  if (action === 'create') {
    const username = String(form.get('username') ?? '').trim().toLowerCase();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const displayName = String(form.get('display_name') ?? '').trim();
    const roleRaw = String(form.get('role') ?? 'support_viewer');
    const role = parseStrictAdminRole(roleRaw);
    const password = String(form.get('password') ?? '').trim();
    const customPermissions = extractPermissions(form, auth.actor.permissions);

    if (!USERNAME_RE.test(username)) {
      return back({ error: 'نام کاربری باید بین ۳ تا ۴۰ کاراکتر انگلیسی (حروف کوچک، عدد، نقطه یا خط تیره) باشد.' });
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return back({ error: 'ایمیل معتبر وارد کنید.' });
    }
    if (displayName.length < 2) {
      return back({ error: 'نام نمایشی مدیر باید حداقل ۲ کاراکتر باشد.' });
    }
    if (!role) {
      return back({ error: 'نقش انتخاب‌شده معتبر نیست.' });
    }
    if (!canAssignAdminRole(auth.actor, role)) {
      return back({ error: 'شما مجاز به تخصیص نقش هم‌سطح یا بالاتر از خودتان نیستید.' });
    }
    if (password && password.length < 8) {
      return back({ error: 'گذرواژه انتخابی باید حداقل ۸ کاراکتر باشد.' });
    }
    if ((await findAdminUserByIdentifier(env.DB, username)) || (await findAdminUserByIdentifier(env.DB, email))) {
      return back({ error: 'اپراتوری با این نام کاربری یا ایمیل قبلاً ثبت شده است.' });
    }

    const created = await createAdminUser(env.DB, {
      username,
      email,
      displayName,
      role,
      password: password || null,
      customPermissions: role === 'none' ? [] : customPermissions,
      createdBy: auth.actor.id,
    });

    await recordAdminAuditLog(env.DB, {
      action: 'admin_user_created',
      module: 'admins',
      targetType: 'admin_user',
      targetId: created.public_id,
      actor: auth.actor.id,
      details: { username: created.username, role: created.role, hasPassword: created.has_password },
    });

    return back({ msg: `حساب مدیر «${created.display_name}» با موفقیت ایجاد شد.` });
  }

  if (action === 'update') {
    const publicId = parsePublicId(form.get('public_id'), 'adminUser');
    if (!publicId) {
      return back({ error: 'شناسه مدیر معتبر نیست.' });
    }

    const target = await getAdminUserByPublicId(env.DB, publicId);
    if (!target) {
      return back({ error: 'کاربر مدیر مورد نظر یافت نشد.' });
    }

    const modifyGuard = canModifyTargetAdmin(auth.actor, {
      publicId: target.public_id,
      role: parseStrictAdminRole(target.role) ?? 'none',
    });
    if (!modifyGuard.ok) {
      return back({ error: modifyGuard.reason });
    }

    const nextRole = form.has('role')
      ? parseStrictAdminRole(String(form.get('role') ?? ''))
      : (parseStrictAdminRole(target.role) ?? 'none');
    if (!nextRole) {
      return back({ error: 'نقش انتخاب‌شده معتبر نیست.' });
    }
    if (!canAssignAdminRole(auth.actor, nextRole)) {
      return back({ error: 'امکان ارتقا یا انتساب نقش هم‌سطح یا بالاتر از خودتان وجود ندارد.' });
    }

    const nextActive = form.get('is_active') === '1';
    if (target.role === 'super_admin' && target.is_active === 1 && (nextRole !== 'super_admin' || !nextActive)) {
      const superCount = await countActiveSuperAdmins(env.DB);
      if (superCount <= 1) {
        return back({ error: 'حداقل یک مدیر ارشد فعال باید در سیستم باقی بماند.' });
      }
    }

    const displayName = String(form.get('display_name') ?? target.display_name).trim();
    const newPassword = String(form.get('new_password') ?? '').trim();
    if (newPassword && newPassword.length < 8) {
      return back({ error: 'گذرواژه جدید باید حداقل ۸ کاراکتر باشد.' });
    }

    const hasCustomSubmit = form.has('custom_permissions_submitted');
    const customPermissions = hasCustomSubmit
      ? nextRole === 'none'
        ? []
        : extractPermissions(form, auth.actor.permissions)
      : undefined;

    await updateAdminUser(env.DB, target.public_id, {
      displayName: displayName || target.display_name,
      role: nextRole,
      isActive: nextActive,
      customPermissions,
      password: newPassword || undefined,
    });

    await recordAdminAuditLog(env.DB, {
      action: 'admin_user_updated',
      module: 'admins',
      targetType: 'admin_user',
      targetId: target.public_id,
      actor: auth.actor.id,
      details: {
        role: nextRole,
        isActive: nextActive,
        passwordReset: Boolean(newPassword),
        customPermissionCount:
          customPermissions?.length ??
          (target.custom_permissions_json ? ADMIN_ALL_PERMISSIONS.length : 0),
      },
    });

    return back({ msg: `اطلاعات مدیر «${displayName || target.display_name}» به‌روزرسانی شد.` });
  }

  return back({ error: 'عملیات درخواستی نامعتبر است.' });
};
