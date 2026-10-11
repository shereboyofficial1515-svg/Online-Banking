// Admin: website editor (branding, homepage, about, contact, footer) and legal document editor.
// Everything is edited as a DRAFT. Visitors only ever see the published version; publishing and restoring are explicit steps.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonCard, SkeletonRows } from '../../components/ui/Feedback.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { Modal } from '../../components/ui/Overlay.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import Home from '../public/Home.jsx';
import { LegalDoc } from '../public/Legal.jsx';
import { SitePreview } from '../../lib/site.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, apiUrl, fieldErrors } from '../../lib/api.js';
import { dateTime, relativeTime } from '../../lib/format.js';
import { ICONS } from '../../lib/siteDefaults.js';

// ───────── helpers ─────────
const clone = (o) => JSON.parse(JSON.stringify(o));
const getIn = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setIn = (o, path, v) => { const n = clone(o); const ks = path.split('.'); let c = n; ks.slice(0, -1).forEach((k) => { c = c[k]; }); c[ks.at(-1)] = v; return n; };
const adminImg = (id) => (id ? apiUrl(`/api/admin/site/assets/${id}`) : null);

/** Ratio of two hex colours (WCAG), used for a live readability hint; the server enforces the real rule. */
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };

function ImagePicker({ label, kind, value, onChange, hint, rules, error }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const input = useRef(null);
  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('kind', kind); fd.append('file', file);
      const a = await api.upload('/api/admin/site/assets', fd);
      onChange(a.id); toast.success(`${label} uploaded. Save the draft to keep it.`);
    } catch (ex) { setErr(fieldErrors(ex).file || ex.message); } finally { setBusy(false); }
  };
  const r = rules?.[kind];
  return (
    <div className="field">
      <span className="label-like"><strong>{label}</strong></span>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start', marginTop: 8 }}>
        <div style={{ width: kind === 'hero' ? 160 : 96, height: kind === 'hero' ? 90 : 64, border: '1px dashed var(--border-strong)', borderRadius: 10, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          {value ? <img src={adminImg(value)} alt={`${label} preview`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span className="muted small">None</span>}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/x-icon" hidden onChange={pick} aria-label={`Choose ${label} file`} />
            <Button size="sm" variant="secondary" icon="upload" loading={busy} onClick={() => input.current.click()}>{value ? 'Replace' : 'Upload'}</Button>
            {value && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>}
          </div>
          <p className="field-hint">{hint}{r ? ` Max ${Math.round(r.maxBytes / 1024 / 1024 * 10) / 10 || 0.5} MB, at least ${r.minWidth}px wide.` : ''}</p>
        </div>
      </div>
      {(err || error) && <p className="field-error" role="alert"><Icon name="alert" size={14} /> {err || error}</p>}
    </div>
  );
}

function ListEditor({ label, items, onChange, blank, render, max = 12, addLabel = 'Add item' }) {
  const move = (i, d) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <fieldset className="list-editor">
      <legend>{label}</legend>
      {items.map((it, i) => (
        <div key={i} className="list-item">
          <div className="list-item-body">{render(it, (patch) => onChange(items.map((x, j) => (j === i ? (typeof patch === 'function' ? patch(x) : patch) : x))), i)}</div>
          <div className="list-item-actions">
            <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${label} item ${i + 1} up`}><Icon name="chevron-up" size={16} /></button>
            <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${label} item ${i + 1} down`}><Icon name="chevron-down" size={16} /></button>
            <button type="button" className="icon-btn" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} item ${i + 1}`}><Icon name="x" size={16} /></button>
          </div>
        </div>
      ))}
      {items.length < max && <Button size="sm" variant="secondary" icon="plus" onClick={() => onChange([...items, clone(blank)])}>{addLabel}</Button>}
    </fieldset>
  );
}

// ───────── website editor ─────────
const TABS = [['brand', 'Branding'], ['home', 'Homepage'], ['sections', 'Sections & FAQ'], ['about', 'About & contact'], ['footer', 'Footer & social']];

export function AdminWebsite() {
  useDocumentTitle('Website');
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi('/api/admin/site');
  const versions = useApi('/api/admin/site/versions');
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const [tab, setTab] = useState('brand');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => { if (data && !dirty) setDraft(clone(data.draft)); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loading && !draft) return <SkeletonCard lines={6} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!draft) return null;

  const set = (path, v) => { setDraft((d) => setIn(d, path, v)); setDirty(true); };
  const E = (p) => errors[p];
  const text = (path, label, props = {}) => (
    <Field label={label} error={E(path)} hint={props.hint} className={props.span ? 'span-2' : ''}>
      {(a) => (props.area
        ? <Textarea {...a} rows={props.rows || 4} value={getIn(draft, path) ?? ''} onChange={(e) => set(path, e.target.value)} />
        : <Input {...a} type={props.type} value={getIn(draft, path) ?? ''} onChange={(e) => set(path, e.target.value)} />)}
    </Field>
  );
  const run = async (name, fn, okMsg) => {
    setBusy(name); setErrors({});
    try { const r = await fn(); if (okMsg) toast.success(okMsg); return r; } catch (ex) {
      const fe = fieldErrors(ex); setErrors(fe);
      const first = Object.entries(fe)[0];
      toast.error(first ? `${first[0].replace(/\./g, ' › ')}: ${first[1]}` : ex.message);
      return null;
    } finally { setBusy(''); }
  };
  const save = async () => {
    const r = await run('save', () => api.put('/api/admin/site/draft', { config: draft }), 'Draft saved. Visitors do not see it until you publish.');
    if (r) { setDirty(false); setDraft(clone(r.draft)); reload(); }
    return r;
  };
  const publish = async () => {
    if (dirty && !(await save())) { setPublishing(false); return; }
    const r = await run('publish', () => api.post('/api/admin/site/publish', note ? { note } : {}), 'Published. The live website is updated.');
    setPublishing(false); setNote('');
    if (r) { setDirty(false); setDraft(clone(r.draft)); reload(); versions.reload(); }
  };
  const discard = async () => {
    const r = await run('discard', () => api.delete('/api/admin/site/draft'), 'Draft discarded.');
    if (r) { setDirty(false); setDraft(clone(r.draft)); reload(); }
  };
  const restore = async (id) => {
    const r = await run('restore', () => api.post('/api/admin/site/restore', { versionId: id }), 'Version loaded into the draft. Review it, then publish.');
    if (r) { setDirty(false); setDraft(clone(r.draft)); reload(); }
  };

  const colors = draft.brand.colors;
  const R = data.assetRules;
  const colorField = (k, label, need) => (
    <Field label={label} error={E(`brand.colors.${k}`)} hint={`Contrast on white: ${ratio(colors[k] || '#000000', '#FFFFFF').toFixed(1)}:1 (needs ${need}:1).`}>
      {(a) => (
        <div className="row" style={{ gap: 8 }}>
          <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/i.test(colors[k]) ? colors[k] : '#000000'} onChange={(e) => set(`brand.colors.${k}`, e.target.value.toUpperCase())} style={{ width: 44, height: 40, padding: 2, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface)' }} />
          <Input {...a} value={colors[k]} onChange={(e) => set(`brand.colors.${k}`, e.target.value)} maxLength={7} style={{ maxWidth: 140 }} />
        </div>
      )}
    </Field>
  );
  const h = draft.home;
  const cardItem = (it, up) => (
    <div className="form-grid">
      <Field label="Icon">{(a) => <Select {...a} value={it.icon} onChange={(e) => up({ ...it, icon: e.target.value })}>{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</Select>}</Field>
      <Field label="Title">{(a) => <Input {...a} value={it.title} onChange={(e) => up({ ...it, title: e.target.value })} />}</Field>
      <Field label="Description" className="span-2">{(a) => <Textarea {...a} rows={2} value={it.text} onChange={(e) => up({ ...it, text: e.target.value })} />}</Field>
    </div>
  );
  const strings = (path, label, max = 8) => (
    <ListEditor label={label} items={getIn(draft, path)} blank="" max={max} addLabel="Add point" onChange={(v) => set(path, v)}
      render={(it, up) => <Input aria-label={label} value={it} onChange={(e) => up(e.target.value)} />} />
  );
  const section = (key, label, withItems) => (
    <Card title={label}>
      <div className="form-grid">
        {text(`home.${key}.title`, 'Title')}
        {key !== 'faq' && text(`home.${key}.intro`, 'Introduction', { area: true, rows: 2, span: true })}
      </div>
      {withItems && <ListEditor label={`${label} cards`} items={h[key].items} blank={{ icon: 'check-circle', title: 'New item', text: 'Describe this item.' }} max={8} addLabel="Add card" onChange={(v) => set(`home.${key}.items`, v)} render={cardItem} />}
      {key === 'security' && strings('home.security.points', 'Security points')}
    </Card>
  );

  return (
    <div className="stack">
      <PageHeader title="Website" subtitle="Edit your public website. Changes stay in a draft until you publish them."
        actions={<>
          <Button variant="secondary" icon="eye" onClick={() => setPreview(true)}>Preview</Button>
          <Button variant="secondary" onClick={save} loading={busy === 'save'} disabled={!dirty}>Save draft</Button>
          <Button onClick={() => setPublishing(true)} disabled={!dirty && !data.hasDraft}>Publish</Button>
        </>} />
      {data.usingDefaults && <Alert tone="info" title="Showing the built-in website">Nothing has been published yet, so visitors see the default content. Your first publish creates version 1.</Alert>}
      {(dirty || data.hasDraft) && <Alert tone="warning" title={dirty ? 'Unsaved changes' : 'Unpublished draft'}
        action={!dirty && <Button size="sm" variant="secondary" onClick={discard} loading={busy === 'discard'}>Discard draft</Button>}>
        {dirty ? 'Save the draft to keep your edits.' : `Last saved ${relativeTime(data.draftUpdatedAt)}. Visitors still see the published version.`}
      </Alert>}

      <div role="tablist" aria-label="Website sections" className="tabs">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="stack">
        {tab === 'brand' && (<>
          <Card title="Identity">
            <div className="form-grid">
              {text('brand.siteName', 'Website name')}
              {text('brand.logoText', 'Logo text', { hint: 'Shown beside the built-in mark when no logo image is uploaded.' })}
              {text('brand.shortDescription', 'Short description', { area: true, rows: 2, span: true, hint: 'Used as the page description for search engines.' })}
            </div>
          </Card>
          <Card title="Logos & icon">
            <div className="stack">
              <ImagePicker label="Logo for light backgrounds" kind="logo_light" rules={R} value={draft.brand.logoLightAssetId} onChange={(v) => set('brand.logoLightAssetId', v)} error={E('brand.logoLightAssetId')} hint="PNG, JPEG or WebP, ideally with a transparent background." />
              <ImagePicker label="Logo for dark backgrounds" kind="logo_dark" rules={R} value={draft.brand.logoDarkAssetId} onChange={(v) => set('brand.logoDarkAssetId', v)} error={E('brand.logoDarkAssetId')} hint="Shown in dark theme and on the navy header areas." />
              <ImagePicker label="Favicon" kind="favicon" rules={R} value={draft.brand.faviconAssetId} onChange={(v) => set('brand.faviconAssetId', v)} error={E('brand.faviconAssetId')} hint="Square PNG or ICO shown in the browser tab." />
            </div>
          </Card>
          <Card title="Colours" subtitle="Both light and dark themes are derived from these. Colours that would make text hard to read are refused.">
            <div className="form-grid">{colorField('primary', 'Primary (navy)', '4.5')}{colorField('secondary', 'Secondary', '3')}{colorField('accent', 'Accent (buttons, highlights)', '4.5')}</div>
          </Card>
        </>)}

        {tab === 'home' && (<>
          <Card title="Hero">
            <div className="form-grid">
              {text('home.eyebrow', 'Small heading above the title')}
              {text('home.headline', 'Headline', { span: true })}
              {text('home.description', 'Description', { area: true, rows: 3, span: true })}
              {text('home.primaryButton.label', 'Main button text')}{text('home.primaryButton.to', 'Main button link', { hint: 'A page such as /register or a full https:// link.' })}
              {text('home.secondaryButton.label', 'Second button text', { hint: 'Leave empty to hide the button.' })}{text('home.secondaryButton.to', 'Second button link')}
              {text('home.heroImageAlt', 'Image description', { span: true, hint: 'Describes the hero image for screen readers.' })}
            </div>
            <ImagePicker label="Hero background image" kind="hero" rules={R} value={h.heroImageAssetId} onChange={(v) => set('home.heroImageAssetId', v)} error={E('home.heroImageAssetId')} hint="Landscape photo. Leave empty to use the built-in photograph. Only upload images you have the right to use." />
          </Card>
          <Card title="Protection summary card">
            <ListEditor label="Protection rows" items={h.protections} blank={{ label: 'New row', value: 'Value' }} max={6} addLabel="Add row" onChange={(v) => set('home.protections', v)}
              render={(it, up) => <div className="form-grid"><Field label="Label">{(a) => <Input {...a} value={it.label} onChange={(e) => up({ ...it, label: e.target.value })} />}</Field><Field label="Value">{(a) => <Input {...a} value={it.value} onChange={(e) => up({ ...it, value: e.target.value })} />}</Field></div>} />
          </Card>
          <Card title="About section">
            <div className="form-grid">{text('home.about.title', 'Title')}{text('home.about.text', 'Text', { area: true, rows: 3, span: true })}</div>
            {strings('home.about.points', 'About points')}
          </Card>
        </>)}

        {tab === 'sections' && (<>
          {section('services', 'Services', true)}
          {section('security', 'Security')}
          {section('digital', 'Digital banking', true)}
          <Card title="Frequently asked questions">
            {text('home.faq.title', 'Section title')}
            <ListEditor label="Questions" items={h.faq.items} blank={{ q: 'New question', a: 'Answer.' }} max={12} addLabel="Add question" onChange={(v) => set('home.faq.items', v)}
              render={(it, up) => <div className="stack" style={{ gap: 8 }}><Field label="Question">{(a) => <Input {...a} value={it.q} onChange={(e) => up({ ...it, q: e.target.value })} />}</Field><Field label="Answer">{(a) => <Textarea {...a} rows={3} value={it.a} onChange={(e) => up({ ...it, a: e.target.value })} />}</Field></div>} />
            <Alert tone="info">Keep statements about licences, partners and insurance accurate. Do not publish claims your business cannot support.</Alert>
          </Card>
          <Card title="Contact section">
            <div className="form-grid">{text('home.contactSection.title', 'Title')}{text('home.contactSection.text', 'Text', { area: true, rows: 3, span: true })}</div>
          </Card>
        </>)}

        {tab === 'about' && (<>
          <Card title="About page" subtitle="Basic formatting: ## Heading, - bullet, **bold**, [link](/page). HTML is not allowed.">
            <div className="form-grid">{text('about.title', 'Title')}{text('about.intro', 'Introduction', { area: true, rows: 2, span: true })}{text('about.body', 'Body', { area: true, rows: 12, span: true })}</div>
          </Card>
          <Card title="Contact details">
            <div className="form-grid">{text('contact.email', 'Email', { type: 'email' })}{text('contact.phone', 'Phone')}{text('contact.address', 'Address', { span: true })}{text('contact.hours', 'Opening hours', { span: true })}</div>
          </Card>
        </>)}

        {tab === 'footer' && (<>
          <Card title="Footer">{text('footer.text', 'Footer text', { area: true, rows: 3 })}</Card>
          <Card title="Social links">
            <ListEditor label="Social links" items={draft.social} blank={{ label: 'Website', url: 'https://' }} max={6} addLabel="Add link" onChange={(v) => set('social', v)}
              render={(it, up, i) => <div className="form-grid"><Field label="Name" error={E(`social.${i}.label`)}>{(a) => <Input {...a} value={it.label} onChange={(e) => up({ ...it, label: e.target.value })} />}</Field><Field label="Link (https://)" error={E(`social.${i}.url`)}>{(a) => <Input {...a} value={it.url} onChange={(e) => up({ ...it, url: e.target.value })} />}</Field></div>} />
          </Card>
        </>)}
      </div>

      <Card title="Version history" subtitle="Restoring copies a version into your draft. It never changes history or goes live by itself.">
        {versions.loading ? <SkeletonRows rows={3} /> : (
          <DataTable rows={versions.data?.items || []} caption="Published versions" empty={<EmptyState icon="clipboard" title="No published versions yet" />} columns={[
            { key: 'version', header: 'Version', render: (v) => <strong>v{v.version}</strong> },
            { key: 'status', header: 'Status', render: (v) => <Badge tone={v.status === 'published' ? 'success' : 'neutral'}>{v.status === 'published' ? 'Live' : 'Archived'}</Badge> },
            { key: 'publishedAt', header: 'Published', render: (v) => dateTime(v.publishedAt) },
            { key: 'by', header: 'By', render: (v) => v.publishedBy || '—' },
            { key: 'note', header: 'Note', render: (v) => v.note || '—' },
            { key: 'act', header: '', className: 'num', render: (v) => <Button size="sm" variant="ghost" onClick={() => restore(v.id)} loading={busy === 'restore'}>Restore to draft</Button> },
          ]} />
        )}
      </Card>

      <Modal open={preview} onClose={() => setPreview(false)} title="Preview (unpublished draft)" size="xl">
        <Alert tone="info">This is how the homepage will look with your changes. Nothing here is live.</Alert>
        <div className="preview-frame"><SitePreview config={draft} assetUrl={adminImg}><Home /></SitePreview></div>
      </Modal>
      <Modal open={publishing} onClose={() => setPublishing(false)} title="Publish changes?" footer={<><Button variant="ghost" onClick={() => setPublishing(false)}>Cancel</Button><Button onClick={publish} loading={busy === 'publish' || busy === 'save'}>Publish now</Button></>}>
        <p>Your changes go live for every visitor immediately. The current version stays in the history so you can restore it.</p>
        <Field label="Note (optional)">{(a) => <Input {...a} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" />}</Field>
      </Modal>
    </div>
  );
}

// ───────── legal documents ─────────
export function AdminLegal() {
  useDocumentTitle('Legal documents');
  const { data, loading, error, refetch } = useApi('/api/admin/legal');
  return (
    <div className="stack">
      <PageHeader title="Legal documents" subtitle="Terms, privacy and policy pages. Edit as a draft, preview, then publish with a new version and effective date." />
      <Alert tone="warning" title="Built-in text is a starting point">Default wording has not been reviewed by a lawyer. Have your own counsel review and publish final text before relying on it.</Alert>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Legal documents" columns={[
            { key: 'title', header: 'Document', render: (d) => <Link to={`/admin/legal/${d.slug}`}><strong>{d.title}</strong></Link> },
            { key: 'version', header: 'Live version', render: (d) => (d.version ? `v${d.version}` : '—') },
            { key: 'effectiveDate', header: 'Effective', render: (d) => d.effectiveDate || '—' },
            { key: 'status', header: 'Status', render: (d) => <span className="row" style={{ gap: 6 }}>{d.needsReview && <Badge tone="warning">Not legally reviewed</Badge>}{d.hasDraft && <Badge tone="info">Draft</Badge>}</span> },
            { key: 'act', header: '', className: 'num', render: (d) => <Button size="sm" variant="secondary" to={`/admin/legal/${d.slug}`}>Edit</Button> },
          ]} />
        </Card>
      )}
    </div>
  );
}

export function AdminLegalEditor() {
  const { slug } = useParams();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/admin/legal/${slug}`);
  const [f, setF] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type: 'publish' } | { type: 'restore', version }
  const [code, setCode] = useState('');
  useDocumentTitle('Edit legal document');

  const source = useMemo(() => (data ? (data.draft || data.published) : null), [data]);
  useEffect(() => { if (source && !dirty) setF({ title: source.title, body: source.body, effectiveDate: source.effectiveDate, note: data.draft?.changeNote || '' }); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty(false); setErrors({}); }, [slug]);

  if (loading && !f) return <SkeletonCard lines={6} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!f) return null;

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };
  const apply = (r) => { setDirty(false); setF({ title: (r.draft || r.published).title, body: (r.draft || r.published).body, effectiveDate: (r.draft || r.published).effectiveDate, note: r.draft?.changeNote || '' }); reload(); };
  const run = async (name, fn, ok) => {
    setBusy(name); setErrors({});
    try { const r = await fn(); if (ok) toast.success(ok); return r; } catch (ex) { const fe = fieldErrors(ex); setErrors(fe); toast.error(Object.values(fe)[0] || ex.message); return null; } finally { setBusy(''); }
  };
  const save = async () => { const r = await run('save', () => api.put(`/api/admin/legal/${slug}/draft`, f), 'Draft saved. Visitors still see the published version.'); if (r) apply(r); return r; };
  const submit = async () => {
    if (dirty && !(await save())) return;
    const r = await run('confirm', () => (confirm.type === 'publish'
      ? api.post(`/api/admin/legal/${slug}/publish`, { mfaCode: code })
      : api.post(`/api/admin/legal/${slug}/restore`, { versionId: confirm.version.id, mfaCode: code })),
    confirm.type === 'publish' ? 'Published. The new version is live.' : 'Version loaded into the draft. Review it, then publish.');
    if (r) { setConfirm(null); setCode(''); apply(r); }
  };
  const discard = async () => { const r = await run('discard', () => api.delete(`/api/admin/legal/${slug}/draft`), 'Draft discarded.'); if (r) apply(r); };
  const canPublish = true; // the API decides; a 403 is shown if the role lacks `legal.publish`

  return (
    <div className="stack">
      <PageHeader title={data.published?.title || 'Legal document'} subtitle={<>Live: {data.published ? `v${data.published.version}, effective ${data.published.effectiveDate}` : 'none'}{data.published?.needsReview && <> · <Badge tone="warning">Not legally reviewed</Badge></>}</>}
        actions={<><Button variant="secondary" to="/admin/legal" icon="chevron-left">All documents</Button><Button variant="secondary" icon="eye" onClick={() => setPreview(true)}>Preview</Button><Button variant="secondary" onClick={save} loading={busy === 'save'} disabled={!dirty}>Save draft</Button><Button onClick={() => { setCode(''); setConfirm({ type: 'publish' }); }} disabled={dirty ? false : !data.draft}>Publish…</Button></>} />
      {data.draft && !dirty && <Alert tone="warning" title="Unpublished draft" action={<Button size="sm" variant="secondary" onClick={discard} loading={busy === 'discard'}>Discard draft</Button>}>Last saved {relativeTime(data.draft.updatedAt)}.</Alert>}
      <Card title="Edit document" subtitle="Formatting: ## Heading, ### Subheading, - bullet list, 1. numbered list, **bold**, *italic*, [text](https://link). HTML is not allowed.">
        <div className="form-grid">
          <Field label="Title" error={errors.title} required>{(a) => <Input {...a} value={f.title} onChange={set('title')} />}</Field>
          <Field label="Effective date" error={errors.effectiveDate} hint="When this version takes effect." required>{(a) => <Input {...a} type="date" value={f.effectiveDate} onChange={set('effectiveDate')} />}</Field>
          <Field label="Document text" error={errors.body} className="span-2" required>{(a) => <Textarea {...a} rows={22} value={f.body} onChange={set('body')} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '.9rem' }} />}</Field>
          <Field label="Change note (optional)" error={errors.note} className="span-2">{(a) => <Input {...a} maxLength={300} value={f.note} onChange={set('note')} placeholder="Summary of what changed" />}</Field>
        </div>
        <Alert tone="info">Publishing creates a new numbered version. Customers who accepted an earlier version keep that record unchanged.</Alert>
      </Card>
      <Card title="Version history">
        <DataTable rows={data.versions} caption="Versions" empty={<EmptyState icon="clipboard" title="No versions" />} columns={[
          { key: 'version', header: 'Version', render: (v) => <strong>v{v.version}</strong> },
          { key: 'status', header: 'Status', render: (v) => <Badge tone={v.status === 'published' ? 'success' : 'neutral'}>{v.status === 'published' ? 'Live' : 'Archived'}</Badge> },
          { key: 'effectiveDate', header: 'Effective', render: (v) => v.effectiveDate },
          { key: 'publishedAt', header: 'Published', render: (v) => dateTime(v.publishedAt) },
          { key: 'by', header: 'By', render: (v) => v.publishedBy || 'System' },
          { key: 'note', header: 'Note', render: (v) => v.changeNote || '—' },
          { key: 'act', header: '', className: 'num', render: (v) => <Button size="sm" variant="ghost" onClick={() => { setCode(''); setConfirm({ type: 'restore', version: v }); }}>Restore to draft</Button> },
        ]} />
      </Card>
      <Modal open={preview} onClose={() => setPreview(false)} title="Preview (not live)" size="lg"><div className="preview-frame"><LegalDoc title={f.title} body={f.body} effectiveDate={f.effectiveDate} preview /></div></Modal>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.type === 'publish' ? 'Publish this document?' : `Restore version ${confirm?.version?.version}?`}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button onClick={submit} loading={busy === 'confirm' || busy === 'save'} disabled={code.length !== 6 || !canPublish}>{confirm?.type === 'publish' ? 'Publish' : 'Restore to draft'}</Button></>}>
        <p>{confirm?.type === 'publish' ? 'This replaces the live document for every visitor and creates a new version. Confirm with your authenticator code.' : 'The old text is copied into your draft. Nothing goes live until you publish.'}</p>
        <Field label="Authenticator code" hint="6-digit code from your authenticator app.">{(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
      </Modal>
    </div>
  );
}
