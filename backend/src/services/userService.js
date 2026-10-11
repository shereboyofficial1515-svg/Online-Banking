import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { providers } from '../providers/index.js';
import { sniffMime, EXT } from '../providers/storage.js';
import * as users from '../repositories/users.js';
import * as audit from './auditService.js';
import { randomToken } from '../utils/crypto.js';
import { verifyPassword } from '../utils/passwords.js';
import { badRequest, notFound, validationError } from '../utils/errors.js';

/** Customers may change contact details and address. Name, email and date of birth are identity data and go through support. */
export async function updateProfile(ctx, user, input) {
  const fields = {};
  const phoneChanging = input.phone !== undefined && (input.phone || null) !== (user.phone || null);
  if (phoneChanging && !(input.currentPassword && await verifyPassword(user.password_hash, input.currentPassword))) {
    throw validationError({ currentPassword: ['Enter your current password to change your phone number.'] }); // the phone number is a recovery/contact channel
  }
  const map = { phone: 'phone', addressLine1: 'address_line1', city: 'city', state: 'state', postalCode: 'postal_code', country: 'country' };
  for (const [k, col] of Object.entries(map)) if (input[k] !== undefined) fields[col] = input[k] || null;
  if (fields.phone !== undefined && fields.phone !== user.phone) fields.phone_verified_at = null; // a new number is unverified
  const db = getDb();
  const updated = await db.tx(async (t) => {
    const u = await users.update(t, user.id, fields);
    await audit.record(t, ctx, { action: 'profile.update', targetType: 'user', targetId: user.id, previous: Object.fromEntries(Object.keys(fields).map((c) => [c, user[c]])), next: fields });
    return u;
  });
  return users.toPublic(updated);
}

export async function setProfilePhoto(ctx, user, file) {
  if (!file) throw badRequest('Choose an image to upload.');
  const mime = sniffMime(file.buffer);
  if (!mime || mime === 'application/pdf') throw badRequest('Profile photos must be JPEG, PNG or WebP images.');
  const path = `${user.id}/${randomToken(10)}.${EXT[mime]}`;
  const bucket = config.supabase.bucketProfile;
  await providers().storage.put({ bucket, path, buffer: file.buffer, mime });
  const db = getDb();
  if (user.profile_photo_path) await providers().storage.remove({ bucket, path: user.profile_photo_path }).catch(() => {});
  await users.update(db, user.id, { profile_photo_path: path });
  await audit.record(db, ctx, { action: 'profile.photo', targetType: 'user', targetId: user.id });
  return { ok: true };
}

export async function getProfilePhoto(user) {
  if (!user.profile_photo_path) throw notFound('No profile photo.');
  const path = user.profile_photo_path;
  const mime = path.endsWith('png') ? 'image/png' : path.endsWith('webp') ? 'image/webp' : 'image/jpeg';
  return { buffer: await providers().storage.get({ bucket: config.supabase.bucketProfile, path }), mime };
}
