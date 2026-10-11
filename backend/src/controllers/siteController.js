// HTTP adapters for the public website content and the admin editors. Routes enforce authentication and permissions;
// publishing legal text additionally requires an MFA step-up.
import * as site from '../services/siteService.js';
import * as legal from '../services/legalService.js';
import * as mfa from '../services/mfaService.js';
import { badRequest } from '../utils/errors.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';

// Content is revalidated on every request (cheap 304 via ETag), so a publish is visible to visitors immediately.
const cacheShort = (res) => res.set('Cache-Control', 'public, no-cache');
const sendImage = (res, { buffer, mime }, cache) => {
  res.set({
    'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline',
    'Cross-Origin-Resource-Policy': 'cross-origin', // the website may be served from a different origin than the API
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': cache,
  }).send(buffer);
};

// public (no login)
export const publicSite = h(async (req, res) => {
  const s = await site.getPublished();
  cacheShort(res);
  res.json({ version: s.version, config: s.config, fallback: s.fallback });
});
export const publicAsset = h(async (req, res) => sendImage(res, await site.getPublicAsset(req.params.id), 'public, max-age=300'));
export const publicLegalList = h(async (req, res) => { cacheShort(res); res.json(await legal.listPublic()); });
export const publicLegal = h(async (req, res) => { cacheShort(res); res.json(await legal.getPublic(req.params.slug)); });

// admin: website
export const siteState = h(async (req, res) => res.json(await site.getEditorState()));
export const siteSaveDraft = h(async (req, res) => res.json(await site.saveDraft(req.ctx, req.body.config)));
export const siteDiscard = h(async (req, res) => res.json(await site.discardDraft(req.ctx)));
export const sitePublish = h(async (req, res) => res.json(await site.publish(req.ctx, req.body)));
export const siteVersions = h(async (req, res) => res.json(await site.listVersions()));
export const siteRestore = h(async (req, res) => res.json(await site.restore(req.ctx, req.body.versionId)));
export const siteUpload = h(async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload.');
  res.status(201).json(await site.uploadAsset(req.ctx, { kind: req.body.kind, file: req.file }));
});
export const siteAsset = h(async (req, res) => sendImage(res, await site.getAssetForAdmin(req.params.id), 'private, max-age=60'));

// admin: legal
export const legalList = h(async (req, res) => res.json(await legal.listAdmin()));
export const legalEditor = h(async (req, res) => res.json(await legal.getEditor(req.params.slug)));
export const legalVersion = h(async (req, res) => res.json(await legal.getVersion(req.params.slug, req.params.versionId)));
export const legalSaveDraft = h(async (req, res) => res.json(await legal.saveDraft(req.ctx, req.params.slug, req.body)));
export const legalDiscard = h(async (req, res) => res.json(await legal.discardDraft(req.ctx, req.params.slug)));
export const legalPublish = h(async (req, res) => {
  await mfa.requireStepUp(req.auth.user, req.body.mfaCode);
  res.json(await legal.publish(req.ctx, req.params.slug));
});
export const legalRestore = h(async (req, res) => {
  await mfa.requireStepUp(req.auth.user, req.body.mfaCode);
  res.json(await legal.restore(req.ctx, req.params.slug, req.body.versionId));
});
