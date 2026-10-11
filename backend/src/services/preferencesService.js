import { getDb } from '../db/index.js';
import { validationError } from '../utils/errors.js';

export const LANGUAGES = ['en']; // only languages whose interface translations actually exist are offered

export const DEFAULT_DASHBOARD = { showChart: true, showMoneyInOut: true, showRecent: true, showSecurity: true, defaultAccountId: null };
export const DEFAULTS = {
  theme: 'system', language: 'en', textSize: 'default', motion: 'system', contrast: 'standard', timezone: null,
  dateFormat: 'system', timeFormat: 'system', numberFormat: 'system', currencyDisplay: 'symbol', dashboard: DEFAULT_DASHBOARD,
};

let zoneSet;
export const isValidTimezone = (z) => {
  zoneSet ||= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  return zoneSet.has(z);
};

const toDto = (r) => (!r ? { ...DEFAULTS } : {
  theme: r.theme, language: r.language, textSize: r.text_size, motion: r.motion, contrast: r.contrast, timezone: r.timezone,
  dateFormat: r.date_format, timeFormat: r.time_format, numberFormat: r.number_format, currencyDisplay: r.currency_display,
  dashboard: { ...DEFAULT_DASHBOARD, ...(typeof r.dashboard === 'string' ? JSON.parse(r.dashboard) : r.dashboard) },
});

export async function get(userId) {
  const { rows } = await getDb().query('SELECT * FROM user_preferences WHERE user_id=$1', [userId]);
  return toDto(rows[0]);
}

/** Partial update. Anything not supplied keeps its stored value. Presentation only: never touches financial data. */
export async function update(userId, patch) {
  const db = getDb();
  const cur = await get(userId);
  const next = { ...cur, ...patch, dashboard: { ...cur.dashboard, ...(patch.dashboard || {}) } };
  const errors = {};
  if (next.timezone && !isValidTimezone(next.timezone)) errors.timezone = ['Choose a valid timezone.'];
  if (!LANGUAGES.includes(next.language)) errors.language = ['That language is not available.'];
  if (next.dashboard.defaultAccountId) {
    const { rows } = await db.query('SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2', [next.dashboard.defaultAccountId, userId]);
    if (!rows[0]) errors['dashboard.defaultAccountId'] = ['Choose one of your own accounts.']; // never trust an id from the client
  }
  if (Object.keys(errors).length) throw validationError(errors);
  await db.query(
    `INSERT INTO user_preferences (user_id, theme, language, text_size, motion, contrast, timezone, date_format, time_format, number_format, currency_display, dashboard, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET theme=EXCLUDED.theme, language=EXCLUDED.language, text_size=EXCLUDED.text_size, motion=EXCLUDED.motion,
       contrast=EXCLUDED.contrast, timezone=EXCLUDED.timezone, date_format=EXCLUDED.date_format, time_format=EXCLUDED.time_format,
       number_format=EXCLUDED.number_format, currency_display=EXCLUDED.currency_display, dashboard=EXCLUDED.dashboard, updated_at=now()`,
    [userId, next.theme, next.language, next.textSize, next.motion, next.contrast, next.timezone, next.dateFormat, next.timeFormat, next.numberFormat, next.currencyDisplay, JSON.stringify(next.dashboard)]);
  return get(userId);
}
