import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input, Switch, Tabs } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, KeyValue, PageHeader, SkeletonCard, SkeletonRows } from '../../components/ui/Feedback.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, apiUrl, fieldErrors } from '../../lib/api.js';
import { dateTime, initials, relativeTime, titleCase } from '../../lib/format.js';

// ───────── Profile ─────────
export function Profile() {
  useDocumentTitle('Profile');
  const { user, reload } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ phone: user.phone || '', addressLine1: user.address.line1 || '', city: user.address.city || '', state: user.address.state || '', postalCode: user.address.postalCode || '', country: user.address.country || '' });
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const file = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    try { await api.patch('/api/users/me', f); await reload(); toast.success('Profile updated.'); }
    catch (ex) { setFe(fieldErrors(ex)); toast.error(ex.message); } finally { setBusy(false); }
  };
  const upload = async (e) => {
    const picked = e.target.files?.[0]; e.target.value = '';
    if (!picked) return;
    const fd = new FormData(); fd.append('photo', picked);
    try { await api.upload('/api/users/me/photo', fd); await reload(); setPhotoKey((k) => k + 1); toast.success('Profile photo updated.'); } catch (ex) { toast.error(ex.message); }
  };
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHeader title="Profile" subtitle="Your personal details." />
      <Card>
        <div className="row" style={{ gap: 18 }}>
          <span className="avatar" style={{ width: 72, height: 72, fontSize: '1.4rem' }}>{user.hasProfilePhoto ? <img key={photoKey} src={apiUrl(`/api/users/me/photo?v=${photoKey}`)} alt="" /> : initials(user)}</span>
          <div className="grow"><h2>{user.firstName} {user.lastName}</h2><p className="muted" style={{ margin: 0 }}>{user.email}</p></div>
          <input ref={file} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} aria-label="Upload profile photo" />
          <Button variant="secondary" icon="upload" onClick={() => file.current.click()}>Change photo</Button>
        </div>
      </Card>
      <Card title="Identity details" subtitle="To change your name, email or date of birth, contact customer support so we can verify the change.">
        <KeyValue items={[
          { label: 'Full name', value: `${user.firstName} ${user.lastName}` },
          { label: 'Email', value: <>{user.email} {user.emailVerified && <Badge tone="success">Verified</Badge>}</> },
          { label: 'Date of birth', value: user.dateOfBirth },
          { label: 'Username', value: user.username },
          { label: 'Member since', value: dateTime(user.createdAt) },
        ]} />
        <Button to="/app/support" variant="ghost" size="sm" icon="lifebuoy">Request a change</Button>
      </Card>
      <Card title="Contact and address">
        <form onSubmit={save} noValidate>
          <div className="form-grid">
            <Field label="Phone number" error={fe.phone} hint={user.phoneVerified ? 'Verified' : 'Changing your number marks it as unverified.'}>{(p) => <Input {...p} type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} />}</Field>
            <Field label="Street address" error={fe.addressLine1}>{(p) => <Input {...p} autoComplete="address-line1" value={f.addressLine1} onChange={set('addressLine1')} />}</Field>
            <Field label="City" error={fe.city}>{(p) => <Input {...p} autoComplete="address-level2" value={f.city} onChange={set('city')} />}</Field>
            <Field label="State / region" error={fe.state}>{(p) => <Input {...p} autoComplete="address-level1" value={f.state} onChange={set('state')} />}</Field>
            <Field label="Postal code" error={fe.postalCode}>{(p) => <Input {...p} autoComplete="postal-code" value={f.postalCode} onChange={set('postalCode')} />}</Field>
            <Field label="Country" error={fe.country}>{(p) => <Input {...p} autoComplete="country-name" value={f.country} onChange={set('country')} />}</Field>
          </div>
          <Button type="submit" loading={busy}>Save changes</Button>
        </form>
      </Card>
    </div>
  );
}

// ───────── Identity verification ─────────
const SLOTS = [
  { kind: 'id_front', label: 'ID document — front', required: true },
  { kind: 'id_back', label: 'ID document — back', required: false },
  { kind: 'selfie', label: 'Selfie photo', required: true },
  { kind: 'proof_of_address', label: 'Proof of address', required: false },
];

