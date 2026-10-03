// Bootstrap the first Super Admin:  ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin
// The password comes from the environment (never from source control). The admin must enrol MFA at first sign-in.
import config, { assertConfig } from '../../config/index.js';
import { initDb, closeDb } from '../index.js';
import { migrate } from '../migrate.js';
import * as users from '../../repositories/users.js';
import { hashPassword, passwordProblems } from '../../utils/passwords.js';

assertConfig();
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!email || !password) { console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD.'); process.exit(1); }
const problems = passwordProblems(password, { email });
if (problems.length) { console.error(`ADMIN_PASSWORD needs ${problems.join(', ')}.`); process.exit(1); }

const db = await initDb();
if (db.driver === 'pglite') await migrate(db);
if (await users.findByEmail(db, email)) { console.error('A user with that email already exists.'); process.exit(1); }
const u = await users.create(db, {
  email, firstName: process.env.ADMIN_FIRST_NAME || 'System', lastName: process.env.ADMIN_LAST_NAME || 'Administrator',
  passwordHash: await hashPassword(password), role: 'super_admin', status: 'active', emailVerifiedAt: new Date(),
});
await db.query("INSERT INTO audit_logs (action, target_type, target_id, new_state, metadata) VALUES ('staff.bootstrap','user',$1,$2::jsonb,'{}')", [u.id, JSON.stringify({ role: 'super_admin', email })]);
console.log(`Super Admin created for ${email}. Sign in and enrol multi-factor authentication (${config.env}).`);
await closeDb();
