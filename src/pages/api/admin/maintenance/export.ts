import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import { getConfig } from '../../../../config';

export const prerender = false;

export const GET: APIRoute = async ({ locals, cookies, request }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'maintenance.manage');
  if (!auth.ok) return auth.response;

  const [settingsRes, templatesRes, bankRes, menusRes, sectionsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT key, value, updated_at
         FROM settings
        WHERE key NOT LIKE 'enc:%'
          AND key != 'admin_password_hash'
          AND key != 'stripe_webhook_secret'
        ORDER BY key ASC`,
    ).all<{ key: string; value: string; updated_at?: string }>(),
    env.DB.prepare('SELECT event_key, title, subject, heading, is_active, updated_at FROM email_templates ORDER BY id ASC')
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare('SELECT public_id, title, bank_name, account_holder, is_active, display_order FROM bank_accounts ORDER BY display_order ASC')
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare('SELECT location, COUNT(*) AS items FROM menu_items GROUP BY location')
      .all()
      .catch(() => ({ results: [] })),
    env.DB.prepare('SELECT section_key, title, is_enabled, sort_order FROM homepage_sections ORDER BY sort_order ASC')
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const cfg = getConfig();
  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: auth.actor.id,
    notice: 'خروجی غیرمحرمانه پیکربندی فروشگاه؛ کلیه کلیدهای رمزگذاری‌شده Vault و گذرواژه‌ها عمداً حذف شده‌اند.',
    buildDefaults: {
      storeName: cfg.storeName,
      currency: cfg.currency,
      timeZone: cfg.timeZone,
      searchProvider: cfg.search.provider,
    },
    settings: settingsRes.results ?? [],
    emailTemplates: templatesRes.results ?? [],
    bankAccountsSummary: bankRes.results ?? [],
    navigationSummary: menusRes.results ?? [],
    homepageSectionsSummary: sectionsRes.results ?? [],
  };

  await recordAdminAuditLog(env.DB, {
    action: 'maintenance_config_exported',
    module: 'maintenance',
    targetType: 'system',
    targetId: 'non_secret_backup',
    actor: auth.actor.id,
    details: { settingsCount: payload.settings.length },
  });

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="gargift-config-export.json"',
      'cache-control': 'private, no-store',
    },
  });
};
