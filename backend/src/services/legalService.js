// Legal & policy documents: draft -> preview -> publish with immutable numbered versions. The built-in text is seeded once as
// version 1 and flagged `needs_review`: it is a starting draft, NOT confirmed by legal counsel, and the admin console says so.
// Customer acceptances are append-only rows that point at the exact version accepted, so publishing a new version never
// rewrites what anyone agreed to.
import { getDb } from '../db/index.js';
import * as audit from './auditService.js';
import { LEGAL_DOCS, LEGAL_DEFAULTS, DEFAULT_EFFECTIVE_DATE } from '../content/legalDefaults.js';
import { conflict, notFound } from '../utils/errors.js';

export const SLUGS = Object.keys(LEGAL_DOCS);
export const ACCEPTED_AT_SIGNUP = ['terms', 'privacy'];

const dto = (r, withBody = true) => ({
  id: r.id, slug: r.slug, version: r.version, status: r.status, title: r.title, ...(withBody ? { body: r.body } : {}),
  effectiveDate: typeof r.effective_date === 'string' ? r.effective_date.slice(0, 10) : new Date(r.effective_date).toISOString().slice(0, 10),
  changeNote: r.change_note, needsReview: r.needs_review, publishedAt: r.published_at, updatedAt: r.updated_at, publishedBy: r.published_by_email || null,
});

/** Make sure a published version exists for `slug` (inserting the built-in text as v1 if the table has none). Idempotent and race-safe. */
export async function ensureSeeded(q, slug) {
  if (!LEGAL_DOCS[slug]) throw notFound('Document not found.');
  const { rows } = await q.query("SELECT * FROM legal_document_versions WHERE slug=$1 AND status='published'", [slug]);
  if (rows[0]) return rows[0];
  const any = await q.query('SELECT 1 FROM legal_document_versions WHERE slug=$1 AND version IS NOT NULL LIMIT 1', [slug]);
  if (any.rows[0]) return null; // history exists but nothing is currently published; do not invent a version over the top of it
  await q.query(
    `INSERT INTO legal_document_versions (slug, version, status, title, body, effective_date, change_note, needs_review, published_at)
     VALUES ($1,1,'published',$2,$3,$4,'Initial text',true, now()) ON CONFLICT DO NOTHING`,
    [slug, LEGAL_DOCS[slug].title, LEGAL_DEFAULTS[slug], DEFAULT_EFFECTIVE_DATE]);
  const r = await q.query("SELECT * FROM legal_document_versions WHERE slug=$1 AND status='published'", [slug]);
  return r.rows[0] || null;
}

/** Public read. Failure-safe: if storage is unavailable the built-in text is returned rather than an error page. */
export async function getPublic(slug) {
  if (!LEGAL_DOCS[slug]) throw notFound('Document not found.');
  try {
    const row = await ensureSeeded(getDb(), slug);
    if (row) return dto(row);
  } catch { /* fall through to built-in text */ }
  return { id: null, slug, version: 1, status: 'published', title: LEGAL_DOCS[slug].title, body: LEGAL_DEFAULTS[slug], effectiveDate: DEFAULT_EFFECTIVE_DATE, changeNote: null, needsReview: true, publishedAt: null };
}

export async function listPublic() {
  const items = [];
  for (const slug of SLUGS) {
    const d = await getPublic(slug);
    items.push({ slug, route: LEGAL_DOCS[slug].route, title: d.title, description: LEGAL_DOCS[slug].description, version: d.version, effectiveDate: d.effectiveDate });
  }
  return { items };
}

// ───────── admin ─────────
export async function listAdmin() {
  const db = getDb();
  const items = [];
  for (const slug of SLUGS) {
    const pub = await ensureSeeded(db, slug);
    const draft = (await db.query("SELECT updated_at FROM legal_document_versions WHERE slug=$1 AND status='draft'", [slug])).rows[0];
    items.push({
      slug, route: LEGAL_DOCS[slug].route, title: pub?.title || LEGAL_DOCS[slug].title, version: pub?.version ?? null, effectiveDate: pub ? dto(pub, false).effectiveDate : null,
      needsReview: !!pub?.needs_review, hasDraft: !!draft, draftUpdatedAt: draft?.updated_at || null, publishedAt: pub?.published_at || null,
    });
  }
  return { items };
}

export async function getEditor(slug) {
  if (!LEGAL_DOCS[slug]) throw notFound('Document not found.');
  const db = getDb();
  const pub = await ensureSeeded(db, slug);
  const draft = (await db.query("SELECT * FROM legal_document_versions WHERE slug=$1 AND status='draft'", [slug])).rows[0];
  const hist = await db.query(
    `SELECT v.*, u.email AS published_by_email FROM legal_document_versions v LEFT JOIN users u ON u.id=v.published_by
     WHERE v.slug=$1 AND v.status <> 'draft' ORDER BY v.version DESC LIMIT 50`, [slug]);
  return { slug, route: LEGAL_DOCS[slug].route, published: pub ? dto(pub) : null, draft: draft ? dto(draft) : null, versions: hist.rows.map((r) => dto(r, false)) };
}