export function Verification() {
  useDocumentTitle('Identity verification');
  const toast = useToast();
  const { reload } = useAuth();
  const { data, loading, error, refetch } = useApi('/api/verification/status');
  const [busy, setBusy] = useState(null);

  if (loading) return <SkeletonCard lines={4} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const run = async (key, fn, ok) => { setBusy(key); try { await fn(); await refetch(); await reload(); if (ok) toast.success(ok); } catch (ex) { toast.error(ex.message); } finally { setBusy(null); } };
  const start = () => run('start', () => api.post('/api/verification/start'));
  const submit = () => run('submit', () => api.post('/api/verification/submit'), 'Submitted for review.');
  const upload = (kind) => async (e) => {
    const picked = e.target.files?.[0]; e.target.value = '';
    if (!picked) return;
    const fd = new FormData(); fd.append('kind', kind); fd.append('file', picked);
    await run(kind, () => api.upload('/api/verification/documents', fd), 'Document uploaded.');
  };
  const have = new Set(data.documents.map((d) => d.kind));
  const status = data.status;
  const canStart = ['not_started', 'failed', 'expired'].includes(status);

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHeader title="Identity verification" subtitle="Verify your identity to unlock transfers and withdrawal reviews." />
      <Card>
        <div className="row-between"><div><div className="muted small">Current status</div><h2 style={{ fontSize: '1.4rem' }}>{data.statusLabel}</h2></div><Badge status={status} /></div>
        {status === 'verified' && <Alert tone="success" title="You’re verified">Your identity has been confirmed. Nothing more is needed.</Alert>}
        {status === 'manual_review' && <Alert tone="info" title="Under review">Our compliance team is reviewing your documents. You’ll get an email when the review is complete.</Alert>}
        {status === 'pending' && <Alert tone="info" title="In progress">Your verification is with our provider. This page updates when a result arrives.</Alert>}
        {status === 'failed' && <Alert tone="danger" title="Verification unsuccessful">{data.reason || 'We could not verify your identity.'} You can start again.</Alert>}
        {status === 'expired' && <Alert tone="warning" title="Session expired">Your verification session expired. Please start again.</Alert>}
        {canStart && <Button onClick={start} loading={busy === 'start'} icon="shield-check">{status === 'not_started' ? 'Start verification' : 'Start again'}</Button>}
        <p className="muted small" style={{ marginTop: 12 }}>We keep only the minimum information required. Files are stored privately and viewed only by authorised compliance staff; every view is logged. We never create or store face templates.</p>
      </Card>

      {status === 'verification_required' && data.requiresDocuments && (
        <Card title="Upload your documents" subtitle="JPEG, PNG, WebP or PDF, up to 5 MB each. Selfies must be photos.">
          <ul className="stack-sm">
            {SLOTS.map((s) => (
              <li key={s.kind} className="upload-slot">
                <div><strong>{s.label}</strong> {s.required ? <Badge tone="warning">Required</Badge> : <Badge>Optional</Badge>}<div className="muted small">{have.has(s.kind) ? <><Icon name="check-circle" size={14} className="check-ok" style={{ display: 'inline', verticalAlign: '-2px' }} /> Uploaded</> : 'Not uploaded yet'}</div></div>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  <Icon name="upload" size={16} /><span>{have.has(s.kind) ? 'Replace' : 'Choose file'}</span>
                  <input className="file-input" type="file" accept={s.kind === 'selfie' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,application/pdf'} capture={s.kind === 'selfie' ? 'user' : undefined} onChange={upload(s.kind)} disabled={busy === s.kind} aria-label={s.label} />
                </label>
              </li>
            ))}
          </ul>
          <Button style={{ marginTop: 16 }} onClick={submit} loading={busy === 'submit'} disabled={!have.has('id_front') || !have.has('selfie')}>Submit for review</Button>
        </Card>
      )}

      <Card title="How it works">
        <ol className="steps"><li><span>Start verification to create a secure session.</span></li><li><span>Provide your ID and a selfie (or complete the check with our provider when one is connected).</span></li><li><span>Our compliance team or provider reviews the result and you’re notified by email.</span></li></ol>
      </Card>
    </div>
  );
}

