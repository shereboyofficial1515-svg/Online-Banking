import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { providers } from '../providers/index.js';
import { sniffMime, EXT } from '../providers/storage.js';
import * as audit from './auditService.js';
import { notify } from './notificationService.js';
import { newReference, randomToken } from '../utils/crypto.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

export const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', waiting_for_customer: 'Waiting for customer', resolved: 'Resolved', closed: 'Closed' };

const ticketDto = (t) => ({ id: t.id, reference: t.reference, category: t.category, subject: t.subject, status: t.status, statusLabel: STATUS_LABELS[t.status], createdAt: t.created_at, updatedAt: t.updated_at });

async function storeAttachments(t, messageId, files = []) {
  for (const f of files) {
    const mime = sniffMime(f.buffer);
    if (!mime) throw badRequest(`"${f.originalname}" is not an accepted file type. Use JPEG, PNG, WebP or PDF.`);
    const path = `${messageId}/${randomToken(10)}.${EXT[mime]}`;
    await providers().storage.put({ bucket: config.supabase.bucketSupport, path, buffer: f.buffer, mime });
    const safeName = f.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120);
    await t.query('INSERT INTO support_attachments (message_id, filename, mime, size_bytes, storage_path) VALUES ($1,$2,$3,$4,$5)', [messageId, safeName, mime, f.buffer.length, path]);
  }
}

async function messagesFor(q, ticketId, includeInternal) {
  const { rows } = await q.query(
    `SELECT m.*, u.first_name, u.last_name,
       COALESCE((SELECT json_agg(json_build_object('id', a.id, 'filename', a.filename, 'mime', a.mime, 'size', a.size_bytes)) FROM support_attachments a WHERE a.message_id = m.id), '[]'::json) AS attachments
     FROM support_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id=$1 ${includeInternal ? '' : 'AND m.internal = false'} ORDER BY m.created_at`, [ticketId]);
  return rows.map((m) => ({
    id: m.id, authorType: m.author_type, author: m.author_type === 'staff' ? 'EWB Bank Support' : `${m.first_name} ${m.last_name}`,
    ...(includeInternal ? { staffName: m.author_type === 'staff' ? `${m.first_name} ${m.last_name}` : undefined, internal: m.internal } : {}),
    body: m.body, createdAt: m.created_at, attachments: typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments,
  }));
}

export async function create(ctx, { category, subject, message }, files) {
  const db = getDb();
  const userId = ctx.actor.id;
  const open = (await db.query("SELECT count(*)::bigint n FROM support_tickets WHERE user_id=$1 AND status IN ('open','in_progress','waiting_for_customer')", [userId])).rows[0].n;
  if (open >= 10) throw conflict('You have several open requests. Please wait for a response or close an existing request.', 'TOO_MANY_OPEN_TICKETS');
  const ticket = await db.tx(async (t) => {
    const { rows } = await t.query('INSERT INTO support_tickets (reference, user_id, category, subject) VALUES ($1,$2,$3,$4) RETURNING *', [newReference('TKT'), userId, category, subject]);
    const { rows: m } = await t.query("INSERT INTO support_messages (ticket_id, author_id, author_type, body) VALUES ($1,$2,'customer',$3) RETURNING id", [rows[0].id, userId, message]);
    await storeAttachments(t, m[0].id, files);
    await audit.record(t, ctx, { action: 'support.create', targetType: 'support_ticket', targetId: rows[0].id });
    return rows[0];
  });
  const { rows } = await db.query('SELECT first_name FROM users WHERE id=$1', [userId]);
  await notify(userId, { category: 'support', title: 'Support request received', body: `We received your request ${ticket.reference}.`, link: `/app/support/${ticket.id}`,
    email: { template: 'support_notification', data: { firstName: rows[0].first_name, heading: 'We received your request', message: 'Thank you for contacting EWB Bank. A member of our team will respond as soon as possible.', reference: ticket.reference, subject: ticket.subject, statusLabel: STATUS_LABELS.open, ticketId: ticket.id } } });
  return ticketDto(ticket);
}

export async function listForUser(userId) {
  const { rows } = await getDb().query('SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100', [userId]);
  return rows.map(ticketDto);
}
export async function getForUser(userId, id) {
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM support_tickets WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!rows[0]) throw notFound('Support request not found.');
  return { ...ticketDto(rows[0]), messages: await messagesFor(db, id, false) };
}

export async function reply(ctx, id, { message }, files) {
  const db = getDb();
  await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM support_tickets WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, ctx.actor.id]);
    if (!rows[0]) throw notFound('Support request not found.');
    if (rows[0].status === 'closed') throw conflict('This request is closed. Please open a new request.', 'TICKET_CLOSED');
    const { rows: m } = await t.query("INSERT INTO support_messages (ticket_id, author_id, author_type, body) VALUES ($1,$2,'customer',$3) RETURNING id", [id, ctx.actor.id, message]);
    await storeAttachments(t, m[0].id, files);
    await t.query("UPDATE support_tickets SET status = CASE WHEN status IN ('waiting_for_customer','resolved') THEN 'open' ELSE status END, updated_at=now() WHERE id=$1", [id]);
    await audit.record(t, ctx, { action: 'support.reply', targetType: 'support_ticket', targetId: id });
  });
  return getForUser(ctx.actor.id, id);
}

