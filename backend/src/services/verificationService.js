// Identity verification orchestration. Provider-specific work lives behind IdentityVerificationProvider
// (providers/identity.js). This service stores only the minimum: status, provider reference, and (for the manual
// provider) the uploaded document files in private storage. It never derives or keeps biometric templates.
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { providers } from '../providers/index.js';
import { sniffMime, EXT } from '../providers/storage.js';
import * as audit from './auditService.js';
import { notify } from './notificationService.js';
import { randomToken } from '../utils/crypto.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

export const STATUS_LABELS = {
  not_started: 'Not started', pending: 'Pending', verification_required: 'Verification required', verified: 'Verified',
  failed: 'Failed', expired: 'Expired', manual_review: 'Manual review',
};
const KINDS = ['id_front', 'id_back', 'selfie', 'proof_of_address'];

async function setStatus(q, ctx, v, status, { reason = null, reviewerId = null, systemActor = false } = {}) {
  await q.query('UPDATE identity_verifications SET status=$2, review_reason=$3, reviewed_by=$4, updated_at=now() WHERE id=$1', [v.id, status, reason, reviewerId]);
  await q.query('UPDATE users SET verification_status=$2, updated_at=now() WHERE id=$1', [v.user_id, status]);
  await audit.record(q, ctx, {
    actorId: systemActor ? null : undefined, action: 'verification.status', targetType: 'identity_verification', targetId: v.id,
    previous: { status: v.status }, next: { status }, reason, metadata: { userId: v.user_id, provider: v.provider },
  });
}

async function announce(userId, status, reason) {
  const { rows } = await getDb().query('SELECT first_name FROM users WHERE id=$1', [userId]);
  await notify(userId, {
    category: 'verification', title: `Identity verification: ${STATUS_LABELS[status]}`, link: '/app/verification',
    body: reason ? `Your verification status is now "${STATUS_LABELS[status]}". ${reason}` : `Your verification status is now "${STATUS_LABELS[status]}".`,
    email: { template: 'identity_status', data: { firstName: rows[0]?.first_name, statusLabel: STATUS_LABELS[status], reason } },
  });
}

