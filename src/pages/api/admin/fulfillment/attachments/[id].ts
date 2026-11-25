import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { recordAdminAuditLog } from '../../../../../features/audit/db';
import { resolveAdminActor } from '../../../../../features/fulfillment/actor';
import type { DeliveryAttachmentRow } from '../../../../../features/fulfillment/db';
import { buildPrivateDownloadHeaders } from '../../../../../features/fulfillment/files';
import { requireAdminPermission } from '../../../../../features/fulfillment/permissions';
import { parsePublicId } from '../../../../../features/ids/publicId';
import { getFileStorage } from '../../../../../features/storage';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const { params } = context;
  const actor = await resolveAdminActor(env.DB, context);
  const perm = requireAdminPermission(actor, 'orders.download_private_files');
  if (!perm.ok) {
    return new Response(perm.error, {
      status: perm.status,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  }

  const attachmentPublicId = parsePublicId(params.id, 'deliveryAttachment');
  if (!attachmentPublicId) {
    return new Response('فایل پیوست یافت نشد.', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  }

  const attachment = await env.DB
    .prepare('SELECT * FROM delivery_attachments WHERE public_id = ?')
    .bind(attachmentPublicId)
    .first<DeliveryAttachmentRow>();

  if (!attachment) {
    return new Response('فایل پیوست در دیتابیس یافت نشد.', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  }

  const stored = await getFileStorage().get(attachment.r2_object_key);
  if (!stored) {
    return new Response('فایل پیوست در فضای ذخیره‌سازی خصوصی یافت نشد.', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  }

  await recordAdminAuditLog(env.DB, {
    action: 'delivery.admin_downloaded_file',
    targetType: 'delivery_attachment',
    targetId: attachment.public_id,
    actor: actor.id,
    details: {
      orderId: attachment.order_id,
      orderItemId: attachment.order_item_id,
      attachmentPublicId: attachment.public_id,
      fileName: attachment.file_name,
    },
  });

  return new Response(stored.body, {
    status: 200,
    headers: buildPrivateDownloadHeaders(
      attachment.file_name,
      attachment.mime_type || stored.contentType,
      attachment.size_bytes,
    ),
  });
};
