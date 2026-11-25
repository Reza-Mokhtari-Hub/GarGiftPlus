import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { deliverOrderNotifications } from '../../../../features/email/outbox';
import { resolveAdminActor } from '../../../../features/fulfillment/actor';
import {
  publishOrderItemDelivery,
  queueFulfillmentNotification,
  removeOrderItemDeliveryAttachment,
  saveOrderItemDeliveryDraft,
   updateOrderFulfillmentMetadata,
  uploadOrderItemDeliveryAttachment,
  type FulfillmentEmailEventType,
} from '../../../../features/fulfillment/db';
import { requireAdminPermission } from '../../../../features/fulfillment/permissions';
import type { DeliverySection, DeliverySectionType } from '../../../../features/fulfillment/sections';
import { toDbOrderFulfillmentStatus } from '../../../../features/fulfillment/status';
import { parseOrderOrLegacyPublicId, parsePublicId } from '../../../../features/ids/publicId';
import { getOrderByPublicId, listOrderItems } from '../../../../features/orders/db';
import { getFileStorage } from '../../../../features/storage';

export const prerender = false;

function extractSectionsFromForm(form: FormData): unknown {
  const rawJson = form.get('sections_json');
  if (typeof rawJson === 'string' && rawJson.trim() !== '') {
    return rawJson.trim();
  }

  // پشتیبانی از فیلدهای آرایه‌ای فرم HTML بدون نیاز به جاوااسکریپت
  const types = form.getAll('section_type').map((v) => String(v).trim());
  const titles = form.getAll('section_title').map((v) => String(v).trim());
  const values = form.getAll('section_value').map((v) => String(v));
  const urls = form.getAll('section_url').map((v) => String(v).trim());
  const linkLabels = form.getAll('section_link_label').map((v) => String(v).trim());
  const instructions = form.getAll('section_instructions').map((v) => String(v));
  const copyables = form.getAll('section_copyable').map((v) => String(v).trim());

  const sections: Partial<DeliverySection>[] = [];
  for (let i = 0; i < types.length; i++) {
    const type = types[i] as DeliverySectionType;
    if (!type) continue;
    sections.push({
      id: `sec_${i + 1}`,
      type,
      title: titles[i] ?? '',
      value: values[i] ?? '',
      url: urls[i] ?? '',
      linkLabel: linkLabels[i] ?? '',
      instructions: instructions[i] ?? '',
      copyable: copyables[i] ? copyables[i] === '1' || copyables[i] === 'true' : true,
    });
  }
  return sections;
}

