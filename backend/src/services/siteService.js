// Admin-editable website content (branding, homepage, about, contact, footer) with draft / publish / restore.
// The public site only reads the PUBLISHED version. If it is missing, unreadable or fails validation, the built-in defaults are
// served instead, so an editing mistake or a database hiccup can never take the public website down.
import config from '../config/index.js';
import { getDb } from '../db/index.js';
import { providers } from '../providers/index.js';
import * as audit from './auditService.js';
import { DEFAULT_SITE_CONFIG } from '../content/siteDefaults.js';
import { siteConfigSchema } from '../validators/site.js';
import { imageInfo } from '../utils/images.js';
import { contrastRatio } from '../utils/color.js';
import { badRequest, conflict, notFound, validationError } from '../utils/errors.js';
import { randomToken } from '../utils/crypto.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Overlay `over` on `base`; arrays and scalars replace, objects merge. Missing keys therefore always fall back to defaults. */
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const ASSET_RULES = {
  logo_light: { maxBytes: 2 * 1024 * 1024, minWidth: 64, maxWidth: 4000, mimes: ['image/png', 'image/jpeg', 'image/webp'], label: 'Logo' },
  logo_dark: { maxBytes: 2 * 1024 * 1024, minWidth: 64, maxWidth: 4000, mimes: ['image/png', 'image/jpeg', 'image/webp'], label: 'Logo' },
  favicon: { maxBytes: 512 * 1024, minWidth: 16, maxWidth: 1024, mimes: ['image/png', 'image/x-icon', 'image/webp'], label: 'Favicon' },
  hero: { maxBytes: 5 * 1024 * 1024, minWidth: 1200, maxWidth: 6000, mimes: ['image/jpeg', 'image/png', 'image/webp'], label: 'Hero image' },
};
const ASSET_FIELDS = { logoLightAssetId: 'logo_light', logoDarkAssetId: 'logo_dark', faviconAssetId: 'favicon' };

/** Accessibility guard on administrator-chosen colours: buttons and links must stay readable on white and in dark mode. */
function checkColors(colors) {
  const errors = {};
  if (contrastRatio(colors.primary, '#FFFFFF') < 4.5) errors['brand.colors.primary'] = ['Primary colour is too light: white text on it must reach a 4.5:1 contrast ratio.'];
  if (contrastRatio(colors.accent, '#FFFFFF') < 4.5) errors['brand.colors.accent'] = ['Accent colour is too light: white button text on it must reach a 4.5:1 contrast ratio.'];
  if (contrastRatio(colors.secondary, '#FFFFFF') < 3) errors['brand.colors.secondary'] = ['Secondary colour is too light: it must reach a 3:1 contrast ratio on white.'];
  return errors;
}

async function validateAssets(q, cfg) {
  const errors = {};
  const refs = { ...Object.fromEntries(Object.entries(ASSET_FIELDS).map(([f, kind]) => [`brand.${f}`, [cfg.brand[f], kind]])), 'home.heroImageAssetId': [cfg.home.heroImageAssetId, 'hero'] };
  for (const [path, [id, kind]] of Object.entries(refs)) {
    if (!id) continue;
    const { rows } = await q.query('SELECT kind FROM site_assets WHERE id=$1', [id]);
    if (!rows[0]) errors[path] = ['That image no longer exists. Upload it again.'];
    else if (rows[0].kind !== kind && !(kind.startsWith('logo') && rows[0].kind.startsWith('logo'))) errors[path] = ['That image was uploaded for a different purpose.'];
  }
  return errors;
}

function parseConfig(input) {
  const merged = deepMerge(DEFAULT_SITE_CONFIG, input || {});
  const res = siteConfigSchema.safeParse(merged);
  if (!res.success) {
    const details = {};
    for (const i of res.error.issues) (details[i.path.join('.') || '_'] ||= []).push(i.message);
    throw validationError(details);
  }
  return res.data;
}

// ───────── public ─────────
export async function getPublished() {
  try {
    const { rows } = await getDb().query("SELECT version, config, published_at FROM site_config_versions WHERE status='published'");
    if (!rows[0]) return { version: 0, config: DEFAULT_SITE_CONFIG, publishedAt: null, fallback: true };
    const cfg = parseConfig(parseJson(rows[0].config));
    return { version: rows[0].version, config: cfg, publishedAt: rows[0].published_at, fallback: false };
  } catch {
    return { version: 0, config: DEFAULT_SITE_CONFIG, publishedAt: null, fallback: true };
  }
}

