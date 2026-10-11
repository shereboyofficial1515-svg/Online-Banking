// Renders the restricted Markdown used for legal documents and the About page. Everything becomes React elements (text nodes),
// never HTML strings, so content can not inject markup or script even if it somehow bypassed server validation. Link targets are
// re-checked here: only https/http/mailto, in-site paths and #anchors become links; anything else is shown as plain text.
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

export const safeHref = (u) => {
  if (/^https?:\/\/[^\s]+$/i.test(u) || /^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return { kind: 'external', href: u };
  if (/^\/(?!\/)[\w\-._~/#?=&%]*$/.test(u)) return { kind: 'internal', href: u };
  if (/^#[\w-]+$/.test(u)) return { kind: 'anchor', href: u };
  return null;
};

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]*\))/g;
function inline(text, key) {
  return text.split(INLINE).filter((p) => p !== '').map((part, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    const m = part.match(/^\[([^\]]+)\]\(([^)\s]*)\)$/);
    if (m) {
      const link = safeHref(m[2]);
      if (!link) return <Fragment key={k}>{m[1]}</Fragment>;
      if (link.kind === 'internal') return <Link key={k} to={link.href}>{m[1]}</Link>;
      if (link.kind === 'anchor') return <a key={k} href={link.href}>{m[1]}</a>;
      return <a key={k} href={link.href} rel="noopener noreferrer" target={link.href.startsWith('mailto:') ? undefined : '_blank'}>{m[1]}</a>;
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export function parseBlocks(src) {
  const blocks = []; let list = null; let para = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: 'p', text: para.join(' ') }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{2,3})\s+(.+)$/))) { flushPara(); flushList(); blocks.push({ t: `h${m[1].length}`, text: m[2] }); continue; }
    if ((m = line.match(/^[-*]\s+(.+)$/))) { flushPara(); if (list?.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\d+\.\s+(.+)$/))) { flushPara(); if (list?.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks;
}

export default function Markdown({ source }) {
  return parseBlocks(source).map((b, i) => {
    if (b.t === 'h2') return <h2 key={i}>{inline(b.text, i)}</h2>;
    if (b.t === 'h3') return <h3 key={i}>{inline(b.text, i)}</h3>;
    if (b.t === 'ul') return <ul key={i}>{b.items.map((x, j) => <li key={j}>{inline(x, `${i}-${j}`)}</li>)}</ul>;
    if (b.t === 'ol') return <ol key={i}>{b.items.map((x, j) => <li key={j}>{inline(x, `${i}-${j}`)}</li>)}</ol>;
    return <p key={i}>{inline(b.text, i)}</p>;
  });
}
