import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import {
  addMenuItem,
  moveMenuItem,
  reorderMenuItems,
  removeMenuItem,
  setMenuItemLabel,
  normalizeLabel,
  isMenuLocation,
  isMenuTargetType,
  isSingleton,
  getMenuItemIdByPublicId,
  menuItemIdsByPublicId,
  MENU_CAPS,
  type MenuTargetType,
} from '../../../features/navigation/db';
import { getPageByPublicId } from '../../../features/pages/db';
import { getProductByPublicId } from '../../../features/products/db';
import { getCategoryByPublicId } from '../../../features/categories/db';
import { parsePublicId } from '../../../features/ids/publicId';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';

export const prerender = false;

const FAILURE_MESSAGES = {
  full: (location: string) =>
    `منوی ${location === 'header' ? 'سربرگ (Header)' : 'پاورقی (Footer)'} پر شده است (حداکثر ${MENU_CAPS[location as 'header' | 'footer']} آیتم). ابتدا یک مورد را حذف کنید.`,
  duplicate: (location: string, what: string) =>
    `آیتم «${what}» قبلاً در منوی ${location === 'header' ? 'سربرگ' : 'پاورقی'} ثبت شده است.`,
  unavailable: () => 'این صفحه، محصول یا دسته‌بندی دیگر در دسترس نیست.',
};

async function resolveTargetId(
  targetType: MenuTargetType,
  raw: unknown,
): Promise<number | null> {
  if (targetType === 'page') {
    const publicId = parsePublicId(raw, 'page');
    return publicId ? ((await getPageByPublicId(env.DB, publicId))?.id ?? null) : null;
  }
  if (targetType === 'product') {
    const publicId = parsePublicId(raw, 'product');
    return publicId ? ((await getProductByPublicId(env.DB, publicId))?.id ?? null) : null;
  }
  if (targetType === 'category') {
    const publicId = parsePublicId(raw, 'category');
    return publicId ? ((await getCategoryByPublicId(env.DB, publicId))?.id ?? null) : null;
  }
  return null;
}

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'content.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const action = String(form.get('_action'));
  const wantsNoContent = request.headers.get('x-partial') === '1';

  const back = (msg?: string) => {
    if (wantsNoContent) {
      return msg
        ? new Response(msg, { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
        : new Response(null, { status: 204 });
    }
    const params = new URLSearchParams();
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const prev = new URL(referer).searchParams;
        for (const key of ['location', 'target_type', 'q']) {
          const value = prev.get(key);
          if (value) params.set(key, value);
        }
      } catch {
        // ignore malformed referer
      }
    }
    for (const key of ['location', 'target_type']) {
      const value = form.get(key);
      if (typeof value === 'string' && value !== '') params.set(key, value);
    }
    if (msg) params.set('error', msg);
    else params.set('saved', '1');
    return redirect(`/admin/navigation?${params}`, 303);
  };
  const saved = async (targetId: string) => {
    await recordAdminAuditLog(env.DB, {
      action: `navigation.${action}`,
      module: 'content',
      targetType: 'navigation',
      targetId,
      actor: guard.actor.id,
    });
    await purgeCacheTags([CACHE_TAG.shell]);
    return back();
  };

  if (action === 'add') {
    const location = form.get('location');
    const targetType = form.get('target_type');
    if (!isMenuLocation(location)) return new Response('موقعیت منو نامعتبر است', { status: 400 });
    if (!isMenuTargetType(targetType)) return new Response('نوع مقصد نامعتبر است', { status: 400 });

    let targetId: number | null = null;
    if (!isSingleton(targetType)) {
      const raw = form.get(`target_id_${targetType}`) ?? form.get('target_id');
      targetId = await resolveTargetId(targetType, raw);
      if (targetId === null) return back('لطفاً ابتدا یک مقصد انتخاب کنید.');
    }

    const result = await addMenuItem(env.DB, {
      location,
      targetType,
      targetId,
      label: normalizeLabel(form.get('label')),
    });
    if (result.ok) return saved(`${location}:${targetType}`);

    const what = targetType === 'home' ? 'صفحه اصلی' : 'فروشگاه';
    return back(
      result.reason === 'full'
        ? FAILURE_MESSAGES.full(location)
        : result.reason === 'duplicate'
          ? FAILURE_MESSAGES.duplicate(location, what)
          : FAILURE_MESSAGES.unavailable(),
    );
  }

  if (action === 'reorder') {
    const location = form.get('location');
    if (!isMenuLocation(location)) return new Response('موقعیت منو نامعتبر است', { status: 400 });
    const byPublicId = await menuItemIdsByPublicId(env.DB, location);
    const ids = form
      .getAll('order')
      .map((v) => parsePublicId(v, 'navItem'))
      .map((pid) => (pid ? byPublicId.get(pid) : undefined))
      .filter((n): n is number => n !== undefined)
      .slice(0, MENU_CAPS[location]);
    const applied = await reorderMenuItems(env.DB, location, ids);
    if (!applied) return back('ترتیب ارسال‌شده با منو مطابقت نداشت؛ صفحه بازخوانی می‌شود.');
    return saved(location);
  }

  const itemPublicId = parsePublicId(form.get('id'), 'navItem');
  const id = itemPublicId ? await getMenuItemIdByPublicId(env.DB, itemPublicId) : null;
  if (id === null) return new Response('شناسه آیتم نامعتبر است', { status: 400 });

  if (action === 'move') {
    await moveMenuItem(env.DB, id, form.get('direction') === 'up' ? 'up' : 'down');
    return saved(itemPublicId!);
  }

  if (action === 'remove') {
    await removeMenuItem(env.DB, id);
    return saved(itemPublicId!);
  }

  if (action === 'label') {
    await setMenuItemLabel(env.DB, id, normalizeLabel(form.get('label')));
    return saved(itemPublicId!);
  }

  return back('عملیات نامعتبر است.');
};