async function latest(q, userId) {
  const { rows } = await q.query('SELECT * FROM identity_verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId]);
  return rows[0] || null;
}

const dto = async (q, v, userStatus) => {
  const docs = v ? (await q.query('SELECT id, kind, mime, size_bytes, created_at FROM verification_documents WHERE verification_id=$1 ORDER BY created_at', [v.id])).rows : [];
  return {
    status: v?.status ?? userStatus, statusLabel: STATUS_LABELS[v?.status ?? userStatus], provider: v?.provider ?? providers().identity.name,
    reason: v?.review_reason ?? null, expiresAt: v?.expires_at ?? null, updatedAt: v?.updated_at ?? null,
    requiresDocuments: (v?.provider ?? providers().identity.name) === 'manual',
    documents: docs.map((d) => ({ id: d.id, kind: d.kind, mime: d.mime, size: d.size_bytes, uploadedAt: d.created_at })),
  };
};

export async function getStatus(userId) {
  const db = getDb();
  let v = await latest(db, userId);
  if (v && v.expires_at && new Date(v.expires_at) < new Date() && ['pending', 'verification_required'].includes(v.status)) {
    await setStatus(db, { actor: null }, v, 'expired', { reason: 'The verification session expired.', systemActor: true });
    v = await latest(db, userId);
  }
  const { rows } = await db.query('SELECT verification_status FROM users WHERE id=$1', [userId]);
  return dto(db, v, rows[0].verification_status);
}

export async function start(ctx) {
  const db = getDb();
  const userId = ctx.actor.id;
  const { rows: ur } = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
  const user = ur[0];
  if (user.verification_status === 'verified') throw conflict('Your identity is already verified.');
  const cur = await latest(db, userId);
  if (cur && ['pending', 'verification_required', 'manual_review'].includes(cur.status) && (!cur.expires_at || new Date(cur.expires_at) > new Date())) return getStatus(userId);

  const provider = providers().identity;
  const session = await provider.createSession({ user });
  const v = await db.tx(async (t) => {
    const { rows } = await t.query(
      'INSERT INTO identity_verifications (user_id, provider, provider_session_id, status, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [userId, provider.name, session.providerSessionId, session.status, new Date(Date.now() + config.identity.sessionTtlHours * 3_600_000)]);
    await t.query('UPDATE users SET verification_status=$2, updated_at=now() WHERE id=$1', [userId, session.status]);
    await audit.record(t, ctx, { action: 'verification.start', targetType: 'identity_verification', targetId: rows[0].id, next: { status: session.status } });
    return rows[0];
  });
  return { ...(await dto(db, v, session.status)), redirectUrl: session.redirectUrl };
}

export async function uploadDocument(ctx, kind, file) {
  if (!KINDS.includes(kind)) throw badRequest('Unknown document type.');
  if (!file) throw badRequest('Choose a file to upload.');
  const mime = sniffMime(file.buffer);
  if (!mime) throw badRequest('Only JPEG, PNG, WebP or PDF files are accepted.');
  if (kind === 'selfie' && mime === 'application/pdf') throw badRequest('Please upload a photo for your selfie.');
  const db = getDb();
  const v = await latest(db, ctx.actor.id);
  if (!v || v.provider !== 'manual' || v.status !== 'verification_required') throw conflict('Start identity verification before uploading documents.');
  const path = `${ctx.actor.id}/${v.id}/${kind}-${randomToken(8)}.${EXT[mime]}`;
  await providers().storage.put({ bucket: config.supabase.bucketKyc, path, buffer: file.buffer, mime });
  const old = await db.tx(async (t) => {
    const prev = (await t.query('DELETE FROM verification_documents WHERE verification_id=$1 AND kind=$2 RETURNING storage_path', [v.id, kind])).rows;
    await t.query('INSERT INTO verification_documents (verification_id, user_id, kind, storage_path, mime, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)', [v.id, ctx.actor.id, kind, path, mime, file.buffer.length]);
    await audit.record(t, ctx, { action: 'verification.document_upload', targetType: 'identity_verification', targetId: v.id, metadata: { kind, mime, size: file.buffer.length } });
    return prev;
  });
  for (const o of old) await providers().storage.remove({ bucket: config.supabase.bucketKyc, path: o.storage_path }).catch(() => {});
  return getStatus(ctx.actor.id);
}

export async function submit(ctx) {
  const db = getDb();
  const v = await latest(db, ctx.actor.id);
  if (!v || v.status !== 'verification_required' || v.provider !== 'manual') throw conflict('There is no verification waiting for documents.');
  const kinds = new Set((await db.query('SELECT kind FROM verification_documents WHERE verification_id=$1', [v.id])).rows.map((r) => r.kind));
  if (!kinds.has('id_front') || !kinds.has('selfie')) throw badRequest('Please upload the front of your ID and a selfie before submitting.');
  await db.tx((t) => setStatus(t, ctx, v, 'manual_review'));
  await announce(ctx.actor.id, 'manual_review', 'Our compliance team will review your documents.');
  return getStatus(ctx.actor.id);
}

/** Signed webhook from a connected KYC vendor. The provider verifies the signature before anything is trusted. */
export async function handleWebhook(rawBody, headers) {
  const evt = providers().identityWebhook.parseWebhook(rawBody, headers);
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM identity_verifications WHERE provider_session_id=$1', [evt.providerSessionId]);
  const v = rows[0];
  if (!v) throw notFound('Unknown verification session.');
  if (v.status === evt.status) return { ok: true, duplicate: true };
  await db.tx((t) => setStatus(t, { actor: null, ip: null }, v, evt.status, { reason: evt.reason, systemActor: true }));
  await announce(v.user_id, evt.status, evt.reason);
  return { ok: true };
}

// ───────────────────────── compliance review ─────────────────────────
export async function adminQueue({ status, limit = 50, offset = 0 }) {
  const p = [];
  let where = "WHERE v.id = (SELECT id FROM identity_verifications x WHERE x.user_id = v.user_id ORDER BY created_at DESC LIMIT 1)";
  if (status) { p.push(status); where += ` AND v.status = $${p.length}`; }
  const db = getDb();
  const { rows } = await db.query(
    `SELECT v.*, u.email, u.first_name, u.last_name FROM identity_verifications v JOIN users u ON u.id=v.user_id ${where} ORDER BY v.updated_at DESC LIMIT ${Math.min(limit, 200)} OFFSET ${Math.max(offset, 0)}`, p);
  return rows.map((r) => ({ id: r.id, userId: r.user_id, customer: `${r.first_name} ${r.last_name}`, email: r.email, provider: r.provider, status: r.status, statusLabel: STATUS_LABELS[r.status], updatedAt: r.updated_at }));
}

export async function adminDetail(id) {
  const db = getDb();
  const { rows } = await db.query('SELECT v.*, u.email, u.first_name, u.last_name FROM identity_verifications v JOIN users u ON u.id=v.user_id WHERE v.id=$1', [id]);
  const v = rows[0];
  if (!v) throw notFound('Verification not found.');
  return { id: v.id, userId: v.user_id, customer: `${v.first_name} ${v.last_name}`, email: v.email, ...(await dto(db, v, v.status)) };
}

export async function adminReview(ctx, id, { decision, reason }) {
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM identity_verifications WHERE id=$1', [id]);
  const v = rows[0];
  if (!v) throw notFound('Verification not found.');
  if (!['manual_review', 'pending', 'failed', 'verification_required'].includes(v.status)) throw conflict('This verification can no longer be reviewed.');
  if (decision === 'verified' && v.status === 'verification_required') throw conflict('The customer has not submitted documents yet.');
  await db.tx((t) => setStatus(t, ctx, v, decision, { reason, reviewerId: ctx.actor.id }));
  await announce(v.user_id, decision, reason);
  return adminDetail(id);
}

/** Staff document viewing is itself an audited action. */
export async function adminGetDocument(ctx, docId) {
  const db = getDb();
  const { rows } = await db.query('SELECT * FROM verification_documents WHERE id=$1', [docId]);
  const d = rows[0];
  if (!d) throw notFound('Document not found.');
  await audit.record(db, ctx, { action: 'verification.document_view', targetType: 'verification_document', targetId: docId, metadata: { userId: d.user_id, kind: d.kind } });
  return { buffer: await providers().storage.get({ bucket: config.supabase.bucketKyc, path: d.storage_path }), mime: d.mime };
}
