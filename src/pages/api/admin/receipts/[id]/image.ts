import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { resolveAdminActor } from '../../../../../features/fulfillment/actor';
import { hasAnyAdminPermission } from '../../../../../features/fulfillment/permissions';
import { getReceiptByPublicId } from '../../../../../features/payments/receiptsDb';
import { getFileStorage } from '../../../../../features/storage';

export const GET: APIRoute = async ({ params, locals, cookies, request }) => {
  const actor = await resolveAdminActor(env.DB, { locals, cookies, request });
  if (!hasAnyAdminPermission(actor, ['receipts.review', 'orders.download_private_files', 'payments.view'])) {
    return new Response('دسترسی به تصویر خصوصی فیش بانکی مجاز نیست.', { status: 403 });
  }

  const receiptPublicId = (params.id ?? '').trim();
  if (!receiptPublicId) {
    return new Response('Not found', { status: 404 });
  }

  const receipt = await getReceiptByPublicId(env.DB, receiptPublicId);
  if (!receipt) {
    return new Response('Receipt not found', { status: 404 });
  }

  const obj = await getFileStorage().get(receipt.r2_object_key);
  if (!obj) {
    return new Response('Receipt image missing in private storage', { status: 404 });
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': receipt.mime_type || obj.contentType || 'image/jpeg',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
    },
  });
};
