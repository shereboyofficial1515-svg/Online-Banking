// Management-controlled feature switches stored in the database (table app_settings), so they can be changed from the admin
// console without a redeploy. A switch with no row is OFF: savings is unavailable until an authorised administrator turns it on.
import { getDb } from '../db/index.js';
import * as audit from './auditService.js';
import { AppError } from '../utils/errors.js';

export const SAVINGS_KEY = 'savings.enabled';
export const SAVINGS_UNAVAILABLE_MESSAGE = 'Savings is not available at the moment. Please check back later for updates.';

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function isSavingsEnabled(q = getDb()) {
  const { rows } = await q.query('SELECT value FROM app_settings WHERE key=$1', [SAVINGS_KEY]);
  return rows[0] ? parse(rows[0].value)?.enabled === true : false;
}

/** Server-side gate for every savings workflow. Direct API calls hit this, so hiding a button is never the only protection. */
export async function assertSavingsEnabled(q = getDb()) {
  if (!(await isSavingsEnabled(q))) throw new AppError(403, 'SAVINGS_UNAVAILABLE', SAVINGS_UNAVAILABLE_MESSAGE);
}

export async function getSavingsSetting() {
  const { rows } = await getDb().query('SELECT s.value, s.updated_at, u.email AS updated_by_email FROM app_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.key=$1', [SAVINGS_KEY]);
  const r = rows[0];
  return { enabled: r ? parse(r.value)?.enabled === true : false, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by_email ?? null, configured: !!r };
}

export async function setSavings(ctx, { enabled, reason }) {
  const db = getDb();
  await db.tx(async (t) => {
    const before = await isSavingsEnabled(t);
    await t.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [SAVINGS_KEY, JSON.stringify({ enabled: !!enabled }), ctx.actor.id]);
    await audit.record(t, ctx, { action: enabled ? 'feature.savings_enable' : 'feature.savings_disable', targetType: 'setting', targetId: SAVINGS_KEY, reason, previous: { enabled: before }, next: { enabled: !!enabled } });
  });
  return getSavingsSetting();
}
