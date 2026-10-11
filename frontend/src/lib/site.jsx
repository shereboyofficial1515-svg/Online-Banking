// Website branding and content. Starts from the last good copy in this browser (or the built-in defaults), then refreshes from the
// API. If the API is unreachable the site simply keeps what it has, so the public pages never go blank or show an error.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, apiUrl } from './api.js';
import { DEFAULT_SITE_CONFIG } from './siteDefaults.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const SiteCtx = createContext(null);
const FALLBACK = { config: DEFAULT_SITE_CONFIG, version: 0, assetUrl: () => null, fallback: true };
export const useSite = () => useContext(SiteCtx) || FALLBACK;

const readCache = () => {
  try {
    const c = JSON.parse(localStorage.getItem('ewb.site') || 'null');
    if (c?.config?.brand && c?.config?.home) return c;
  } catch { /* ignore */ }
  return null;
};

/** Brand colours are applied as CSS variables; derived shades come from the tokens, so every theme stays consistent. */
export function applyBrand(config) {
  const root = document.documentElement;
  const c = config?.brand?.colors || {};
  for (const k of ['primary', 'secondary', 'accent']) {
    if (HEX.test(c[k])) root.style.setProperty(`--brand-${k}`, c[k]);
    else root.style.removeProperty(`--brand-${k}`);
  }
  try { localStorage.setItem('ewb.brand', JSON.stringify(c)); } catch { /* storage unavailable */ }
}

function applyFavicon(href) {
  let link = document.querySelector('link[rel~="icon"][data-site]');
  if (!href) { if (link) link.remove(); document.querySelectorAll('link[rel~="icon"]:not([data-site])').forEach((l) => { l.disabled = false; }); return; }
  document.querySelectorAll('link[rel~="icon"]:not([data-site])').forEach((l) => { l.disabled = true; });
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.setAttribute('data-site', ''); document.head.appendChild(link); }
  link.removeAttribute('type');
  link.href = href;
}

export function SiteProvider({ children }) {
  const [state, setState] = useState(() => { const c = readCache(); return { config: c?.config || DEFAULT_SITE_CONFIG, version: c?.version || 0, fallback: !c }; });

  useEffect(() => {
    let off = false;
    api.get('/api/public/site').then((r) => {
      if (off || !r?.config?.brand) return;
      setState({ config: r.config, version: r.version, fallback: !!r.fallback });
      try { localStorage.setItem('ewb.site', JSON.stringify({ config: r.config, version: r.version })); } catch { /* storage unavailable */ }
    }).catch(() => { /* keep what we have */ });
    return () => { off = true; };
  }, []);

  const value = useMemo(() => {
    const assetUrl = (id) => (id ? apiUrl(`/api/public/assets/${id}`) : null);
    return { ...state, assetUrl };
  }, [state]);

  useEffect(() => { applyBrand(state.config); }, [state.config]);
  useEffect(() => { applyFavicon(value.assetUrl(state.config.brand.faviconAssetId)); }, [state.config, value]);
  useEffect(() => {
    const desc = document.querySelector('meta[name="description"]');
    if (desc && state.config.brand.shortDescription) desc.setAttribute('content', state.config.brand.shortDescription);
  }, [state.config]);

  return <SiteCtx.Provider value={value}>{children}</SiteCtx.Provider>;
}

/** Admin preview: renders children against an unpublished configuration without touching the live site or the page chrome. */
export function SitePreview({ config, assetUrl, children }) {
  const value = useMemo(() => ({ config, version: 0, fallback: false, assetUrl }), [config, assetUrl]);
  const vars = ['primary', 'secondary', 'accent'].reduce((o, k) => (HEX.test(config?.brand?.colors?.[k]) ? { ...o, [`--brand-${k}`]: config.brand.colors[k] } : o), {});
  return <SiteCtx.Provider value={value}><div style={vars}>{children}</div></SiteCtx.Provider>;
}
