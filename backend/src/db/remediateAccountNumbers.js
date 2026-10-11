// Remediation for customer accounts that predate the 12-digit "605" format.
//
//   node src/db/remediateAccountNumbers.js            -> DRY RUN (default): lists affected accounts and what depends on them
//   node src/db/remediateAccountNumbers.js --apply    -> renumbers ONLY accounts with no activity (see rules below)
//
// Safety rules:
//  * Dry run is the default and changes nothing.
//  * Only accounts with zero ledger entries, zero transactions and zero withdrawal requests are renumbered: nothing in the
//    system has ever referenced their number except the owner. Accounts with activity are reported, never touched.
//  * Every relationship uses the account's UUID, never the number, so history/ledger/withdrawals are unaffected either way.
//  * The old number is kept in legacy_account_number and keeps resolving in transfer lookups, so a number someone already
//    shared still works.
//  * Runs in one transaction, writes an audit entry per account, and prints the rollback statement for each change.
//  Rollback for one account:  SET LOCAL ewb.allow_account_renumber='on'; UPDATE accounts SET account_number = legacy_account_number,
//                             legacy_account_number = NULL WHERE id = '<id>';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initDb, closeDb } from './index.js';
import { assertConfig, ConfigError } from '../config/index.js';
import { newAccountNumber } from '../utils/crypto.js';

const FORMAT = /^605\d{9}$/;

export async function plan(db) {
  const { rows } = await db.query("SELECT id, user_id, account_number, status FROM accounts WHERE kind='customer' AND account_number !~ '^605[0-9]{9}$' ORDER BY created_at");
  const out = [];
  for (const a of rows) {
    const n = async (sql) => (await db.query(sql, [a.id])).rows[0].n;
    const ledgerEntries = await n('SELECT count(*)::int n FROM ledger_entries WHERE account_id=$1');
    const transactions = await n('SELECT count(*)::int n FROM transactions WHERE account_id=$1 OR counterparty_account_id=$1');
    const withdrawals = await n('SELECT count(*)::int n FROM withdrawal_requests WHERE account_id=$1');
    out.push({ ...a, ledgerEntries, transactions, withdrawals, safeToRenumber: ledgerEntries + transactions + withdrawals === 0 });
  }
  return out;
}

export async function apply(db, { generate = newAccountNumber } = {}) {
  const candidates = (await plan(db)).filter((a) => a.safeToRenumber);
  const changed = [];
  await db.tx(async (t) => {
    await t.query("SELECT set_config('ewb.allow_account_renumber', 'on', true)"); // transaction-local opt-in
    for (const a of candidates) {
      let next;
      for (let i = 0; i < 10 && !next; i++) {
        const candidate = generate();
        if (!FORMAT.test(candidate)) throw new Error('generator returned a non-conforming number');
        const taken = await t.query('SELECT 1 FROM accounts WHERE account_number=$1 OR legacy_account_number=$1', [candidate]);
        if (!taken.rows.length) next = candidate;
      }
      if (!next) throw new Error('could not allocate a unique account number');
      await t.query('UPDATE accounts SET account_number=$2, legacy_account_number=$3 WHERE id=$1', [a.id, next, a.account_number]);
      await t.query(
        `INSERT INTO audit_logs (action, target_type, target_id, account_id, previous_state, new_state, reason, metadata)
         VALUES ('account.renumber','account',$1::text,$1::uuid,$2::jsonb,$3::jsonb,'Standardise account number to the 605 format',$4::jsonb)`,
        [a.id, JSON.stringify({ accountNumber: a.account_number }), JSON.stringify({ accountNumber: next }), JSON.stringify({ script: 'remediateAccountNumbers' })]);
      changed.push({ id: a.id, from: a.account_number, to: next });
    }
  });
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { assertConfig(); } catch (e) { if (e instanceof ConfigError) { console.error(`\n${e.message}\n`); process.exit(1); } throw e; }
  const db = await initDb();
  try {
    const rows = await plan(db);
    console.log(`Accounts not in the 605 format: ${rows.length}`);
    for (const r of rows) console.log(`  ${r.id}  ${r.account_number}  status=${r.status}  ledgerEntries=${r.ledgerEntries} transactions=${r.transactions} withdrawals=${r.withdrawals}  -> ${r.safeToRenumber ? 'safe to renumber (no activity)' : 'HAS ACTIVITY: left unchanged'}`);
    if (process.argv.includes('--apply')) {
      const changed = await apply(db);
      console.log(changed.length ? `Renumbered ${changed.length}:` : 'Nothing to renumber.');
      for (const c of changed) console.log(`  ${c.from} -> ${c.to}   rollback: SET LOCAL ewb.allow_account_renumber='on'; UPDATE accounts SET account_number='${c.from}', legacy_account_number=NULL WHERE id='${c.id}';`);
    } else console.log('Dry run only. Re-run with --apply to renumber the accounts marked safe.');
  } finally { await closeDb(); }
}
