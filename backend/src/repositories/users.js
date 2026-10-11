// User persistence. Columns that carry authority (role, status, verification_status, mfa_*) can only be
// written by service code that has already performed its own authorization; request bodies are never
// spread into these queries.
const UPDATABLE = new Set([
  'first_name', 'last_name', 'phone', 'phone_verified_at', 'date_of_birth', 'address_line1', 'city', 'state', 'postal_code',
  'country', 'role', 'status', 'email_verified_at', 'verification_status', 'failed_login_count', 'locked_until',
  'password_hash', 'password_changed_at', 'mfa_enabled', 'mfa_secret_enc', 'mfa_pending_secret_enc', 'profile_photo_path',
  'last_login_at', 'username', 'mfa_last_step',
]);

export const ADMIN_ROLES = ['super_admin', 'compliance_admin', 'support_agent', 'finance_operator', 'security_admin'];

export async function findById(q, id) {
  const { rows } = await q.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}
export async function findByEmail(q, email) {
  const { rows } = await q.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}
export async function findByIdentifier(q, identifier) {
  const { rows } = await q.query('SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1) LIMIT 1', [identifier]);
  return rows[0] || null;
}
export async function create(q, u) {
  const { rows } = await q.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, phone, date_of_birth, address_line1, city, state, postal_code, country, role, status, email_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [u.email, u.username ?? null, u.passwordHash, u.firstName, u.lastName, u.phone ?? null, u.dateOfBirth ?? null, u.addressLine1 ?? null,
      u.city ?? null, u.state ?? null, u.postalCode ?? null, u.country ?? null, u.role ?? 'customer', u.status ?? 'active', u.emailVerifiedAt ?? null],
  );
  return rows[0];
}
export async function update(q, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return findById(q, id);
  for (const k of keys) if (!UPDATABLE.has(k)) throw new Error(`Column not updatable: ${k}`);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await q.query(`UPDATE users SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => fields[k])]);
  return rows[0] || null;
}

// Shape returned to clients: never includes hashes, secrets or storage internals.
export function toPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    phone: u.phone,
    phoneVerified: !!u.phone_verified_at,
    dateOfBirth: u.date_of_birth ? String(u.date_of_birth).slice(0, 10) : null,
    address: { line1: u.address_line1, city: u.city, state: u.state, postalCode: u.postal_code, country: u.country },
    role: u.role,
    isStaff: ADMIN_ROLES.includes(u.role),
    status: u.status,
    emailVerified: !!u.email_verified_at,
    verificationStatus: u.verification_status,
    mfaEnabled: u.mfa_enabled,
    hasProfilePhoto: !!u.profile_photo_path,
    // Changes whenever the photo changes (it is the random object name, not the storage path); the client puts it in the image
    // URL so a new photo is never masked by a cached old one and an unchanged photo stays cached.
    profilePhotoVersion: u.profile_photo_path ? String(u.profile_photo_path).split('/').pop().replace(/\.[a-z]+$/i, '') : null,
    passwordChangedAt: u.password_changed_at,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  };
}
