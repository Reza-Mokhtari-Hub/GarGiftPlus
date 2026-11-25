import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId';

export type TicketDepartment = 'support' | 'fulfillment' | 'finance' | 'technical';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';

export interface SupportTicket {
  id: number;
  public_id: string;
  customer_id: number | null;
  customer_email: string;
  order_public_id: string | null;
  subject: string;
  department: TicketDepartment;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_admin: string | null;
  last_reply_at: string;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketReply {
  id: number;
  public_id: string;
  ticket_id: number;
  author_type: 'customer' | 'admin';
  author_id: string;
  author_name: string;
  message: string;
  is_internal: number;
  created_at: string;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'باز (جدید)',
  in_progress: 'در حال بررسی',
  waiting_customer: 'در انتظار پاسخ مشتری',
  resolved: 'حل‌شده',
  closed: 'بسته',
};

export const TICKET_DEPARTMENT_LABELS: Record<TicketDepartment, string> = {
  support: 'پشتیبانی عمومی',
  fulfillment: 'پیگیری و تحویل سفارش',
  finance: 'مالی، واریز و کیف پول',
  technical: 'مشکل فنی',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'عادی / کم',
  normal: 'متوسط',
  high: 'مهم',
  urgent: 'فوری',
};

export async function createSupportTicket(
  db: D1Database,
  input: {
    customerId?: number | null;
    customerEmail: string;
    orderPublicId?: string | null;
    subject: string;
    department?: TicketDepartment;
    priority?: TicketPriority;
    message: string;
    authorName: string;
  },
): Promise<SupportTicket> {
  const email = input.customerEmail.trim().toLowerCase();
  const subject = input.subject.trim().slice(0, 180);
  const message = input.message.trim().slice(0, 4000);
  const department: TicketDepartment = input.department ?? 'support';
  const priority: TicketPriority = input.priority ?? 'normal';

  const ticket = await withPublicId('supportTicket', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO support_tickets
           (public_id, customer_id, customer_email, order_public_id, subject, department, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
         RETURNING *`,
      )
      .bind(
        publicId,
        input.customerId ?? null,
        email,
        input.orderPublicId?.trim() || null,
        subject,
        department,
        priority,
      )
      .first<SupportTicket>();
    if (!row) throw new Error('ایجاد تیکت پشتیبانی ناموفق بود.');
    return row;
  });

  await addTicketReply(db, {
    ticketId: ticket.id,
    authorType: 'customer',
    authorId: email,
    authorName: input.authorName.trim() || email,
    message,
    isInternal: false,
  });

  return ticket;
}

export async function addTicketReply(
  db: D1Database,
  input: {
    ticketId: number;
    authorType: 'customer' | 'admin';
    authorId: string;
    authorName: string;
    message: string;
    isInternal?: boolean;
    nextStatus?: TicketStatus;
  },
): Promise<SupportTicketReply> {
  const message = input.message.trim().slice(0, 4000);
  const isInternal = input.isInternal ? 1 : 0;
  const reply = await withPublicId('ticketReply', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO support_ticket_replies
           (public_id, ticket_id, author_type, author_id, author_name, message, is_internal)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        publicId,
        input.ticketId,
        input.authorType,
        input.authorId,
        input.authorName.trim().slice(0, 120),
        message,
        isInternal,
      )
      .first<SupportTicketReply>();
    if (!row) throw new Error('ثبت پاسخ تیکت ناموفق بود.');
    return row;
  });

  const nextStatus =
    input.nextStatus ??
    (isInternal
      ? undefined
      : input.authorType === 'admin'
        ? 'waiting_customer'
        : 'open');

  if (nextStatus) {
    await db
      .prepare(
        `UPDATE support_tickets
            SET status = ?, last_reply_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(nextStatus, input.ticketId)
      .run();
  } else {
    await db
      .prepare(`UPDATE support_tickets SET last_reply_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .bind(input.ticketId)
      .run();
  }

  return reply;
}

export async function getSupportTicketByPublicId(
  db: D1Database,
  publicId: string,
): Promise<SupportTicket | null> {
  try {
    return await db
      .prepare('SELECT * FROM support_tickets WHERE public_id = ?')
      .bind(publicId)
      .first<SupportTicket>();
  } catch {
    return null;
  }
}

export async function listTicketReplies(
  db: D1Database,
  ticketId: number,
  includeInternal = false,
): Promise<SupportTicketReply[]> {
  try {
    const sql = includeInternal
      ? 'SELECT * FROM support_ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC, id ASC'
      : 'SELECT * FROM support_ticket_replies WHERE ticket_id = ? AND is_internal = 0 ORDER BY created_at ASC, id ASC';
    const { results } = await db.prepare(sql).bind(ticketId).all<SupportTicketReply>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function listCustomerTickets(
  db: D1Database,
  email: string,
  limit = 30,
): Promise<SupportTicket[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT * FROM support_tickets
          WHERE LOWER(customer_email) = ?
          ORDER BY last_reply_at DESC, id DESC
          LIMIT ?`,
      )
      .bind(email.trim().toLowerCase(), limit)
      .all<SupportTicket>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function listAdminTickets(
  db: D1Database,
  filter: { status?: string; department?: string; q?: string } = {},
  limit = 60,
  offset = 0,
): Promise<SupportTicket[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status?.trim()) {
    clauses.push('status = ?');
    params.push(filter.status.trim());
  }
  if (filter.department?.trim()) {
    clauses.push('department = ?');
    params.push(filter.department.trim());
  }
  if (filter.q?.trim()) {
    const q = `%${filter.q.trim().toLowerCase()}%`;
    clauses.push(
      '(LOWER(public_id) LIKE ? OR LOWER(customer_email) LIKE ? OR LOWER(subject) LIKE ? OR LOWER(COALESCE(order_public_id, \'\')) LIKE ?)',
    );
    params.push(q, q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  try {
    const { results } = await db
      .prepare(
        `SELECT * FROM support_tickets
         ${where}
         ORDER BY CASE WHEN status IN ('open', 'in_progress') THEN 0 ELSE 1 END ASC,
                  last_reply_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all<SupportTicket>();
    return results ?? [];
  } catch {
    return [];
  }
}

export async function updateTicketStatus(
  db: D1Database,
  publicId: string,
  input: { status: TicketStatus; assignedAdmin?: string | null },
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE support_tickets
          SET status = ?,
              assigned_admin = COALESCE(?, assigned_admin),
              updated_at = datetime('now')
        WHERE public_id = ?`,
    )
    .bind(input.status, input.assignedAdmin ?? null, publicId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
