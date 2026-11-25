import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../config';
import {
  listMediaFiltered,
  countMediaFiltered,
  MEDIA_PAGE_SIZE,
  type Media,
} from '../../../features/media/db';
import { mediaUsageForIds, isUnused } from '../../../features/media/usage';
import { mediaUrl } from '../../../features/media/url';
import { uploadMedia, validateUploadContent } from '../../../features/media/upload';
import { optimizeUpload } from '../../../features/products/imageOptimize';
import { prewarmImageTransforms } from '../../../features/products/image';
import { getSetting } from '../../../features/settings/db';
import { getStorage } from '../../../features/storage';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';

export const prerender = false;

/** Clamp caller-supplied paging to the grid's bounds. One parser, both callers. */
export function parseMediaListQuery(params: URLSearchParams): {
  limit: number;
  offset: number;
  q: string;
  unusedOnly: boolean;
} {
  const rawLimit = Number(params.get('limit'));
  const rawOffset = Number(params.get('offset'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MEDIA_PAGE_SIZE)
      : MEDIA_PAGE_SIZE;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  const q = (params.get('q') ?? '').trim();
  const unusedOnly = params.get('unused') === '1';
  return { limit, offset, q, unusedOnly };
}

export interface MediaListItem {
  id: string | null;
  imageKey: string;
  url: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  inUse: boolean;
}

export async function loadMediaPage(
  limit: number,
  offset: number,
  filter: { q?: string; unusedOnly?: boolean } = {},
) {
  const items = await listMediaFiltered(env.DB, limit, offset, filter);
  const usage = await mediaUsageForIds(
    env.DB,
    items.map((m) => m.id),
  );
  return { items, usage, baseUrl: getConfig().images.baseUrl };
}

function serialize(media: Media, inUse: boolean, baseUrl: string): MediaListItem {
  return {
    id: media.public_id,
    imageKey: media.image_key,
    url: mediaUrl(media.image_key, baseUrl),
    originalName: media.original_name,
    mimeType: media.mime_type,
    sizeBytes: media.size_bytes,
    createdAt: media.created_at,
    inUse,
  };
}

// GET /api/admin/media — paginated library JSON for the picker.
export const GET: APIRoute = async ({ url, locals, cookies, request }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'media.manage');
  if (!guard.ok) return guard.response;

  const { limit, offset, q, unusedOnly } = parseMediaListQuery(url.searchParams);
  const total = await countMediaFiltered(env.DB, { q, unusedOnly });
  const { items, usage, baseUrl } = await loadMediaPage(limit, offset, { q, unusedOnly });

  return new Response(
    JSON.stringify({
      media: items.map((m) => {
        const entry = usage.get(m.id);
        return serialize(m, !(entry && isUnused(entry)), baseUrl);
      }),
      total,
      limit,
      offset,
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    },
  );
};

// POST /api/admin/media — upload one or more images into the library.
export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'media.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const wantsJson = request.headers.get('accept')?.includes('application/json');
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  const fail = (msg: string, status = 400) =>
    wantsJson
      ? new Response(JSON.stringify({ error: msg }), {
          status,
          headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
        })
      : redirect(`/admin/media?error=${encodeURIComponent(msg)}`, 303);

  if (files.length === 0) return fail('حداقل یک تصویر انتخاب کنید.');

  for (const file of files) {
    const err = await validateUploadContent(file);
    if (err) return fail(err);
  }

  const uploaded = [];
  const baseUrl = getConfig().images.baseUrl;
  for (const file of files) {
    const media = await uploadMedia(env.DB, getStorage(), await optimizeUpload(file), file.name);
    uploaded.push({
      id: media.public_id,
      imageKey: media.image_key,
      url: mediaUrl(media.image_key, baseUrl),
      originalName: media.original_name,
    });
  }

  await recordAdminAuditLog(env.DB, {
    action: 'media.uploaded',
    module: 'media',
    targetType: 'media',
    targetId: uploaded.map((u) => u.id).filter(Boolean).join(','),
    actor: guard.actor.id,
    details: { count: uploaded.length },
  });

  const ctx = locals.cfContext;
  if (ctx && baseUrl) {
    const transformOrigin = new URL(request.url).origin;
    ctx.waitUntil(
      (async () => {
        if ((await getSetting(env.DB, 'image_delivery')) !== 'cloudflare') return;
        for (const m of uploaded) {
          await prewarmImageTransforms(m.imageKey, baseUrl, transformOrigin);
        }
      })().catch((err) => console.error('Image pre-warm failed:', err)),
    );
  }

  return wantsJson
    ? new Response(JSON.stringify({ media: uploaded }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
      })
    : redirect('/admin/media?uploaded=1', 303);
};
