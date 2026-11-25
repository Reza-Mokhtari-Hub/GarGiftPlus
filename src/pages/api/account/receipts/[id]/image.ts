import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getVerifiedCustomer } from '../../../../../features/auth/customer';
import { resolveAccessToken } from '../../../../../features/orders/guestAccess';
import { getReceiptByPublicId } from '../../../../../features/payments/receiptsDb';
import { getFileStorage } from '../../../../../features/storage';

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const receiptPublicId = (params.id ?? '').trim();
  if (!receiptPublicId) {
    return new Response('Not found', { status: 404 });
  }

  const receipt = await getReceiptByPublicId(env.DB, receiptPublicId);
  if (!receipt) {
    return new Response('Not found', { status: 404 });
  }

  const customer = await getVerifiedCustomer(cookies);
  let authorized = false;

  if (customer && receipt.customer_id !== null && receipt.customer_id === customer.id) {
    authorized = true;
  } else if (
    customer &&
    receipt.customer_email &&
    receipt.customer_email.toLowerCase() === customer.email.toLowerCase()
  ) {
    authorized = true;
  }

  if (!authorized && receipt.target_type === 'order') {
    const orderToken = (url.searchParams.get('token') ?? '').trim();
    if (orderToken) {
      const access = await resolveAccessToken(env.DB, orderToken);
      const lookupId = access?.order_public_id ?? orderToken;
      if (lookupId === receipt.target_public_id) {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    return new Response('Forbidden', { status: 403 });
  }

  const obj = await getFileStorage().get(receipt.r2_object_key);
  if (!obj) {
    return new Response('Receipt file not found', { status: 404 });
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
