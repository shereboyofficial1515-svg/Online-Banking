import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolves the REAL tokens.css (var() references and color-mix(in srgb, …)) and checks WCAG 2.x contrast ratios.
const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function parseBlocks(src) {
  const blocks = {};
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*(?:\([^)]*\)[^{}]*)*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const vars = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
    blocks[sel] = { ...(blocks[sel] || {}), ...vars };
  }
  return blocks;
}
const blocks = parseBlocks(css);
const layer = (...sels) => Object.assign({}, ...sels.map((s) => blocks[s] || {}));
const THEMES = {
  light: layer(':root'),
  dark: layer(':root', "html[data-theme='dark']"),
  'light + high contrast': layer(':root', "html[data-contrast='high']"),
  'dark + high contrast': layer(':root', "html[data-theme='dark']", "html[data-contrast='high']", "html[data-theme='dark'][data-contrast='high']"),
};

const hex2rgb = (h) => { const n = h.replace('#', ''); const f = n.length === 3 ? n.split('').map((c) => c + c).join('') : n; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const rgb2hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

function resolve(value, vars, depth = 0) {
  if (depth > 12) throw new Error(`token cycle at ${value}`);
  let v = value.trim();
  while (/var\(/.test(v)) v = v.replace(/var\((--[\w-]+)\)/, (_, name) => { if (!(name in vars)) throw new Error(`unknown token ${name}`); return resolve(vars[name], vars, depth + 1); });
  const mix = /color-mix\(in srgb,\s*(#[0-9a-fA-F]{3,6})\s+(\d+)%,\s*(#[0-9a-fA-F]{3,6})\)/;
  while (mix.test(v)) v = v.replace(mix, (_, a, p, b) => { const A = hex2rgb(a); const B = hex2rgb(b); const k = Number(p) / 100; return rgb2hex(A.map((x, i) => x * k + B[i] * (1 - k))); });
  return v;
}
const lum = ([r, g, b]) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(hex2rgb(a)), lum(hex2rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const color = (theme, token) => resolve(`var(${token})`, THEMES[theme]);
// [foreground token, background token, minimum ratio, what it is]
const NORMAL = 4.5; const UI = 3;
const PAIRS = [
  ['--text', '--bg', NORMAL, 'body text on page'], ['--text', '--surface', NORMAL, 'body text on cards'], ['--text-strong', '--surface-2', NORMAL, 'text on subtle fills'],
  ['--text-muted', '--bg', NORMAL, 'secondary text on page'], ['--text-muted', '--surface', NORMAL, 'secondary text on cards'], ['--text-muted', '--surface-2', NORMAL, 'secondary text on subtle fills'],
  ['--heading', '--surface', NORMAL, 'headings on cards'], ['--heading', '--bg', NORMAL, 'headings on page'],
  ['--accent-contrast', '--accent', NORMAL, 'button label on brand red'], ['--accent-contrast', '--accent-hover', NORMAL, 'button label on hovered brand red'],
  ['--accent-text', '--surface', NORMAL, 'links/accent text on cards'], ['--accent-text', '--bg', NORMAL, 'links/accent text on page'], ['--accent-text', '--accent-soft', NORMAL, 'accent text on soft red fill'],
  ['--primary-contrast', '--primary', NORMAL, 'avatar / chip text on navy'],
  ['--nav-text', '--nav-bg', NORMAL, 'navigation text on navy'], ['--nav-text-muted', '--nav-bg', NORMAL, 'navigation group labels on navy'], ['--accent-on-nav', '--nav-bg', UI, 'active-item indicator on navy'],
  ['--success', '--success-soft', NORMAL, 'success badge'], ['--warning', '--warning-soft', NORMAL, 'warning badge'], ['--error', '--error-soft', NORMAL, 'error text'], ['--info', '--info-soft', NORMAL, 'info badge'],
  ['--success-strong', '--success-soft', NORMAL, 'success alert'], ['--warning-strong', '--warning-soft', NORMAL, 'warning alert'], ['--error-strong', '--error-soft', NORMAL, 'error alert'], ['--info-strong', '--info-soft', NORMAL, 'info alert'],
  ['--error', '--surface', NORMAL, 'inline field error'], ['--success', '--surface', NORMAL, 'positive amounts'],
  ['--focus', '--surface', UI, 'focus ring on cards'], ['--focus', '--bg', UI, 'focus ring on page'],
  ['--toast-text', '--toast-bg', NORMAL, 'toast'], ['--toast-text', '--toast-success-bg', NORMAL, 'success toast'], ['--toast-text', '--toast-error-bg', NORMAL, 'error toast'],
  ['--chart-1', '--surface', UI, 'chart series 1 on cards'], ['--chart-2', '--surface', UI, 'chart series 2 on cards'],
  ['--border-strong', '--surface', UI, 'input borders'],
];

describe('design system contrast (WCAG 2.x, computed from tokens.css)', () => {
  for (const theme of Object.keys(THEMES)) {
    it(`${theme}: every text/background pairing meets its minimum ratio`, () => {
      const failures = [];
      for (const [fg, bg, min, label] of PAIRS) {
        const r = ratio(color(theme, fg), color(theme, bg));
        if (r < min) failures.push(`${label}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (needs ${min}:1)`);
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }

  it('the hero text is readable on the lightest part of the photo overlay', () => {
    const overlay = THEMES.light['--hero-overlay'];
    const stops = [...overlay.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map((m) => ({ rgb: [+m[1], +m[2], +m[3]], a: +m[4] }));
    expect(stops.length).toBeGreaterThanOrEqual(2);
    // worst case: the most transparent stop composited over pure white photo content
    const lightest = stops.reduce((acc, s) => (s.a < acc.a ? s : acc));
    const composite = lightest.rgb.map((c) => c * lightest.a + 255 * (1 - lightest.a));
    expect(ratio(rgb2hex(composite), '#ffffff')).toBeGreaterThanOrEqual(NORMAL);
  });

  it('brand red keeps its meaning: status colours are separate tokens and destructive buttons are not solid brand-red', () => {
    for (const theme of ['light', 'dark']) expect(color(theme, '--error')).not.toBe(color(theme, '--accent'));
    const base = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/base.css'), 'utf8');
    expect(base).toMatch(/\.btn-danger \{ background: var\(--surface\); color: var\(--error\)/);
  });

  it('component stylesheets contain no raw colour values outside the allowed neutrals', () => {
    for (const f of ['base.css', 'layout.css']) {
      const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const hexes = [...new Set((src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()))];
      expect(hexes.filter((h) => !['#fff', '#ffffff'].includes(h)), `${f} hard-codes colours`).toEqual([]);
    }
  });
});
