// Public website content (no login) and the admin editors for it.
import { Router } from 'express';
import * as c from '../controllers/siteController.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireStaff, requirePermission as can } from '../middleware/authenticate.js';
import { sensitiveLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { uploadOne } from '../middleware/upload.js';
import * as v from '../validators/index.js';
import * as s from '../validators/site.js';

const staff = [requireAuth(), requireStaff];
const id = validate(v.idParam, 'params');
const slug = validate(s.legalSlugParam, 'params');

export const pub = Router();
pub.get('/site', c.publicSite);
pub.get('/assets/:id', id, c.publicAsset);
pub.get('/legal', c.publicLegalList);
pub.get('/legal/:slug', slug, c.publicLegal);

export const adminSite = Router();
adminSite.use(staff, can('site.manage'));
adminSite.get('/', c.siteState);
adminSite.put('/draft', validate(s.siteDraftSchema), c.siteSaveDraft);
adminSite.delete('/draft', c.siteDiscard);
adminSite.post('/publish', sensitiveLimiter, validate(s.sitePublishSchema), c.sitePublish);
adminSite.get('/versions', c.siteVersions);
adminSite.post('/restore', sensitiveLimiter, validate(s.siteRestoreSchema), c.siteRestore);
adminSite.post('/assets', uploadLimiter, uploadOne('file'), validate(s.assetUploadSchema), c.siteUpload);
adminSite.get('/assets/:id', id, c.siteAsset);

export const adminLegal = Router();
adminLegal.use(staff);
adminLegal.get('/', can('legal.edit'), c.legalList);
adminLegal.get('/:slug', can('legal.edit'), slug, c.legalEditor);
adminLegal.get('/:slug/versions/:versionId', can('legal.edit'), validate(s.legalSlugParam.extend({ versionId: v.idParam.shape.id }), 'params'), c.legalVersion);
adminLegal.put('/:slug/draft', can('legal.edit'), slug, validate(s.legalDraftSchema), c.legalSaveDraft);
adminLegal.delete('/:slug/draft', can('legal.edit'), slug, c.legalDiscard);
adminLegal.post('/:slug/publish', sensitiveLimiter, can('legal.publish'), slug, validate(s.legalPublishSchema), c.legalPublish);
adminLegal.post('/:slug/restore', sensitiveLimiter, can('legal.publish'), slug, validate(s.legalRestoreSchema), c.legalRestore);
