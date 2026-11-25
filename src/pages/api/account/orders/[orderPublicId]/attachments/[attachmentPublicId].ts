import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getVerifiedCustomer } from '../../../../../../features/auth/customer';
import { authorizeAndLoadCustomerAttachment } from '../../../../../../features/fulfillment/db';
import { buildPrivateDownloadHeaders } from '../../../../../../features/fulfillment/files';
import { getFileStorage } from '../../../../../../features/storage';

export const prerender = false;

export const GET: APIRoute = async ({ params, cookies }) => {
  const customer = await getVerifiedCustomer(cookies);
  if (!customer) {
    return new Response('برای دانلود این فایل باید وارد حساب کاربری خود شوید.', {
      status: 401,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const orderPublicId = params.orderPublicId ?? '';
  const attachmentPublicId = params.attachmentPublicId ?? '';

  const auth = await authorizeAndLoadCustomerAttachment(env.DB, {
    attachmentPublicId,
    orderPublicId,
    authenticatedCustomer: {
      id: customer.id,
      email: customer.email,
    },
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
