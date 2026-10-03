import { getDb } from '../db/index.js';
import { sendEmail } from './emailService.js';
import { notFound } from '../utils/errors.js';

export const CATEGORIES = ['security', 'account', 'verification', 'transaction', 'withdrawal', 'support', 'system'];

async function prefFor(q, userId, category) {
  const { rows } = await q.query('SELECT in_app, email FROM notification_preferences WHERE user_id=$1 AND category=$2', [userId, category]);
  return rows[0] || { in_app: true, email: true };
}

// Single entry point for telling a customer something: in-app notification + optional templated email.
// Security notifications cannot be switched off. Delivery is best-effort and never throws.
export async function notify(userId, { category, title, body, link = null, email }) {
  const db = getDb();
  try {
    const { rows } = await db.query('SELECT id, email FROM users WHERE id=$1', [userId]);
    const user = rows[0];
    if (!user) return;
    const pref = category === 'security' ? { in_app: true, email: true } : await prefFor(db, userId, category);
    if (pref.in_app) {
      await db.query('INSERT INTO notifications (user_id, category, title, body, link) VALUES ($1,$2,$3,$4,$5)', [userId, category, title, body, link]);
    }
    if (email && pref.email) {
      await sendEmail({ to: user.email, userId, template: email.template, data: email.data });
    }
  } catch {
    /* notification failure must not fail the caller */
  }
}

export async function list(userId, { unreadOnly, category, limit = 50, offset = 0 }) {
  const db = getDb();
  const p = [userId];
  let w = 'user_id=$1';
  if (unreadOnly) w += ' AND read_at IS NULL';
  if (category && CATEGORIES.includes(category)) { p.push(category); w += ` AND category=$${p.length}`; }
  const { rows } = await db.query(`SELECT * FROM notifications WHERE ${w} ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)} OFFSET ${Math.max(offset, 0)}`, p);
  const unread = (await db.query('SELECT count(*)::bigint n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [userId])).rows[0].n;
  return { items: rows.map(toDto), unread };
}
const toDto = (n) => ({ id: n.id, category: n.category, title: n.title, body: n.body, link: n.link, read: !!n.read_at, createdAt: n.created_at });

export async function markRead(userId, id) {
  const { rowCount } = await getDb().query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!rowCount) throw notFound('Notification not found.');
}
export async function markAllRead(userId) {
  await getDb().query('UPDATE notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL', [userId]);
}

export async function getPreferences(userId) {
  const { rows } = await getDb().query('SELECT category, in_app, email FROM notification_preferences WHERE user_id=$1', [userId]);
  const map = new Map(rows.map((r) => [r.category, r]));
  return CATEGORIES.map((c) => ({
    category: c,
    inApp: map.get(c)?.in_app ?? true,
    email: map.get(c)?.email ?? true,
    locked: c === 'security',
  }));
}
export async function setPreferences(userId, prefs) {
  const db = getDb();
  for (const p of prefs) {
    if (!CATEGORIES.includes(p.category) || p.category === 'security') continue; // security is always on
    await db.query(
      `INSERT INTO notification_preferences (user_id, category, in_app, email) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, category) DO UPDATE SET in_app = EXCLUDED.in_app, email = EXCLUDED.email`,
      [userId, p.category, !!p.inApp, !!p.email],
    );
  }
  return getPreferences(userId);
}
