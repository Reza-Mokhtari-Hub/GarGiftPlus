import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { applyRefundEvent } from '../../../features/refunds/sync';
import { listUnmatchedRefundEvents, dismissRefundEvent } from '../../../features/refunds/db';
import { sendRefundNotice } from '../../../features/refunds/notify';
import { getOrder } from '../../../features/orders/db';
import { getPaymentProvider, type PaymentMethod } from '../../../features/payments';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'orders.refund');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const action = String(form.get('_action'));
  const targetReturn = String(form.get('_redirect') ?? '').startsWith('/admin/refunds')
    ? '/admin/refunds'
    : '/admin/orders';
  const back = redirect(targetReturn, 303);
  const fail = (msg: string) => redirect(`${targetReturn}?error=${encodeURIComponent(msg)}`, 303);

  if (action === 'retry_refund_event') {
    const eventId = String(form.get('event_id') ?? '').trim();
    if (!eventId) return fail('شناسه رویداد نامشخص است.');

    const events = await listUnmatchedRefundEvents(env.DB);
    const stored = events.find((e) => e.provider_event_id === eventId);
    if (!stored) return fail('این رویداد دیگر در صف مغایرت قرار ندارد.');

    let findSessionIdForPayment;
    try {
      const provider = await getPaymentProvider(stored.provider as PaymentMethod);
      findSessionIdForPayment = provider.findSessionIdForPayment?.bind(provider);
    } catch {
      // ignore unconfigured rail
    }

    const outcome = await applyRefundEvent(
      env.DB,
      stored.provider,
      {
        eventId: stored.provider_event_id,
        providerPaymentId: stored.provider_payment_id ?? '',
        providerChargeId: stored.provider_charge_id,
        cumulativeRefundedCents: stored.cumulative_refunded_cents,
        currency: stored.currency,
      },
      { findSessionIdForPayment },
    );

    if (outcome.status === 'unmatched') {
      return fail('هنوز سفارشی با این شناسه پرداخت یافت نشد؛ رویداد در صف باقی ماند.');
    }
    const orderUrl = async (orderId: number) => {
      const order = await getOrder(env.DB, orderId);
      return order?.public_id ? `/admin/orders/${order.public_id}` : targetReturn;
    };
    if (outcome.status === 'review') {
      return redirect(await orderUrl(outcome.orderId), 303);
    }
    if (outcome.status === 'processed') {
      await sendRefundNotice(
        outcome.orderId,
        outcome.deltaCents,
        new URL(request.url).origin,
      );
      await recordAdminAuditLog(env.DB, {
        action: 'refund_event.reconciled',
        module: 'refunds',
        targetType: 'refund_event',
        targetId: eventId,
        actor: guard.actor.id,
        details: { orderId: outcome.orderId, deltaCents: outcome.deltaCents },
      });
    }
    return redirect(await orderUrl(outcome.orderId), 303);
  }

  if (action === 'dismiss_refund_event') {
    const eventId = String(form.get('event_id') ?? '').trim();
    if (!eventId) return fail('شناسه رویداد نامشخص است.');
    const dismissed = await dismissRefundEvent(
      env.DB,
      eventId,
      guard.actor.id,
    );
    if (!dismissed) {
      const stillQueued = (await listUnmatchedRefundEvents(env.DB)).find(
        (e) => e.provider_event_id === eventId,
      );
      return fail(
        stillQueued
          ? 'این رویداد هنوز به سفارشی متصل نشده است و برای جلوگیری از خطای مالی قابل بستن نیست.'
          : 'این رویداد قبلاً پردازش شده است.',
      );
    }
    await recordAdminAuditLog(env.DB, {
      action: 'refund_event.dismissed',
      module: 'refunds',
      targetType: 'refund_event',
      targetId: eventId,
      actor: guard.actor.id,
    });
    return back;
  }

  return back;
};