export async function saveDraft(ctx, slug, { title, body, effectiveDate, note }) {
  const db = getDb();
  await db.tx(async (t) => {
    await ensureSeeded(t, slug);
    const d = (await t.query("SELECT id FROM legal_document_versions WHERE slug=$1 AND status='draft' FOR UPDATE", [slug])).rows[0];
    if (d) await t.query('UPDATE legal_document_versions SET title=$2, body=$3, effective_date=$4, change_note=$5, needs_review=false, updated_at=now() WHERE id=$1', [d.id, title, body, effectiveDate, note || null]);
    else await t.query("INSERT INTO legal_document_versions (slug, status, title, body, effective_date, change_note, created_by) VALUES ($1,'draft',$2,$3,$4,$5,$6)", [slug, title, body, effectiveDate, note || null, ctx.actor.id]);
    await audit.record(t, ctx, { action: 'legal.draft_save', targetType: 'legal_document', targetId: slug, metadata: { chars: body.length } });
  });
  return getEditor(slug);
}

export async function discardDraft(ctx, slug) {
  await getDb().tx(async (t) => {
    const r = await t.query("DELETE FROM legal_document_versions WHERE slug=$1 AND status='draft' RETURNING id", [slug]);
    if (!r.rows[0]) throw notFound('There is no draft to discard.');
    await audit.record(t, ctx, { action: 'legal.draft_discard', targetType: 'legal_document', targetId: slug });
  });
  return getEditor(slug);
}

export async function publish(ctx, slug) {
  await getDb().tx(async (t) => {
    await ensureSeeded(t, slug);
    const d = (await t.query("SELECT * FROM legal_document_versions WHERE slug=$1 AND status='draft' FOR UPDATE", [slug])).rows[0];
    if (!d) throw conflict('There is no draft to publish.');
    const cur = (await t.query("SELECT id, version FROM legal_document_versions WHERE slug=$1 AND status='published' FOR UPDATE", [slug])).rows[0];
    if (cur) await t.query("UPDATE legal_document_versions SET status='archived', updated_at=now() WHERE id=$1", [cur.id]);
    const next = (await t.query('SELECT COALESCE(MAX(version),0)::int AS v FROM legal_document_versions WHERE slug=$1', [slug])).rows[0].v + 1;
    await t.query("UPDATE legal_document_versions SET status='published', version=$2, published_by=$3, published_at=now(), updated_at=now() WHERE id=$1", [d.id, next, ctx.actor.id]);
    await audit.record(t, ctx, { action: 'legal.publish', targetType: 'legal_document', targetId: slug, metadata: { version: next, previousVersion: cur?.version ?? null, effectiveDate: d.effective_date } });
  });
  return getEditor(slug);
}

/** Copies an earlier version into the draft. History is never edited; going live still needs an explicit publish. */
export async function restore(ctx, slug, versionId) {
  await getDb().tx(async (t) => {
    const v = (await t.query("SELECT * FROM legal_document_versions WHERE id=$1 AND slug=$2 AND status IN ('published','archived')", [versionId, slug])).rows[0];
    if (!v) throw notFound('Version not found.');
    const note = `Restored from version ${v.version}`;
    const d = (await t.query("SELECT id FROM legal_document_versions WHERE slug=$1 AND status='draft' FOR UPDATE", [slug])).rows[0];
    if (d) await t.query('UPDATE legal_document_versions SET title=$2, body=$3, effective_date=$4, change_note=$5, needs_review=false, updated_at=now() WHERE id=$1', [d.id, v.title, v.body, v.effective_date, note]);
    else await t.query("INSERT INTO legal_document_versions (slug, status, title, body, effective_date, change_note, created_by) VALUES ($1,'draft',$2,$3,$4,$5,$6)", [slug, v.title, v.body, v.effective_date, note, ctx.actor.id]);
    await audit.record(t, ctx, { action: 'legal.restore', targetType: 'legal_document', targetId: slug, metadata: { restoredVersion: v.version } });
  });
  return getEditor(slug);
}

export async function getVersion(slug, versionId) {
  const { rows } = await getDb().query('SELECT * FROM legal_document_versions WHERE id=$1 AND slug=$2', [versionId, slug]);
  if (!rows[0]) throw notFound('Version not found.');
  return dto(rows[0]);
}

// ───────── acceptance ─────────
/** Record that a user accepted the currently-published version of each document. Append-only; call inside the signup transaction. */
export async function recordAcceptance(q, ctx, userId, slugs = ACCEPTED_AT_SIGNUP) {
  for (const slug of slugs) {
    const pub = await ensureSeeded(q, slug);
    if (!pub) continue;
    await q.query('INSERT INTO legal_acceptances (user_id, slug, version_id, ip, user_agent) VALUES ($1,$2,$3,$4,$5)', [userId, slug, pub.id, ctx?.ip ?? null, ctx?.userAgent ?? null]);
  }
}

export async function listAcceptances(userId) {
  const { rows } = await getDb().query(
    `SELECT a.slug, a.accepted_at, v.version, v.title, v.effective_date FROM legal_acceptances a JOIN legal_document_versions v ON v.id=a.version_id
     WHERE a.user_id=$1 ORDER BY a.accepted_at DESC`, [userId]);
  return { items: rows.map((r) => ({ slug: r.slug, title: r.title, version: r.version, acceptedAt: r.accepted_at, effectiveDate: typeof r.effective_date === 'string' ? r.effective_date.slice(0, 10) : new Date(r.effective_date).toISOString().slice(0, 10) })) };
}