// ───────── Notifications ─────────
const CATS = ['security', 'account', 'verification', 'transaction', 'withdrawal', 'support', 'system'];
const CAT_ICON = { security: 'shield', account: 'user', verification: 'id', transaction: 'swap', withdrawal: 'upload', support: 'lifebuoy', system: 'info' };

export function Notifications() {
  useDocumentTitle('Notifications');
  const nav = useNavigate();
  const [cat, setCat] = useState('');
  const { data, loading, error, refetch, reload } = useApi('/api/notifications', { category: cat, limit: 50 });
  const changed = () => window.dispatchEvent(new Event('ewb:notifications-changed'));
  const open = async (n) => {
    if (!n.read) { await api.post(`/api/notifications/${n.id}/read`).catch(() => {}); changed(); reload(); }
    if (n.link) nav(n.link);
  };
  const markAll = async () => { await api.post('/api/notifications/read-all'); changed(); reload(); };
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHeader title="Notifications" subtitle="Updates about your accounts, security and requests." actions={<Button variant="secondary" icon="check" onClick={markAll} disabled={!data?.unread}>Mark all as read</Button>} />
      <Tabs label="Notification categories" value={cat} onChange={setCat} tabs={[{ value: '', label: 'All' }, ...CATS.map((c) => ({ value: c, label: titleCase(c) }))]} />
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card>
          {data.items.length ? (
            <ul aria-label="Notifications">{data.items.map((n) => (
              <li key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                <span className="tx-icon"><Icon name={CAT_ICON[n.category] || 'bell'} size={20} /></span>
                <button type="button" className="tx-main" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0 }} onClick={() => open(n)}>
                  <span className="tx-title" style={{ display: 'block', whiteSpace: 'normal' }}>{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</span>
                  <span className="muted small" style={{ display: 'block' }}>{n.body}</span>
                  <span className="muted small">{titleCase(n.category)} · {relativeTime(n.createdAt)}</span>
                </button>
              </li>))}</ul>
          ) : <EmptyState icon="bell" title="You’re all caught up">New notifications will appear here.</EmptyState>}
        </Card>
      )}
    </div>
  );
}

// ───────── Settings ─────────
export function Settings() {
  useDocumentTitle('Settings');
  const toast = useToast();
  const { data, loading, error, refetch } = useApi('/api/notifications/preferences');
  const [prefs, setPrefs] = useState(null);
  const list = prefs ?? data?.preferences;
  if (loading) return <SkeletonCard lines={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const change = async (cat, key, val) => {
    const next = list.map((p) => (p.category === cat ? { ...p, [key]: val } : p));
    setPrefs(next);
    try { const r = await api.put('/api/notifications/preferences', { preferences: next.map(({ category, inApp, email }) => ({ category, inApp, email })) }); setPrefs(r.preferences); }
    catch (ex) { setPrefs(null); toast.error(ex.message); }
  };
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHeader title="Settings" subtitle="Choose how EWB Bank keeps you informed." />
      <Card title="Notification preferences" subtitle="Security notifications cannot be turned off.">
        <div role="group" aria-label="Notification preferences">
          {list.map((p) => (
            <div key={p.category} className="pref-row">
              <div><strong>{titleCase(p.category)}</strong>{p.locked && <div className="muted small">Always on to protect your account.</div>}</div>
              <div className="pref-switches">
                <label><Switch checked={p.inApp} disabled={p.locked} onChange={(v) => change(p.category, 'inApp', v)} label={`${titleCase(p.category)} in-app notifications`} /> In-app</label>
                <label><Switch checked={p.email} disabled={p.locked} onChange={(v) => change(p.category, 'email', v)} label={`${titleCase(p.category)} email notifications`} /> Email</label>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="About your balances">
        <p className="muted">Your balance is calculated from the ledger entries recorded on your account, and every entry is permanent and traceable. See the <Link to="/terms">Terms of Service</Link> for how balances are held and our <Link to="/privacy">Privacy Policy</Link>.</p>
      </Card>
    </div>
  );
}
