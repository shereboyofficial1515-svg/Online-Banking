// Fills `phone_e164` for customers who registered before phone numbers were mandatory, but ONLY where the stored text is already
// a valid international number (it starts with "+" and passes per-country validation) and is not used by another profile.
// Nothing is guessed: a number without a country code stays as it is and the customer is asked to add a valid one.
//
//   node src/db/backfillPhones.js            -> DRY RUN (default): lists what would change
//   node src/db/backfillPhones.js --apply    -> writes the normalised numbers (never marks anything as verified)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initDb, closeDb } from './index.js';
import { assertConfig, ConfigError } from '../config/index.js';
import { normalizePhone } from '../utils/phone.js';

export async function plan(db) {
  const { rows } = await db.query("SELECT id, phone FROM users WHERE phone_e164 IS NULL AND phone IS NOT NULL AND btrim(phone) <> '' AND role='customer' ORDER BY created_at");
  const seen = new Map();
  const out = [];
  for (const r of rows) {
    const n = normalizePhone(r.phone);
    if (!n) { out.push({ id: r.id, original: r.phone, action: 'needs_update', reason: 'not a valid international number' }); continue; }
    const clash = (await db.query('SELECT 1 FROM users WHERE phone_e164=$1', [n.e164])).rows[0] || seen.has(n.e164);
    if (clash) { out.push({ id: r.id, original: r.phone, action: 'needs_update', reason: 'number already used by another profile' }); continue; }
    seen.set(n.e164, r.id);
    out.push({ id: r.id, original: r.phone, action: 'normalise', e164: n.e164 });
  }
  return out;
}

export async function apply(db) {
  const items = await plan(db);
  let changed = 0;
  await db.tx(async (t) => {
    for (const i of items.filter((x) => x.action === 'normalise')) {
      const r = await t.query('UPDATE users SET phone=$2, phone_e164=$2 WHERE id=$1 AND phone_e164 IS NULL', [i.id, i.e164]);
      changed += r.rowCount;
    }
  });
  return { items, changed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    assertConfig();
    const db = await initDb();
    if (process.argv.includes('--apply')) {
      const { items, changed } = await apply(db);
      console.log(`${changed} number(s) normalised; ${items.filter((i) => i.action === 'needs_update').length} customer(s) will be asked to add a valid number.`);
    } else {
      const items = await plan(db);
      for (const i of items) console.log(`${i.id}  ${i.action}${i.e164 ? ` -> ${i.e164}` : ` (${i.reason})`}`);
      console.log(`Dry run only (${items.length} customer(s) without a normalised number). Re-run with --apply to write the valid ones.`);
    }
    await closeDb();
  } catch (e) { console.error(e instanceof ConfigError ? e.message : e); process.exit(1); }
}
