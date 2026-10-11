// Management-controlled switches stored in the database (table app_settings), so they can be changed from the admin console
// without a redeploy. A switch with no row is OFF: savings and transfers are unavailable until an authorised administrator turns
// them on. (For transfers "off" means the maintenance message is shown and the backend refuses to move money.)
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import * as audit from './auditService.js';
import { AppError } from '../utils/errors.js';

export const FEATURES = { savings: 'savings.enabled', transfers: 'transfers.enabled' };
export const SAVINGS_UNAVAILABLE_MESSAGE = 'Savings is currently unavailable. Please check back later.';
export const TRANSFERS_UNAVAILABLE_MESSAGE = 'Transfers are currently unavailable while we carry out maintenance. Please contact our customer support team for more information.';

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
/** The configured customer-support address, or null when none is configured (never invented). */
export const supportEmail = () => (config.email.supportEmail && !config.email.supportEmail.endsWith('.invalid') ? config.email.supportEmail : null);

export async function isEnabled(name, q = getDb()) {
  const { rows } = await q.query('SELECT value FROM app_settings WHERE key=$1', [FEATURES[name]]);
  return rows[0] ? parse(rows[0].value)?.enabled === true : false;
}
export const isSavingsEnabled = (q) => isEnabled('savings', q);

/** Server-side gates. Direct API calls hit these, so hiding a button is never the only protection. */
export async function assertSavingsEnabled(q = getDb()) {
  if (!(await isEnabled('savings', q))) throw new AppError(403, 'SAVINGS_UNAVAILABLE', SAVINGS_UNAVAILABLE_MESSAGE);
}
export async function assertTransfersEnabled(q = getDb()) {
  if (!(await isEnabled('transfers', q))) throw new AppError(503, 'TRANSFERS_UNAVAILABLE', TRANSFERS_UNAVAILABLE_MESSAGE, { supportEmail: supportEmail() });
}

export async function getFeature(name) {
  const { rows } = await getDb().query('SELECT s.value, s.updated_at, u.email AS updated_by_email FROM app_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.key=$1', [FEATURES[name]]);
  const r = rows[0];
  return { enabled: r ? parse(r.value)?.enabled === true : false, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by_email ?? null, configured: !!r };
}
export const getSavingsSetting = () => getFeature('savings');

export async function setFeature(ctx, name, { enabled, reason }) {
  const db = getDb();
  await db.tx(async (t) => {
    const before = await isEnabled(name, t);
    await t.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [FEATURES[name], JSON.stringify({ enabled: !!enabled }), ctx.actor.id]);
    await audit.record(t, ctx, { action: `feature.${name}_${enabled ? 'enable' : 'disable'}`, targetType: 'setting', targetId: FEATURES[name], reason, previous: { enabled: before }, next: { enabled: !!enabled } });
  });
  return getFeature(name);
}
export const setSavings = (ctx, body) => setFeature(ctx, 'savings', body);
