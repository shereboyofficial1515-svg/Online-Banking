// Development / staging seed ONLY. Refuses to run when seeding is disabled (production default).
// - Creates one staff user per role and a few customers with RANDOM passwords written to .data/dev-credentials.json (git-ignored).
// - Customer balances are funded through the real ledger service as an audited staff adjustment, never by editing balances.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import config, { assertConfig } from '../../config/index.js';
import { initDb, closeDb } from '../index.js';
import { migrate } from '../migrate.js';
import { initProviders } from '../../providers/index.js';
import * as users from '../../repositories/users.js';
import * as accounts from '../../services/accountService.js';
import * as ledger from '../../services/ledgerService.js';
import * as mfa from '../../services/mfaService.js';
import { hashPassword } from '../../utils/passwords.js';

if (!config.seedEnabled) { console.error('Seeding is disabled in this environment (set ALLOW_SEED=true to override).'); process.exit(1); }
assertConfig();
const db = await initDb();
if (db.driver === 'pglite') await migrate(db);
initProviders();

const pw = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1!`;
const creds = { note: 'Development credentials. Never use these outside local development.', staff: [], customers: [] };

for (const [role, first] of [['super_admin', 'Sam'], ['compliance_admin', 'Casey'], ['support_agent', 'Sky'], ['finance_operator', 'Finley'], ['security_admin', 'Sasha']]) {
  const email = `${role.replace('_', '.')}@ewb.test`;
  if (await users.findByEmail(db, email)) continue;
  const password = pw();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const u = await users.create(db, { email, firstName: first, lastName: 'Staff', passwordHash: await hashPassword(password), role, status: 'active', emailVerifiedAt: new Date() });
  await users.update(db, u.id, { mfa_enabled: true, mfa_secret_enc: mfa.encryptTotpSecret(secret) });
  creds.staff.push({ email, password, role, totpSecretBase32: secret });
}

const finance = await users.findByEmail(db, 'finance.operator@ewb.test');
for (const [first, last] of [['Avery', 'Morgan'], ['Jordan', 'Lee']]) {
  const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.test`;
  if (await users.findByEmail(db, email)) continue;
  const password = pw();
  const u = await users.create(db, {
    email, firstName: first, lastName: last, passwordHash: await hashPassword(password), phone: '+15555550100', dateOfBirth: '1990-04-12',
    addressLine1: '100 Market Street', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US', emailVerifiedAt: new Date(),
  });
  const acct = await accounts.openDefaultAccount(db, u.id);
  await db.query("UPDATE accounts SET status='active' WHERE id=$1", [acct.id]);
  await users.update(db, u.id, { verification_status: 'verified' });
  if (finance) {
    await ledger.adjust({ actor: { id: finance.id, role: finance.role }, ip: 'seed', userAgent: 'seed-script' }, {
      accountId: acct.id, direction: 'credit', amountMinor: 2_500_00, currency: acct.currency, reason: 'Development seed: initial test-ledger funding', idempotencyKey: `seed-${u.id}`,
    });
  }
  creds.customers.push({ email, password });
}

fs.mkdirSync('.data', { recursive: true });
fs.writeFileSync('.data/dev-credentials.json', JSON.stringify(creds, null, 2));
console.log(`Seed complete. Credentials written to .data/dev-credentials.json (${creds.staff.length} staff, ${creds.customers.length} customers).`);
await closeDb();
