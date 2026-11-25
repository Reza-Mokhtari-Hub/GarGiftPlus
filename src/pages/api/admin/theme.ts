import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { setSetting } from '../../../features/settings/db';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';
import { parseThemeAppearanceConfig } from '../../../features/theme/appearance';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'theme.manage');
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const action = String(form.get('_action') ?? 'save').trim();

  if (action === 'reset') {
    await setSetting(env.DB, 'theme_appearance_config', null);
    await purgeCacheTags([CACHE_TAG.shell, CACHE_TAG.catalog]);
    await recordAdminAuditLog(env.DB, {
      action: 'theme_appearance_reset',
      module: 'theme',
      targetType: 'settings',
      targetId: 'theme_appearance_config',
      actor: auth.actor.id,
    });
    return redirect(
      `/admin/theme?msg=${encodeURIComponent('تنظیمات ظاهری فروشگاه به حالت پیش‌فرض گرگیفت+ بازگردانی شد.')}`,
      303,
    );
  }

  const rawPayload = {
    primaryColor: String(form.get('primary_color') ?? '').trim(),
    secondaryColor: String(form.get('secondary_color') ?? '').trim(),
    accentColor: String(form.get('accent_color') ?? '').trim(),
    fontPreset: String(form.get('font_preset') ?? 'vazirmatn').trim(),
    radiusPreset: String(form.get('radius_preset') ?? 'rounded').trim(),
    buttonStyle: String(form.get('button_style') ?? 'solid_soft').trim(),
    cardStyle: String(form.get('card_style') ?? 'elevated').trim(),
    defaultMode: String(form.get('default_mode') ?? 'system').trim(),
    allowLightMode: form.get('allow_light_mode') === '1',
    allowDarkMode: form.get('allow_dark_mode') === '1',
    allowSystemMode: form.get('allow_system_mode') === '1',
  };

  const validated = parseThemeAppearanceConfig(JSON.stringify(rawPayload));
  await setSetting(env.DB, 'theme_appearance_config', JSON.stringify(validated));
  await purgeCacheTags([CACHE_TAG.shell, CACHE_TAG.catalog]);

  await recordAdminAuditLog(env.DB, {
    action: 'theme_appearance_updated',
    module: 'theme',
    targetType: 'settings',
    targetId: 'theme_appearance_config',
    actor: auth.actor.id,
    details: {
      primaryColor: validated.primaryColor,
      secondaryColor: validated.secondaryColor,
      defaultMode: validated.defaultMode,
      radiusPreset: validated.radiusPreset,
    },
  });

  return redirect(
    `/admin/theme?msg=${encodeURIComponent('تنظیمات ظاهر و تم فروشگاه با موفقیت ذخیره و در فروشگاه اعمال شد.')}`,
    303,
  );
};