/** An asset is publicly visible only while the published configuration references it. */
export async function getPublicAsset(id) {
  const { config: cfg } = await getPublished();
  const used = [cfg.brand.logoLightAssetId, cfg.brand.logoDarkAssetId, cfg.brand.faviconAssetId, cfg.home.heroImageAssetId];
  if (!used.includes(id)) throw notFound('Image not found.');
  return readAsset(id);
}
export async function getAssetForAdmin(id) { return readAsset(id); }

async function readAsset(id) {
  const { rows } = await getDb().query('SELECT * FROM site_assets WHERE id=$1', [id]);
  if (!rows[0]) throw notFound('Image not found.');
  const buffer = await providers().storage.get({ bucket: config.supabase.bucketSite, path: rows[0].storage_path });
  return { buffer, mime: rows[0].mime };
}

// ───────── admin ─────────
const versionDto = (r) => ({
  id: r.id, version: r.version, status: r.status, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at,
  publishedAt: r.published_at, publishedBy: r.published_by_email || null, createdBy: r.created_by_email || null,
});

export async function getEditorState() {
  const db = getDb();
  const published = await getPublished();
  const { rows } = await db.query("SELECT * FROM site_config_versions WHERE status='draft'");
  const draft = rows[0] ? parseConfig(parseJson(rows[0].config)) : null;
  return {
    published: published.config, publishedVersion: published.version, usingDefaults: published.fallback,
    draft: draft || published.config, hasDraft: !!draft, draftUpdatedAt: rows[0]?.updated_at || null,
    assetRules: ASSET_RULES,
  };
}

export async function saveDraft(ctx, input) {
  const cfg = parseConfig(input);
  const errors = checkColors(cfg.brand.colors);
  const db = getDb();
  Object.assign(errors, await validateAssets(db, cfg));
  if (Object.keys(errors).length) throw validationError(errors);
  await db.tx(async (t) => {
    const { rows } = await t.query("SELECT id, config FROM site_config_versions WHERE status='draft' FOR UPDATE");
    if (rows[0]) await t.query('UPDATE site_config_versions SET config=$2::jsonb, updated_at=now() WHERE id=$1', [rows[0].id, JSON.stringify(cfg)]);
    else await t.query("INSERT INTO site_config_versions (status, config, created_by) VALUES ('draft', $1::jsonb, $2)", [JSON.stringify(cfg), ctx.actor.id]);
    await audit.record(t, ctx, { action: 'site.draft_save', targetType: 'site_config', metadata: { sections: changedSections(rows[0] ? parseJson(rows[0].config) : DEFAULT_SITE_CONFIG, cfg) } });
  });
  return getEditorState();
}

const changedSections = (a, b) => ['brand', 'contact', 'footer', 'social', 'home', 'about'].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));

export async function discardDraft(ctx) {
  await getDb().tx(async (t) => {
    const r = await t.query("DELETE FROM site_config_versions WHERE status='draft' RETURNING id");
    if (!r.rows[0]) throw notFound('There is no draft to discard.');
    await audit.record(t, ctx, { action: 'site.draft_discard', targetType: 'site_config' });
  });
  return getEditorState();
}

export async function publish(ctx, { note } = {}) {
  await getDb().tx(async (t) => {
    const { rows } = await t.query("SELECT * FROM site_config_versions WHERE status='draft' FOR UPDATE");
    if (!rows[0]) throw conflict('There are no unpublished changes to publish.');
    const cfg = parseConfig(parseJson(rows[0].config)); // re-validate: never publish something that would not pass today's rules
    const errs = { ...checkColors(cfg.brand.colors), ...(await validateAssets(t, cfg)) };
    if (Object.keys(errs).length) throw validationError(errs);
    const cur = (await t.query("SELECT id, version FROM site_config_versions WHERE status='published' FOR UPDATE")).rows[0];
    if (cur) await t.query("UPDATE site_config_versions SET status='archived', updated_at=now() WHERE id=$1", [cur.id]);
    const next = ((await t.query('SELECT COALESCE(MAX(version),0)::int AS v FROM site_config_versions')).rows[0].v) + 1;
    await t.query("UPDATE site_config_versions SET status='published', version=$2, note=$3, published_by=$4, published_at=now(), updated_at=now(), config=$5::jsonb WHERE id=$1",
      [rows[0].id, next, note || null, ctx.actor.id, JSON.stringify(cfg)]);
    await audit.record(t, ctx, { action: 'site.publish', targetType: 'site_config', targetId: rows[0].id, metadata: { version: next, previousVersion: cur?.version ?? null, note: note || null } });
  });
  return getEditorState();
}

