import { z } from 'zod';
import { ICONS } from '../content/siteDefaults.js';
import { LEGAL_DOCS } from '../content/legalDefaults.js';

// Plain text only: React renders all of it as text, and control characters / markup-looking input is refused up front.
const noControl = (s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);
const text = (max, label = 'This field', min = 0) => z.string().trim().min(min, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`).refine(noControl, `${label} contains invalid characters.`);
const noHtml = (s) => !/<\/?[a-z][^>]*>/i.test(s);
const plain = (max, label, min = 0) => text(max, label, min).refine(noHtml, `${label} cannot contain HTML tags.`);

const isHttps = (v) => { try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname; } catch { return false; } };
const internalPath = /^\/(?!\/)[\w\-._~/#?=&%]*$/;
// Link destinations: a page on this site, or an https URL. Never javascript:, data:, mailto: injection or protocol-relative URLs.
const linkTo = z.string().trim().min(1, 'Choose where the button goes.').max(300).refine((v) => internalPath.test(v) || isHttps(v), 'Use a page path such as /register, or a full https:// link.');

export const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #C8102E.').transform((s) => s.toUpperCase());
const assetId = z.uuid('Invalid asset.').nullable();
const icon = z.enum(ICONS);
const phone = z.string().trim().max(40).regex(/^$|^\+?[0-9 ()\-.]{6,40}$/, 'Enter a valid phone number.');
const email = z.string().trim().max(254).regex(/^$|^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/, 'Enter a valid email address.');

const card = z.object({ icon, title: plain(80, 'Title', 1), text: plain(400, 'Description', 1) });
const bulletList = (max) => z.array(plain(160, 'Item', 1)).max(max);
const section = (extra = {}) => z.object({ title: plain(100, 'Title', 1), intro: plain(400, 'Intro'), ...extra });

export const siteConfigSchema = z.object({
  brand: z.object({
    siteName: plain(60, 'Website name', 2),
    logoText: plain(40, 'Logo text', 1),
    shortDescription: plain(200, 'Short description'),
    logoLightAssetId: assetId,
    logoDarkAssetId: assetId,
    faviconAssetId: assetId,
    colors: z.object({ primary: hex, secondary: hex, accent: hex }),
  }),
  contact: z.object({ email, phone, address: plain(200, 'Address'), hours: plain(120, 'Opening hours') }),
  footer: z.object({ text: plain(400, 'Footer text') }),
  social: z.array(z.object({ label: plain(30, 'Label', 1), url: z.string().trim().max(300).refine(isHttps, 'Use a full https:// link.') })).max(6),
  home: z.object({
    eyebrow: plain(80, 'Eyebrow'),
    headline: plain(120, 'Headline', 3),
    description: plain(400, 'Description', 10),
    heroImageAssetId: assetId,
    heroImageAlt: plain(200, 'Image description'),
    primaryButton: z.object({ label: plain(30, 'Button label', 1), to: linkTo }),
    secondaryButton: z.object({ label: plain(30, 'Button label'), to: z.string().trim().max(300).refine((v) => v === '' || internalPath.test(v) || isHttps(v), 'Use a page path such as /login, or a full https:// link.') }),
    protections: z.array(z.object({ label: plain(60, 'Label', 1), value: plain(30, 'Value', 1) })).max(6),
    about: z.object({ title: plain(100, 'Title', 1), text: plain(600, 'Text'), points: bulletList(8) }),
    services: section({ items: z.array(card).max(8) }),
    security: section({ points: bulletList(8) }),
    digital: section({ items: z.array(card).max(8) }),
    faq: z.object({ title: plain(100, 'Title', 1), items: z.array(z.object({ q: plain(160, 'Question', 1), a: plain(1200, 'Answer', 1) })).max(12) }),
    contactSection: z.object({ title: plain(100, 'Title', 1), text: plain(400, 'Text') }),
  }),
  about: z.object({
    title: plain(100, 'Title', 1),
    intro: plain(400, 'Introduction'),
    body: text(8000, 'About text').refine(noHtml, 'About text cannot contain HTML tags.'),
  }),
});

export const siteDraftSchema = z.object({ config: z.record(z.string(), z.any()) });
export const sitePublishSchema = z.object({ note: z.string().trim().max(200).optional() });
export const siteRestoreSchema = z.object({ versionId: z.uuid() });
export const assetUploadSchema = z.object({ kind: z.enum(['logo_light', 'logo_dark', 'favicon', 'hero']) });

// ───────── legal ─────────
export const legalSlugParam = z.object({ slug: z.enum(Object.keys(LEGAL_DOCS)) });
const safeLinks = (body) => {
  for (const m of body.matchAll(/\]\(([^)\s]*)[^)]*\)/g)) {
    const url = m[1];
    if (!(/^https?:\/\/[^\s]+$/i.test(url) || /^mailto:[^\s@]+@[^\s@]+$/i.test(url) || /^\/(?!\/)[\w\-._~/#?=&%]*$/.test(url) || /^#[\w-]+$/.test(url))) return false;
  }
  return true;
};
export const legalDraftSchema = z.object({
  title: plain(120, 'Title', 3),
  body: text(60000, 'Document text', 50).refine(noHtml, 'HTML tags are not supported. Use the formatting shown in the editor guide instead.').refine(safeLinks, 'Links must start with https://, http://, mailto:, / or #.'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Enter a valid date.'),
  note: z.string().trim().max(300).optional(),
});
export const legalPublishSchema = z.object({ mfaCode: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });
export const legalRestoreSchema = z.object({ versionId: z.uuid(), mfaCode: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });
