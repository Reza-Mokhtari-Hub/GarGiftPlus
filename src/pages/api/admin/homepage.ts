import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  createPromotionalBanner,
  createStorefrontFaq,
  deleteProductReview,
  deletePromotionalBanner,
  deleteStorefrontFaq,
  getFooterConfig,
  listAllProductReviewsForAdmin,
  listHomepageSections,
  listPromotionalBanners,
  listStorefrontFaqs,
  reorderAndToggleHomepageSections,
  saveFooterConfig,
  setProductReviewApproval,
  updateHomepageSection,
  updatePromotionalBanner,
  updateStorefrontFaq,
} from '../../../features/homepage/db';
import {
  isValidHomepageSectionKey,
  parseFooterConfigInput,
  parseHomepageSectionInput,
  parsePromotionalBannerInput,
  parseStorefrontFaqInput,
  type HomepageSectionKey,
} from '../../../features/homepage/schema';
import { uploadMedia, validateUpload } from '../../../features/media/upload';
import { optimizeUpload } from '../../../features/products/imageOptimize';
import { getStorage } from '../../../features/storage';
import { setSetting } from '../../../features/settings/db';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

async function maybeUploadImageField(
  form: FormData | null,
  fieldName: string,
  fallbackKey: unknown,
): Promise<{ ok: true; key: string | null } | { ok: false; error: string }> {
  if (form) {
    const file = form.get(fieldName);
    if (file instanceof File && file.size > 0) {
      const err = validateUpload(file);
      if (err) return { ok: false, error: err };
      const uploaded = await uploadMedia(
        env.DB,
        getStorage(),
        await optimizeUpload(file),
        file.name,
      );
      return { ok: true, key: uploaded.image_key };
    }
  }
  const str = typeof fallbackKey === 'string' ? fallbackKey.trim() : '';
  return { ok: true, key: str || null };
}