export async function closeByUser(ctx, id) {
  const { rowCount } = await getDb().query("UPDATE support_tickets SET status='closed', updated_at=now() WHERE id=$1 AND user_id=$2 AND status <> 'closed'", [id, ctx.actor.id]);
  if (!rowCount) throw notFound('Support request not found.');
  return getForUser(ctx.actor.id, id);
}

export async function getAttachment({ userId = null, staff = false }, attachmentId) {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT a.*, t.user_id, m.internal FROM support_attachments a JOIN support_messages m ON m.id=a.message_id JOIN support_tickets t ON t.id=m.ticket_id WHERE a.id=$1`, [attachmentId]);
  const a = rows[0];
  if (!a || (!staff && (a.user_id !== userId || a.internal))) throw notFound('Attachment not found.');
  return { buffer: await providers().storage.get({ bucket: config.supabase.bucketSupport, path: a.storage_path }), mime: a.mime, filename: a.filename };
}

// ───────────────────────── staff ─────────────────────────
export async function adminList({ status, q, assignedTo, limit = 50, offset = 0 }) {
  const p = [];
  const w = [];
  if (status) { p.push(status); w.push(`t.status = $${p.length}`); }
  if (assignedTo) { p.push(assignedTo); w.push(`t.assigned_to = $${p.length}`); }
  if (q) { p.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`); w.push(`(t.reference ILIKE $${p.length} OR t.subject ILIKE $${p.length} OR u.email ILIKE $${p.length})`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const db = getDb();
  const { rows } = await db.query(`SELECT t.*, u.email, u.first_name, u.last_name FROM support_tickets t JOIN users u ON u.id=t.user_id ${where} ORDER BY t.updated_at DESC LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(offset, 0)}`, p);
  return rows.map((r) => ({ ...ticketDto(r), customer: { id: r.user_id, email: r.email, name: `${r.first_name} ${r.last_name}` }, assignedTo: r.assigned_to }));
}
export async function adminGet(id) {
  const db = getDb();
  const { rows } = await db.query('SELECT t.*, u.email, u.first_name, u.last_name FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1', [id]);
  if (!rows[0]) throw notFound('Support request not found.');
  return { ...ticketDto(rows[0]), customer: { id: rows[0].user_id, email: rows[0].email, name: `${rows[0].first_name} ${rows[0].last_name}` }, assignedTo: rows[0].assigned_to, messages: await messagesFor(db, id, true) };
}
export async function staffReply(ctx, id, { message, internal = false, status }, files) {
  const db = getDb();
  const t0 = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Support request not found.');
    const { rows: m } = await t.query("INSERT INTO support_messages (ticket_id, author_id, author_type, body, internal) VALUES ($1,$2,'staff',$3,$4) RETURNING id", [id, ctx.actor.id, message, internal]);
    await storeAttachments(t, m[0].id, files);
    const next = status || (!internal && rows[0].status === 'open' ? 'waiting_for_customer' : rows[0].status);
    await t.query('UPDATE support_tickets SET status=$2, assigned_to=COALESCE(assigned_to,$3), updated_at=now() WHERE id=$1', [id, next, ctx.actor.id]);
    await audit.record(t, ctx, { action: internal ? 'support.internal_note' : 'support.staff_reply', targetType: 'support_ticket', targetId: id, previous: { status: rows[0].status }, next: { status: next } });
    return rows[0];
  });
  if (!internal) {
    const { rows } = await db.query('SELECT first_name FROM users WHERE id=$1', [t0.user_id]);
    await notify(t0.user_id, { category: 'support', title: `New reply on ${t0.reference}`, body: 'EWB Bank Support replied to your request.', link: `/app/support/${id}`,
      email: { template: 'support_notification', data: { firstName: rows[0].first_name, heading: 'You have a new reply', message: 'EWB Bank Support replied to your request. Sign in to read the response.', reference: t0.reference, subject: t0.subject, statusLabel: STATUS_LABELS[status || 'waiting_for_customer'], ticketId: id } } });
  }
  return adminGet(id);
}
export async function setStatus(ctx, id, status) {
  const db = getDb();
  const out = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Support request not found.');
    await t.query('UPDATE support_tickets SET status=$2, updated_at=now() WHERE id=$1', [id, status]);
    await audit.record(t, ctx, { action: 'support.status', targetType: 'support_ticket', targetId: id, previous: { status: rows[0].status }, next: { status } });
    return rows[0];
  });
  await notify(out.user_id, { category: 'support', title: `${out.reference}: ${STATUS_LABELS[status]}`, body: `Your support request is now "${STATUS_LABELS[status]}".`, link: `/app/support/${id}` });
  return adminGet(id);
}
export async function assign(ctx, id, assigneeId) {
  const db = getDb();
  await db.tx(async (t) => {
    const { rows } = await t.query('SELECT assigned_to FROM support_tickets WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Support request not found.');
    await t.query('UPDATE support_tickets SET assigned_to=$2, updated_at=now() WHERE id=$1', [id, assigneeId]);
    await audit.record(t, ctx, { action: 'support.assign', targetType: 'support_ticket', targetId: id, previous: { assignedTo: rows[0].assigned_to }, next: { assignedTo: assigneeId } });
  });
  return adminGet(id);
}
