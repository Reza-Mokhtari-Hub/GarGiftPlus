import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizeAndLoadCustomerAttachment } from '../../../../features/fulfillment/db';
import { buildPrivateDownloadHeaders } from '../../../../features/fulfillment/files';
import { getFileStorage } from '../../../../features/storage';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const token = params.token ?? '';
  const attachmentPublicId = params.attachmentPublicId ?? '';

  const auth = await authorizeAndLoadCustomerAttachment(env.DB, {
    attachmentPublicId,
    guestToken: token,
  });

  if (!auth.ok) {
    return new Response(auth.error, {
      status: auth.status,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const stored = await getFileStorage().get(auth.attachment.r2_object_key);
  if (!stored) {
    return new Response('فایل درخواستی در دسترس نیست.', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  return new Response(stored.body, {
    status: 200,
    headers: buildPrivateDownloadHeaders(
      auth.attachment.file_name,
      auth.attachment.mime_type || stored.contentType,
      auth.attachment.size_bytes,
    ),
  });
};