export const GET: APIRoute = async ({ locals, cookies, request }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'content.manage');
  if (!guard.ok) return guard.response;

  const [sections, banners, faqs, reviews, footerConfig] = await Promise.all([
    listHomepageSections(env.DB),
    listPromotionalBanners(env.DB),
    listStorefrontFaqs(env.DB, false),
    listAllProductReviewsForAdmin(env.DB, 50),
    getFooterConfig(env.DB),
  ]);

  return jsonResponse({
    sections,
    banners,
    faqs,
    reviews,
    footerConfig,
  });
};

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'content.manage');
  if (!guard.ok) return guard.response;

  const contentType = request.headers.get('content-type') ?? '';
  const wantsJson =
    contentType.includes('application/json') ||
    Boolean(request.headers.get('accept')?.includes('application/json'));

  let form: FormData | null = null;
  let payload: Record<string, unknown> = {};

  if (contentType.includes('application/json')) {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object') {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      return jsonResponse({ error: 'فرمت JSON نامعتبر است.' }, 400);
    }
  } else {
    form = await request.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === 'string') {
        payload[k] = v;
      }
    }
  }

  const action = String(payload._action ?? payload.action ?? '').trim();
  const activeTab = String(payload._tab ?? 'sections').trim();

  const replySuccess = async (message: string, data: Record<string, unknown> = {}) => {
    await recordAdminAuditLog(env.DB, {
      action: `homepage.${action}`,
      module: 'content',
      targetType: 'homepage',
      targetId: String(payload.public_id ?? payload.section_key ?? activeTab),
      actor: guard.actor.id,
      reason: message,
    });
    await purgeCacheTags([CACHE_TAG.catalog, CACHE_TAG.shell]);
    if (wantsJson) {
      return jsonResponse({ ok: true, message, ...data });
    }
    return redirect(
      `/admin/homepage?tab=${encodeURIComponent(activeTab)}&saved=${encodeURIComponent(message)}`,
      303,
    );
  };

  const replyError = (error: string, status = 400) => {
    if (wantsJson) {
      return jsonResponse({ ok: false, error }, status);
    }
    return redirect(
      `/admin/homepage?tab=${encodeURIComponent(activeTab)}&error=${encodeURIComponent(error)}`,
      303,
    );
  };

  if (action === 'update_section') {
    const desktopUpload = await maybeUploadImageField(
      form,
      'desktop_image_file',
      payload.desktop_image_key ?? payload.desktopImageKey,
    );
    if (!desktopUpload.ok) return replyError(desktopUpload.error);

    const mobileUpload = await maybeUploadImageField(
      form,
      'mobile_image_file',
      payload.mobile_image_key ?? payload.mobileImageKey,
    );
    if (!mobileUpload.ok) return replyError(mobileUpload.error);

    const parsed = parseHomepageSectionInput({
      ...payload,
      desktopImageKey: desktopUpload.key,
      mobileImageKey: mobileUpload.key,
    });
    if (!parsed.ok) return replyError(parsed.error);

    const updated = await updateHomepageSection(env.DB, parsed.data);
    if (parsed.data.sectionKey === 'announcement') {
      await setSetting(env.DB, 'announcement', parsed.data.isEnabled ? parsed.data.title : '');
      await setSetting(
        env.DB,
        'announcement_href',
        parsed.data.isEnabled && parsed.data.ctaHref ? parsed.data.ctaHref : '',
      );
    }

    return replySuccess('تنظیمات بخش صفحه اصلی با موفقیت ذخیره شد.', { section: updated });
  }

  if (action === 'reorder_sections') {
    const items: { sectionKey: HomepageSectionKey; sortOrder: number; isEnabled: boolean }[] = [];
    if (Array.isArray(payload.sections)) {
      for (const item of payload.sections) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const key = rec.sectionKey ?? rec.section_key;
        if (!isValidHomepageSectionKey(key)) {
          return replyError('کلید بخش نامعتبر در لیست مرتب‌سازی ارسال شده است.');
        }
        items.push({
          sectionKey: key,
          sortOrder: Number.isFinite(Number(rec.sortOrder ?? rec.sort_order))
            ? Math.trunc(Number(rec.sortOrder ?? rec.sort_order))
            : 0,
          isEnabled: Boolean(rec.isEnabled ?? rec.is_enabled),
        });
      }
    } else if (form) {
      const keys = form.getAll('section_keys').map((v) => String(v));
      for (const key of keys) {
        if (!isValidHomepageSectionKey(key)) {
          return replyError('کلید بخش نامعتبر ارسال شده است.');
        }
        const sortOrder = Number(form.get(`sort_order_${key}`) ?? 0);
        const isEnabled = form.get(`is_enabled_${key}`) === '1' || form.get(`is_enabled_${key}`) === 'on';
        items.push({
          sectionKey: key,
          sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
          isEnabled,
        });
      }
    }

    await reorderAndToggleHomepageSections(env.DB, items);
    return replySuccess('ترتیب و وضعیت بخش‌های صفحه اصلی به‌روزرسانی شد.');
  }

  if (action === 'create_banner' || action === 'update_banner') {
    const desktopUpload = await maybeUploadImageField(
      form,
      'desktop_image_file',
      payload.desktop_image_key ?? payload.desktopImageKey,
    );
    if (!desktopUpload.ok) return replyError(desktopUpload.error);

    const mobileUpload = await maybeUploadImageField(
      form,
      'mobile_image_file',
      payload.mobile_image_key ?? payload.mobileImageKey,
    );
    if (!mobileUpload.ok) return replyError(mobileUpload.error);

    const parsed = parsePromotionalBannerInput({
      ...payload,
      desktopImageKey: desktopUpload.key,
      mobileImageKey: mobileUpload.key,
    });
    if (!parsed.ok) return replyError(parsed.error);

    if (action === 'create_banner') {
      const banner = await createPromotionalBanner(env.DB, parsed.data);
      return replySuccess('بنر تبلیغاتی جدید با موفقیت ایجاد شد.', { banner });
    } else {
      const publicId = String(payload.public_id ?? payload.publicId ?? '').trim();
      if (!publicId) return replyError('شناسه بنر مشخص نشده است.');
      const banner = await updatePromotionalBanner(env.DB, publicId, parsed.data);
      if (!banner) return replyError('بنر مورد نظر یافت نشد.', 404);
      return replySuccess('بنر تبلیغاتی با موفقیت به‌روزرسانی شد.', { banner });
    }
  }

  if (action === 'delete_banner') {
    const publicId = String(payload.public_id ?? payload.publicId ?? '').trim();
    if (!publicId) return replyError('شناسه بنر مشخص نشده است.');
    const deleted = await deletePromotionalBanner(env.DB, publicId);
    if (!deleted) return replyError('بنر مورد نظر یافت نشد.', 404);
    return replySuccess('بنر تبلیغاتی حذف شد.');
  }

  if (action === 'create_faq' || action === 'update_faq') {
    const parsed = parseStorefrontFaqInput(payload);
    if (!parsed.ok) return replyError(parsed.error);

    if (action === 'create_faq') {
      const faq = await createStorefrontFaq(env.DB, parsed.data);
      return replySuccess('پرسش متداول جدید با موفقیت اضافه شد.', { faq });
    } else {
      const publicId = String(payload.public_id ?? payload.publicId ?? '').trim();
      if (!publicId) return replyError('شناسه پرسش متداول مشخص نشده است.');
      const faq = await updateStorefrontFaq(env.DB, publicId, parsed.data);
      if (!faq) return replyError('پرسش متداول مورد نظر یافت نشد.', 404);
      return replySuccess('پرسش متداول با موفقیت ویرایش شد.', { faq });
    }
  }

  if (action === 'delete_faq') {
    const publicId = String(payload.public_id ?? payload.publicId ?? '').trim();
    if (!publicId) return replyError('شناسه پرسش متداول مشخص نشده است.');
    await deleteStorefrontFaq(env.DB, publicId);
    return replySuccess('پرسش متداول حذف شد.');
  }

  if (action === 'moderate_review') {
    const publicId = String(payload.public_id ?? payload.publicId ?? '').trim();
    const op = String(payload.operation ?? '').trim();
    if (!publicId) return replyError('شناسه دیدگاه مشخص نشده است.');

    if (op === 'delete') {
      await deleteProductReview(env.DB, publicId);
      return replySuccess('دیدگاه مشتری حذف شد.');
    }
    const approve = op === 'approve' || payload.is_approved === '1' || payload.isApproved === true;
    await setProductReviewApproval(env.DB, publicId, approve);
    return replySuccess(
      approve ? 'دیدگاه مشتری تایید و در فروشگاه منتشر شد.' : 'انتشار دیدگاه مشتری لغو شد.',
    );
  }

  if (action === 'update_footer') {
    const parsed = parseFooterConfigInput(payload);
    if (!parsed.ok) return replyError(parsed.error);
    await saveFooterConfig(env.DB, parsed.data);
    return replySuccess('اطلاعات فوتر فروشگاه با موفقیت ذخیره شد.', {
      footerConfig: parsed.data,
    });
  }

  return replyError('عملیات درخواستی نامعتبر است.');
};
