import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../config';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { renderMarkdown } from '../../../../features/pages/markdown';
import {
  normalizePageLayout,
  pageLayoutStyle,
} from '../../../../features/pages/layouts';

export const prerender = false;

const MAX_BODY = 100_000;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'content.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const markdown = String(form.get('body_markdown') ?? '').slice(0, MAX_BODY);
  const html = renderMarkdown(markdown, {
    baseUrl: getConfig().images.baseUrl,
    sourceMap: true,
  });
  const layout = normalizePageLayout(form.get('layout'));
  const wrapped =
    `<div class="markdown-content" data-page-layout="${layout}" ` +
    `style="${pageLayoutStyle(layout)}">${html}</div>`;

  return new Response(wrapped, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
};
