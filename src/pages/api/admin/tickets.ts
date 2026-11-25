import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { parsePublicId } from '../../../features/ids/publicId';
import {
  addTicketReply,
  getSupportTicketByPublicId,
  updateTicketStatus,
  type TicketStatus,
} from '../../../features/tickets/db';

export const prerender = false;

const VALID_STATUSES = new Set<TicketStatus>([
  'open',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
]);

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'tickets.manage');
  if (!auth.ok) return auth.response;

  const wantsJson = request.headers.get('x-requested-with') === 'fetch';
  const form = await request.formData();
  const action = String(form.get('_action') ?? 'reply').trim();
  const publicId = parsePublicId(form.get('ticket_public_id'), 'supportTicket');

  const back = (params: Record<string, string>, status = 200) => {
    if (wantsJson) return Response.json(params, { status });
    const qs = new URLSearchParams(params);
    if (publicId) qs.set('ticket', publicId);
    return redirect(`/admin/tickets?${qs.toString()}`, 303);
  };

  if (!publicId) {
    return back({ error: 'شناسه تیکت معتبر نیست.' }, 400);
  }

  const ticket = await getSupportTicketByPublicId(env.DB, publicId);
  if (!ticket) {
    return back({ error: 'تیکت مورد نظر یافت نشد.' }, 404);
  }

  if (action === 'reply') {
    const message = String(form.get('message') ?? '').trim();
    const isInternal = form.get('is_internal') === '1';
    const rawNextStatus = String(form.get('next_status') ?? '').trim() as TicketStatus;
    const nextStatus = VALID_STATUSES.has(rawNextStatus) ? rawNextStatus : undefined;

    if (message.length < 2) {
      return back({ error: 'متن پاسخ نمی‌تواند خالی باشد.' }, 400);
    }

    await addTicketReply(env.DB, {
      ticketId: ticket.id,
      authorType: 'admin',
      authorId: auth.actor.email || auth.actor.id,
      authorName: auth.actor.displayName || auth.actor.id,
      message,
      isInternal,
      nextStatus,
    });

    await recordAdminAuditLog(env.DB, {
      action: isInternal ? 'ticket_internal_note' : 'ticket_admin_reply',
      module: 'tickets',
      targetType: 'support_ticket',
      targetId: ticket.public_id,
      actor: auth.actor.id,
      details: {
        isInternal,
        nextStatus: nextStatus ?? null,
      },
    });

    return back({ msg: isInternal ? 'یادداشت داخلی روی تیکت ثبت شد.' : 'پاسخ برای مشتری ثبت گردید.' });
  }

  if (action === 'status') {
    const rawStatus = String(form.get('status') ?? '').trim() as TicketStatus;
    if (!VALID_STATUSES.has(rawStatus)) {
      return back({ error: 'وضعیت انتخاب‌شده معتبر نیست.' }, 400);
    }
    const assignMode = String(form.get('assign_self') ?? '').trim();
    const assignedAdmin =
      assignMode === '1'
        ? auth.actor.displayName || auth.actor.id
        : String(form.get('assigned_admin') ?? '').trim() || undefined;

    await updateTicketStatus(env.DB, ticket.public_id, {
      status: rawStatus,
      assignedAdmin: assignedAdmin ?? null,
    });

    await recordAdminAuditLog(env.DB, {
      action: 'ticket_status_updated',
      module: 'tickets',
      targetType: 'support_ticket',
      targetId: ticket.public_id,
      actor: auth.actor.id,
      details: {
        previousStatus: ticket.status,
        status: rawStatus,
        assignedAdmin: assignedAdmin ?? ticket.assigned_admin ?? null,
      },
    });

    return back({ msg: 'وضعیت تیکت به‌روزرسانی شد.' });
  }

  return back({ error: 'عملیات نامعتبر است.' }, 400);
};
