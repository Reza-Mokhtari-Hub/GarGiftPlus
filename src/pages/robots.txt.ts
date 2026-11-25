import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicOrigin } from '../features/http/origin';
import { getStoreSettings } from '../features/settings/db';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const origin = publicOrigin(url.origin, env.CANONICAL_ORIGIN);
  let disallowAdmin = true;
  try {
    const settings = await getStoreSettings(env.DB);
    disallowAdmin = settings.seoRobotsDisallowAdmin !== false;
  } catch {
    disallowAdmin = true;
  }

  const lines = [
    'User-agent: *',
    'Allow: /',
    ...(disallowAdmin ? ['Disallow: /admin'] : []),
    'Disallow: /api/',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
