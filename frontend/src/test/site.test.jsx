import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Markdown, { safeHref, parseBlocks } from '../components/Markdown.jsx';
import Logo from '../components/ui/Logo.jsx';
import { SiteProvider, SitePreview, applyBrand } from '../lib/site.jsx';
import { DEFAULT_SITE_CONFIG, ICONS } from '../lib/siteDefaults.js';
import { LEGAL_FALLBACK } from '../lib/legalDefaults.js';
import { api } from '../lib/api.js';
import { ICON_NAMES } from '../components/ui/Icon.jsx';

vi.mock('../lib/api.js', async (orig) => ({ ...(await orig()), api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() } }));

// The backend content modules are plain data with no imports, so they can be evaluated directly for the comparison.
const loadBackend = (name, exports) => new Function(`${readFileSync(path.resolve(process.cwd(), `../backend/src/content/${name}.js`), 'utf8').replace(/^export /gm, '')}
return { ${exports.join(', ')} };`)();

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style'); vi.mocked(api.get).mockReset(); });

describe('built-in content stays in sync with the backend', () => {
  it('frontend defaults equal backend defaults', async () => {
    const back = loadBackend('siteDefaults', ['DEFAULT_SITE_CONFIG', 'ICONS']);
    expect(DEFAULT_SITE_CONFIG).toEqual(back.DEFAULT_SITE_CONFIG);
    expect(ICONS).toEqual(back.ICONS);
    const legal = loadBackend('legalDefaults', ['LEGAL_DOCS', 'LEGAL_DEFAULTS']);
    for (const k of Object.keys(legal.LEGAL_DOCS)) expect(LEGAL_FALLBACK.docs[k].body).toBe(legal.LEGAL_DEFAULTS[k]);
  });
  it('every icon an administrator can choose exists in the icon set', () => {
    for (const i of ICONS) expect(ICON_NAMES, `missing icon ${i}`).toContain(i);
  });
});

describe('restricted Markdown', () => {
  it('renders headings, lists, emphasis and links as elements', () => {
    render(<MemoryRouter><Markdown source={'## Title\nSome **bold** and *it* text with [site](https://example.com) and [page](/privacy).\n\n- one\n- two\n\n1. first'} /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 2, name: 'Title' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'site' }).getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: 'page' }).getAttribute('href')).toBe('/privacy');
  });
  it('never creates elements from markup or unsafe links', () => {
    const { container } = render(<MemoryRouter><Markdown source={'<img src=x onerror=alert(1)> and [x](javascript:alert(1)) and [y](data:text/html,aaa) <script>alert(1)</script>'} /></MemoryRouter>);
    expect(container.querySelector('img,script,a')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('https://ok.example').kind).toBe('external');
    expect(parseBlocks('a\nb')).toEqual([{ t: 'p', text: 'a b' }]);
  });
});

describe('site provider', () => {
  it('shows built-in defaults when the API is unreachable (public pages never go blank)', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network'));
    render(<MemoryRouter><SiteProvider><Logo /></SiteProvider></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'EWB Bank home' })).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByText('EWB')).toBeTruthy();
  });

  it('applies published branding: name, colours and uploaded logo; caches the colours for the next first paint', async () => {
    const cfg = structuredClone(DEFAULT_SITE_CONFIG);
    cfg.brand.siteName = 'Acme Bank'; cfg.brand.logoText = 'Acme Bank'; cfg.brand.colors = { primary: '#102A43', secondary: '#243B53', accent: '#B3001B' };
    cfg.brand.logoLightAssetId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(api.get).mockResolvedValue({ version: 3, config: cfg, fallback: false });
    const { container } = render(<MemoryRouter><SiteProvider><Logo /></SiteProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Acme Bank home' })).toBeTruthy());
    expect(document.documentElement.style.getPropertyValue('--brand-accent')).toBe('#B3001B');
    expect(JSON.parse(localStorage.getItem('ewb.brand')).primary).toBe('#102A43');
    expect(container.querySelector('img.logo-img-onlight').getAttribute('src')).toContain('/public/assets/11111111');
  });

  it('ignores invalid colours instead of breaking the theme', () => {
    applyBrand({ brand: { colors: { primary: 'red', secondary: '#12', accent: 'url(javascript:1)' } } });
    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('');
  });

  it('preview renders an unpublished configuration without touching the live site', () => {
    const cfg = structuredClone(DEFAULT_SITE_CONFIG); cfg.brand.logoText = 'Draft Name';
    render(<MemoryRouter><SitePreview config={cfg} assetUrl={() => null}><Logo /></SitePreview></MemoryRouter>);
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(localStorage.getItem('ewb.site')).toBeNull();
  });
});

describe('hero image asset', () => {
  it('ships responsive local variants and documents their source and licence', () => {
    const root = path.resolve(process.cwd(), 'public/images');
    for (const f of ['hero-640.webp', 'hero-1280.webp', 'hero-1920.webp', 'hero-1280.jpg', 'hero-1920.jpg']) expect(readFileSync(path.join(root, f)).length).toBeGreaterThan(10_000);
    const doc = readFileSync(path.resolve(process.cwd(), '../docs/HERO_IMAGE.md'), 'utf8');
    expect(doc).toMatch(/CC0/); expect(doc).toMatch(/commons\.wikimedia\.org/);
  });
});