export async function listVersions() {
  const { rows } = await getDb().query(
    `SELECT v.*, p.email AS published_by_email FROM site_config_versions v LEFT JOIN users p ON p.id = v.published_by
     WHERE v.status <> 'draft' ORDER BY v.version DESC LIMIT 50`);
  return { items: rows.map(versionDto) };
}

/** Restoring copies an old version into the draft for review. It never edits history and never goes live by itself. */
export async function restore(ctx, versionId) {
  const db = getDb();
  await db.tx(async (t) => {
    const { rows } = await t.query("SELECT * FROM site_config_versions WHERE id=$1 AND status IN ('published','archived')", [versionId]);
    if (!rows[0]) throw notFound('Version not found.');
    const cfg = parseConfig(parseJson(rows[0].config));
    const d = (await t.query("SELECT id FROM site_config_versions WHERE status='draft' FOR UPDATE")).rows[0];
    if (d) await t.query('UPDATE site_config_versions SET config=$2::jsonb, updated_at=now() WHERE id=$1', [d.id, JSON.stringify(cfg)]);
    else await t.query("INSERT INTO site_config_versions (status, config, created_by) VALUES ('draft', $1::jsonb, $2)", [JSON.stringify(cfg), ctx.actor.id]);
    await audit.record(t, ctx, { action: 'site.restore', targetType: 'site_config', targetId: versionId, metadata: { restoredVersion: rows[0].version } });
  });
  return getEditorState();
}

// ───────── assets ─────────
export async function uploadAsset(ctx, { kind, file }) {
  const rule = ASSET_RULES[kind];
  if (!rule) throw badRequest('Unknown image type.');
  if (!file?.buffer?.length) throw badRequest('Choose an image to upload.');
  if (file.buffer.length > rule.maxBytes) throw validationError({ file: [`${rule.label} must be ${Math.round(rule.maxBytes / 1024 / 1024 * 10) / 10 || 0.5} MB or smaller.`] });
  const info = imageInfo(file.buffer); // identified from the bytes, so renamed SVG/HTML/script files are rejected
  if (!info || !rule.mimes.includes(info.mime)) throw validationError({ file: [`${rule.label} must be a ${rule.mimes.map((m) => m.split('/')[1].replace('x-icon', 'ico').toUpperCase()).join(', ')} image.`] });
  if (info.width < rule.minWidth) throw validationError({ file: [`${rule.label} must be at least ${rule.minWidth}px wide.`] });
  if (info.width > rule.maxWidth || info.height > rule.maxWidth) throw validationError({ file: [`${rule.label} is too large; the maximum is ${rule.maxWidth}px.`] });
  const path = `${kind}/${randomToken(16)}.${info.ext}`;
  await providers().storage.put({ bucket: config.supabase.bucketSite, path, buffer: file.buffer, mime: info.mime });
  const filename = String(file.originalname || `${kind}.${info.ext}`).replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const db = getDb();
  try {
    const row = await db.tx(async (t) => {
      const { rows } = await t.query(
        'INSERT INTO site_assets (kind, filename, mime, size_bytes, width, height, storage_path, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [kind, filename, info.mime, file.buffer.length, info.width, info.height, path, ctx.actor.id]);
      await audit.record(t, ctx, { action: 'site.asset_upload', targetType: 'site_asset', targetId: rows[0].id, metadata: { kind, mime: info.mime, bytes: file.buffer.length } });
      return rows[0];
    });
    return assetDto(row);
  } catch (e) {
    await providers().storage.remove({ bucket: config.supabase.bucketSite, path }).catch(() => {});
    throw e;
  }
}
export const assetDto = (r) => ({ id: r.id, kind: r.kind, filename: r.filename, mime: r.mime, sizeBytes: r.size_bytes, width: r.width, height: r.height, createdAt: r.created_at });
