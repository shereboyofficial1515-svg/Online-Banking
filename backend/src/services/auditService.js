// Append-only audit trail. The table has triggers that reject UPDATE and DELETE, so entries written
// here are permanent. Always call with the same transaction handle as the action being audited so the
// audit row and the change commit (or roll back) together.
import { getDb } from '../db/index.js';

export async function record(q, ctx, e) {
  await q.query(
    `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, account_id, previous_state, new_state, reason, ip, user_agent, session_id, device_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb)`,
    [
      e.actorId ?? ctx?.actor?.id ?? null, e.actorRole ?? ctx?.actor?.role ?? null, e.action, e.targetType ?? null, e.targetId ? String(e.targetId) : null,
      e.accountId ?? null, e.previous === undefined ? null : JSON.stringify(e.previous), e.next === undefined ? null : JSON.stringify(e.next),
      e.reason ?? null, ctx?.ip ?? null, ctx?.userAgent ?? null, ctx?.sessionId ?? null, ctx?.deviceId ?? null, JSON.stringify(e.metadata ?? {}),
    ],
  );
}

export async function list({ actorId, action, accountId, targetId, from, to, limit = 50, offset = 0 }) {
  const where = [];
  const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (actorId) add('a.actor_id = ?', actorId);
  if (action) add('a.action ILIKE ?', `%${action}%`);
  if (accountId) add('a.account_id = ?', accountId);
  if (targetId) add('a.target_id = ?', targetId);
  if (from) add('a.created_at >= ?', from);
  if (to) add('a.created_at <= ?', to);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const { rows } = await db.query(
    `SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${w} ORDER BY a.created_at DESC, a.id LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(offset, 0)}`, p);
  const total = (await db.query(`SELECT count(*)::bigint AS n FROM audit_logs a ${w}`, p)).rows[0].n;
  return { items: rows, total };
}