export const POST: APIRoute = async (context) => {
  const { request, redirect } = context;
  const actor = await resolveAdminActor(env.DB, context);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('فرم ارسالی نامعتبر است.', { status: 400 });
  }

  const orderPublicId = parseOrderOrLegacyPublicId(form.get('order_public_id'), 'order');
  const order = orderPublicId ? await getOrderByPublicId(env.DB, orderPublicId) : null;
  if (!order) {
    return new Response('سفارش مورد نظر یافت نشد.', { status: 404 });
  }

  const returnPathRaw = String(form.get('return_to') ?? '').trim();
  const baseReturnPath =
    returnPathRaw.startsWith('/admin/') && !returnPathRaw.startsWith('//')
      ? returnPathRaw
      : `/admin/orders/${order.public_id}`;

  const fail = (msg: string, httpStatus?: number) => {
    if (request.headers.get('accept')?.includes('application/json')) {
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: httpStatus ?? 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    const url = new URL(baseReturnPath, 'http://localhost');
    url.searchParams.set('error', msg);
    return redirect(`${url.pathname}${url.search}`, 303);
  };

  const succeed = (msg: string, extra?: Record<string, unknown>) => {
    if (request.headers.get('accept')?.includes('application/json')) {
      return new Response(JSON.stringify({ ok: true, notice: msg, ...(extra ?? {}) }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    const url = new URL(baseReturnPath, 'http://localhost');
    url.searchParams.set('notice', msg);
    return redirect(`${url.pathname}${url.search}`, 303);
  };

  const action = String(form.get('_action') ?? '').trim();

  // ۱. به‌روزرسانی متادیتای کلی تحویل سفارش (وضعیت پردازش، کارشناس مسئول، یادداشت داخلی)
  if (action === 'update_order_meta') {
    const rawStatus = String(form.get('fulfillment_status') ?? '').trim();
    const assignedAdmin = String(form.get('assigned_admin') ?? '').trim();
    const internalNotes = String(form.get('internal_notes') ?? '').trim();
    const sendNotif = form.get('send_notification') === '1';

    const res = await updateOrderFulfillmentMetadata(env.DB, {
      actor,
      orderId: order.id,
      fulfillmentStatus: rawStatus ? toDbOrderFulfillmentStatus(rawStatus) : undefined,
      assignedAdmin,
      internalNotes,
      sendNotification: sendNotif,
    });
    if (!res.ok) return fail(res.error, res.status);

    if (sendNotif) {
      try {
        await deliverOrderNotifications(env.DB, order.id, new URL(request.url).origin);
      } catch (err) {
        console.error('[GarGift+] Outbox delivery failed after status update (will retry):', err);
      }
    }

    return succeed('وضعیت و اطلاعات پردازش سفارش با موفقیت ذخیره شد.', {
      fulfillmentStatus: res.fulfillmentStatus,
    });
  }

  // ۲. ارسال دستی اعلان وضعیت تحویل به مشتری
  if (action === 'send_notification') {
    const perm = requireAdminPermission(actor, 'orders.send_delivery_notifications');
    if (!perm.ok) return fail(perm.error, perm.status);

    const eventType = String(form.get('event_type') ?? 'delivery_published').trim() as FulfillmentEmailEventType;
    const itemPublicId = parsePublicId(form.get('item_public_id'), 'orderItem');
    const queued = await queueFulfillmentNotification(env.DB, {
      orderId: order.id,
      eventType,
      itemPublicId,
      idempotencyKey: `manual_notif:${order.public_id}:${eventType}:${itemPublicId ?? 'all'}`,
      actor: actor.id,
    });

    try {
      await deliverOrderNotifications(env.DB, order.id, new URL(request.url).origin);
    } catch (err) {
      console.error('[GarGift+] Manual notification delivery failed (will retry):', err);
    }

    return succeed(
      queued.queued
        ? 'اعلان وضعیت تحویل در صف ارسال ایمیل (Outbox) ثبت شد.'
        : 'این اعلان قبلاً برای مشتری ثبت و ارسال شده است (جلوگیری از ارسال تکراری).',
    );
  }

  // ۳. حذف پیوست تحویل
  if (action === 'remove_attachment') {
    const attachmentPublicId = String(form.get('attachment_public_id') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim() || null;
    const res = await removeOrderItemDeliveryAttachment(env.DB, getFileStorage(), {
      actor,
      orderId: order.id,
      attachmentPublicId,
      reason,
    });
    if (!res.ok) return fail(res.error, res.status);
    return succeed('فایل پیوست از تحویل حذف شد.');
  }

  // ۴. عملیات مربوط به یک آیتم مشخص سفارش (ذخیره پیش‌نویس، آپلود پیوست، آماده تحویل، انتشار نهایی)
  const itemPublicId = parsePublicId(form.get('item_public_id'), 'orderItem');
  const rawItemId = Number(form.get('order_item_id') ?? '');
  const items = await listOrderItems(env.DB, order.id);
  const item = items.find(
    (it) =>
      (itemPublicId && it.public_id === itemPublicId) ||
      (Number.isSafeInteger(rawItemId) && rawItemId > 0 && it.id === rawItemId),
  );
  if (!item) {
    return fail('ردیف محصول مورد نظر در این سفارش یافت نشد.', 404);
  }

  const sections = extractSectionsFromForm(form);
  const customerNote = String(form.get('customer_note') ?? '').trim() || null;
  const adminNote = String(form.get('admin_note') ?? '').trim() || null;
  const assignedAdmin = String(form.get('assigned_admin') ?? '').trim() || null;
  const changeReason = String(form.get('change_reason') ?? '').trim() || null;

  // بررسی فایل‌های پیوست ارسالی در فرم
  const uploadedFiles = form
    .getAll('attachments')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (action === 'save_draft' || action === 'mark_ready') {
    const draftRes = await saveOrderItemDeliveryDraft(env.DB, {
      actor,
      orderId: order.id,
      orderItemId: item.id,
      sections,
      customerNote,
      adminNote,
      assignedAdmin,
      markReadyForDelivery: action === 'mark_ready',
    });
    if (!draftRes.ok) return fail(draftRes.error, draftRes.status);

    for (const file of uploadedFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upRes = await uploadOrderItemDeliveryAttachment(env.DB, getFileStorage(), {
        actor,
        orderId: order.id,
        orderItemId: item.id,
        fileBytes: bytes,
        fileName: file.name,
        mimeType: file.type,
      });
      if (!upRes.ok) return fail(upRes.error, upRes.status);
    }

    return succeed(
      action === 'mark_ready'
        ? `تحویل آیتم «${item.name}» در وضعیت «آماده تحویل» ذخیره شد.`
        : `پیش‌نویس تحویل آیتم «${item.name}» با موفقیت ذخیره شد (برای مشتری مخفی است).`,
      { deliveryPublicId: draftRes.delivery.public_id },
    );
  }

  if (action === 'upload_attachment') {
    if (uploadedFiles.length === 0) {
      return fail('لطفاً حداقل یک فایل معتبر برای بارگذاری انتخاب کنید.', 400);
    }
    const createdIds: string[] = [];
    for (const file of uploadedFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upRes = await uploadOrderItemDeliveryAttachment(env.DB, getFileStorage(), {
        actor,
        orderId: order.id,
        orderItemId: item.id,
        fileBytes: bytes,
        fileName: file.name,
        mimeType: file.type,
      });
      if (!upRes.ok) return fail(upRes.error, upRes.status);
      createdIds.push(upRes.attachment.public_id);
    }
    return succeed('فایل پیوست خصوصی با موفقیت بارگذاری شد.', {
      attachmentPublicIds: createdIds,
    });
  }

  if (action === 'publish_delivery') {
    // اگر در فرم انتشار فایل جدیدی هم انتخاب شده باشد، ابتدا در پیش‌نویس آپلود می‌کنیم
    for (const file of uploadedFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upRes = await uploadOrderItemDeliveryAttachment(env.DB, getFileStorage(), {
        actor,
        orderId: order.id,
        orderItemId: item.id,
        fileBytes: bytes,
        fileName: file.name,
        mimeType: file.type,
      });
      if (!upRes.ok) return fail(upRes.error, upRes.status);
    }

    const pubRes = await publishOrderItemDelivery(env.DB, {
      actor,
      orderId: order.id,
      orderItemId: item.id,
      sections,
      customerNote,
      adminNote,
      changeReason,
    });

    if (!pubRes.ok) return fail(pubRes.error, pubRes.status);

    // تلاش برای ارسال فوری اعلان‌های Outbox؛ در صورت خطای سرویس ایمیل، انتشار تحویل هرگز برنمی‌گردد
    if (pubRes.queuedOutboxKinds.length > 0) {
      try {
        await deliverOrderNotifications(env.DB, order.id, new URL(request.url).origin);
      } catch (err) {
        console.error('[GarGift+] Delivery notification email failed (queued in Outbox):', err);
      }
    }

    return succeed(
      pubRes.idempotent
        ? `این نسخه از اطلاعات تحویل آیتم «${item.name}» قبلاً منتشر شده است (بدون ایجاد نسخه یا اعلان تکراری).`
        : `تحویل آیتم «${item.name}» با موفقیت منتشر شد (نسخه ${pubRes.versionNumber}) و برای مشتری قابل مشاهده گردید.`,
      {
        idempotent: pubRes.idempotent,
        versionNumber: pubRes.versionNumber,
        orderFulfillmentStatus: pubRes.orderFulfillmentStatus,
      },
    );
  }

  return fail('عملیات درخواستی معتبر نیست.', 400);
};
