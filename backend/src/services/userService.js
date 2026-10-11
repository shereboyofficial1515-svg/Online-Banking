import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { providers } from '../providers/index.js';
import { sniffMime, EXT } from '../providers/storage.js';
import * as users from '../repositories/users.js';
import * as audit from './auditService.js';
import { randomToken } from '../utils/crypto.js';
import { verifyPassword } from '../utils/passwords.js';
import { normalizePhone, matchesCountry } from '../utils/phone.js';
import { badRequest, notFound, validationError } from '../utils/errors.js';

/** Customers may change contact details and address. Name, email and date of birth are identity data and go through support. */
export async function updateProfile(ctx, user, input) {
  const fields = {};
  const phoneChanging = input.phone !== undefined && input.phone !== (user.phone_e164 || null);
  if (phoneChanging && !(input.currentPassword && await verifyPassword(user.password_hash, input.currentPassword))) {
    throw validationError({ currentPassword: ['Enter your current password to change your phone number.'] }); // the phone number is a recovery/contact channel
  }
  const map = { addressLine1: 'address_line1', city: 'city', state: 'state', postalCode: 'postal_code', country: 'country' };
  for (const [k, col] of Object.entries(map)) if (input[k] !== undefined) fields[col] = input[k] || null;
  if (input.phone !== undefined) {
    // already validated and converted to E.164 by the request schema; a profile always keeps a phone number once it has one
    const parsed = normalizePhone(input.phone);
    if (!parsed) throw validationError({ phone: ['Enter a valid phone number.'] });
    if (input.phoneCountry && !matchesCountry(parsed, input.phoneCountry)) throw validationError({ phone: ['The phone number does not match the selected country.'] });
    const clash = await getDb().query('SELECT 1 FROM users WHERE phone_e164=$1 AND id<>$2', [parsed.e164, user.id]);
    if (clash.rows[0]) throw validationError({ phone: ['This phone number cannot be used. Check the number and try again.'] });
    fields.phone = parsed.e164; fields.phone_e164 = parsed.e164;
    if (parsed.e164 !== user.phone_e164) fields.phone_verified_at = null; // a new number is unverified
  }
  const db = getDb();
  const updated = await db.tx(async (t) => {
    const u = await users.update(t, user.id, fields);
    await audit.record(t, ctx, { action: 'profile.update', targetType: 'user', targetId: user.id, previous: Object.fromEntries(Object.keys(fields).map((c) => [c, user[c]])), next: fields });
    return u;
  });
  return users.toPublic(updated);
}

/**
 * Replaces the profile photo. Order matters so a failure can never lose the existing photo:
 *   1. store the new object under a fresh random name (the old object is untouched);
 *   2. in one transaction, point the user row at it (row locked, so two uploads cannot orphan each other);
 *   3. only after that commits, delete the previous object.
 * If step 2 fails the new object is removed and the error is raised, so the old photo stays and nothing is orphaned.
 * Returns the updated profile so the client can show the confirmed result.
 */
export async function setProfilePhoto(ctx, user, file) {
  if (!file) throw badRequest('Choose an image to upload.');
  const mime = sniffMime(file.buffer);
  if (!mime || mime === 'application/pdf') throw badRequest('Profile photos must be JPEG, PNG or WebP images.');
  const path = `${user.id}/${randomToken(10)}.${EXT[mime]}`;
  const bucket = config.supabase.bucketProfile;
  const storage = providers().storage;
  await storage.put({ bucket, path, buffer: file.buffer, mime });
  const db = getDb();
  let previous = null; let updated;
  try {
    updated = await db.tx(async (t) => {
      const cur = (await t.query('SELECT profile_photo_path FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
      previous = cur?.profile_photo_path || null;
      const row = await users.update(t, user.id, { profile_photo_path: path });
      await audit.record(t, ctx, { action: 'profile.photo', targetType: 'user', targetId: user.id });
      return row;
    });
  } catch (e) {
    await storage.remove({ bucket, path }).catch(() => {});
    throw e;
  }
  if (previous) await storage.remove({ bucket, path: previous }).catch(() => {});
  return { ok: true, user: users.toPublic(updated) };
}

export async function getProfilePhoto(user) {
  if (!user.profile_photo_path) throw notFound('No profile photo.');
  const path = user.profile_photo_path;
  const mime = path.endsWith('png') ? 'image/png' : path.endsWith('webp') ? 'image/webp' : 'image/jpeg';
  return { buffer: await providers().storage.get({ bucket: config.supabase.bucketProfile, path }), mime };
}
