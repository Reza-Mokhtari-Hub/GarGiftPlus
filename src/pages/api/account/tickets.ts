import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { accountsEnabled, getVerifiedCustomer } from '../../../features/auth/customer';
import { customerDisplayName } from '../../../features/customers/accountsDb';
import { parsePublicId } from '../../../features/ids/publicId';
import {
  addTicketReply,
  createSupportTicket,
  getSupportTicketByPublicId,
  type TicketDepartment,
  type TicketPriority,
} from '../../../features/tickets/db';

export const prerender = false;

const DEPARTMENTS = new Set<TicketDepartment>(['support', 'fulfillment', 'finance', 'technical']);
const PRIORITIES = new Set<TicketPriority>(['low', 'normal', 'high', 'urgent']);

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const wantsJson = request.headers.get('x-requested-with') === 'fetch';
  const back = (params: Record<string, string>) => {
    if (wantsJson) {
      return Response.json(params, { status: params.error ? 400 : 200 });
    }
    const qs = new URLSearchParams(params);
    return redirect(`/account/tickets?${qs.toString()}`, 303);
  };

  if (!(await accountsEnabled())) {
    return wantsJson
      ? Response.json({ error: 'حساب‌های کاربری غیرفعال است.' }, { status: 403 })
      : redirect('/', 303);
  }

  const customer = await getVerifiedCustomer(cookies);
  if (!customer) {
    return wantsJson
      ? Response.json({ error: 'برای ارسال تیکت ابتدا وارد حساب خود شوید.' }, { status: 401 })
      : redirect('/account/login', 303);
  }

  const form = await request.formData();
  const action = String(form.get('_action') ?? 'create').trim();
  const authorName = customerDisplayName(customer, customer.email);

  if (action === 'create') {
    const subject = String(form.get('subject') ?? '').trim();
    const message = String(form.get('message') ?? '').trim();
    const rawDept = String(form.get('department') ?? 'support').trim() as TicketDepartment;
    const rawPrio = String(form.get('priority') ?? 'normal').trim() as TicketPriority;
    const rawOrder = String(form.get('order_public_id') ?? '').trim();

    if (subject.length < 3) {
      return back({ error: 'عنوان تیکت باید حداقل ۳ کاراکتر باشد.' });
    }
    if (message.length < 5) {
      return back({ error: 'متن پیام تیکت باید حداقل ۵ کاراکتر باشد.' });
    }

    const department: TicketDepartment = DEPARTMENTS.has(rawDept) ? rawDept : 'support';
    const priority: TicketPriority = PRIORITIES.has(rawPrio) ? rawPrio : 'normal';
    const orderPublicId = rawOrder ? (parsePublicId(rawOrder, 'order') ?? rawOrder.slice(0, 40)) : null;

    const ticket = await createSupportTicket(env.DB, {
      customerId: customer.id,
      customerEmail: customer.email,
      orderPublicId,
      subject,
      department,
      priority,
      message,
      authorName,
    });

    return back({
      msg: 'تیکت پشتیبانی شما با موفقیت ثبت شد.',
      ticket: ticket.public_id,
    });
  }

  if (action === 'reply') {
    const ticketPublicId = parsePublicId(form.get('ticket_public_id'), 'supportTicket');
    const message = String(form.get('message') ?? '').trim();
    if (!ticketPublicId) {
      return back({ error: 'شناسه تیکت معتبر نیست.' });
    }
    if (message.length < 2) {
      return back({ error: 'متن پاسخ نمی‌تواند خالی باشد.', ticket: ticketPublicId });
    }

    const ticket = await getSupportTicketByPublicId(env.DB, ticketPublicId);
    if (!ticket || ticket.customer_email.toLowerCase() !== customer.email.toLowerCase()) {
      return back({ error: 'تیکت مورد نظر یافت نشد یا متعلق به این حساب نیست.' });
    }
    if (ticket.status === 'closed') {
      return back({
        error: 'این تیکت بسته شده است و امکان ارسال پاسخ جدید در آن وجود ندارد.',
        ticket: ticket.public_id,
      });
    }

    await addTicketReply(env.DB, {
      ticketId: ticket.id,
      authorType: 'customer',
      authorId: customer.email,
      authorName,
      message,
      isInternal: false,
      nextStatus: 'open',
    });

    return back({
      msg: 'پاسخ شما در تیکت ثبت شد.',
      ticket: ticket.public_id,
    });
  }

  return back({ error: 'عملیات درخواستی معتبر نیست.' });
};
