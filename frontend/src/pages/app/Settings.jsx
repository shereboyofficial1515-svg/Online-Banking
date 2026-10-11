// Customer settings hub. Every page here saves through the backend and only reports "saved" after the server confirms it.
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, Field, Input, PasswordInput, Select, Switch, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import { Modal } from '../../components/ui/Overlay.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import Security from './Security.jsx';
import { Profile } from './Account.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useSite } from '../../lib/site.jsx';
import { usePrefs } from '../../lib/PreferencesProvider.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
import { LANGUAGES } from '../../lib/i18n.js';
import { browserTimezone, timezoneOptions } from '../../lib/prefs.js';
import { dateTime, titleCase } from '../../lib/format.js';

// ───────── hub layout ─────────
const GROUPS = (t) => [
  { label: t('settings.group.profile'), items: [
    { to: 'profile', icon: 'user', label: t('settings.profile'), desc: t('settings.profile.desc') },
    { to: 'accounts', icon: 'wallet', label: t('settings.accounts'), desc: t('settings.accounts.desc') },
    { to: '/app/verification', icon: 'id', label: t('settings.verification'), desc: t('settings.verification.desc') },
  ] },
  { label: t('settings.group.security'), items: [
    { to: 'security', icon: 'lock', label: t('settings.security'), desc: t('settings.security.desc') },
    { to: 'sessions', icon: 'device', label: t('settings.sessions'), desc: t('settings.sessions.desc') },
    { to: 'security-center', icon: 'shield-check', label: t('settings.securityCenter'), desc: t('settings.securityCenter.desc') },
  ] },
  { label: t('settings.group.communication'), items: [
    { to: 'email', icon: 'mail', label: t('settings.email'), desc: t('settings.email.desc') },
    { to: 'notifications', icon: 'bell', label: t('settings.notifications'), desc: t('settings.notifications.desc') },
  ] },
  { label: t('settings.group.preferences'), items: [
    { to: 'display', icon: 'sun', label: t('settings.display'), desc: t('settings.display.desc') },
    { to: 'accessibility', icon: 'eye', label: t('settings.accessibility'), desc: t('settings.accessibility.desc') },
    { to: 'regional', icon: 'globe', label: t('settings.regional'), desc: t('settings.regional.desc') },
    { to: 'dashboard', icon: 'home', label: t('settings.dashboard'), desc: t('settings.dashboard.desc') },
  ] },
  { label: t('settings.group.support'), items: [
    { to: 'feedback', icon: 'lifebuoy', label: t('settings.feedback'), desc: t('settings.feedback.desc') },
    { to: 'about', icon: 'file', label: t('settings.about'), desc: t('settings.about.desc') },
    { to: 'accounts#close', icon: 'x', label: t('settings.close'), desc: t('settings.close.desc') },
  ] },
];

export function SettingsLayout() {
  const { t } = usePrefs();
  const loc = useLocation();
  const isIndex = /\/app\/settings\/?$/.test(loc.pathname);
  const groups = useMemo(() => GROUPS(t), [t]);
  const to = (p) => (p.startsWith('/') ? p : `/app/settings/${p}`);
  return (
    <div className={`settings ${isIndex ? 'is-index' : 'is-page'}`}>
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <h1 className="settings-title">{t('settings.title')}</h1>
        {groups.map((g) => (
          <div key={g.label} className="settings-group">
            <h2>{g.label}</h2>
            <ul>{g.items.map((i) => (
              <li key={i.to}>
                <NavLink to={to(i.to)} className={({ isActive }) => `settings-link ${isActive && !i.to.includes('#') ? 'active' : ''}`}>
                  <Icon name={i.icon} size={20} /><span><strong>{i.label}</strong><small>{i.desc}</small></span><Icon name="chevron-right" size={16} className="settings-chev" />
                </NavLink>
              </li>
            ))}</ul>
          </div>
        ))}
      </nav>
      <div className="settings-pane">
        {!isIndex && <Link to="/app/settings" className="settings-back"><Icon name="chevron-left" size={16} /> {t('settings.back')}</Link>}
        {isIndex ? <SettingsWelcome /> : <Outlet />}
      </div>
    </div>
  );
}

function SettingsWelcome() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.title'));
  return (
    <div className="stack">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <Card><EmptyState icon="settings" title="Choose a section">Pick a topic from the list to view or change it.</EmptyState></Card>
    </div>
  );
}

// ───────── generic preference-saving helper ─────────
function usePrefDraft(keys) {
  const { prefs, save } = usePrefs();
  const toast = useToast();
  const pick = () => Object.fromEntries(keys.map((k) => [k, k === 'dashboard' ? { ...prefs.dashboard } : prefs[k]]));
  const [draft, setDraft] = useState(pick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(pick());
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault(); setBusy(true); setError(null);
    try { await save(draft); toast.success('Settings saved.'); }
    catch (ex) { setError(ex.message || 'We could not save your settings.'); toast.error(ex.message || 'We could not save your settings.'); } finally { setBusy(false); }
  };
  return { draft, set, dirty, busy, error, submit, reset: () => setDraft(pick()) };
}

function SaveBar({ form }) {
  const { t } = usePrefs();
  return (
    <div className="save-bar">
      {form.error && <p className="field-error" role="alert"><Icon name="alert" size={14} /> {form.error}</p>}
      <Button type="submit" loading={form.busy} disabled={!form.dirty}>{t('common.save')}</Button>
      <Button type="button" variant="ghost" onClick={form.reset} disabled={!form.dirty || form.busy}>{t('common.reset')}</Button>
    </div>
  );
}

function Choices({ legend, name, value, onChange, options }) {
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      <div className="choice-grid">
        {options.map(([v, label, desc]) => (
          <label key={v} className={`choice ${value === v ? 'on' : ''}`}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            <span><strong>{label}</strong>{desc && <small>{desc}</small>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ───────── display & language ─────────
export function DisplaySettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.display'));
  const f = usePrefDraft(['theme', 'language']);
  return (
    <div className="stack">
      <PageHeader title={t('settings.display')} subtitle={t('settings.display.desc')} />
      <form onSubmit={f.submit} className="stack" noValidate>
        <Card title={t('display.theme')}>
          <Choices legend={t('display.theme')} name="theme" value={f.draft.theme} onChange={(v) => f.set('theme', v)} options={[
            ['light', t('display.theme.light'), t('display.theme.light.desc')], ['dark', t('display.theme.dark'), t('display.theme.dark.desc')], ['system', t('display.theme.system'), t('display.theme.system.desc')]]} />
        </Card>
        <Card title={t('display.language')}>
          <Field label={t('display.language')} hint={t('display.language.note')}>{(a) => <Select {...a} value={f.draft.language} onChange={(e) => f.set('language', e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select>}</Field>
        </Card>
        <SaveBar form={f} />
      </form>
    </div>
  );
}

// ───────── accessibility ─────────
export function AccessibilitySettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.accessibility'));
  const f = usePrefDraft(['textSize', 'contrast', 'motion']);
  return (
    <div className="stack">
      <PageHeader title={t('settings.accessibility')} subtitle={t('settings.accessibility.desc')} />
      <form onSubmit={f.submit} className="stack" noValidate>
        <Card title="Text size"><Choices legend="Text size" name="textSize" value={f.draft.textSize} onChange={(v) => f.set('textSize', v)} options={[['small', 'Small'], ['default', 'Standard'], ['large', 'Large'], ['xlarge', 'Extra large']]} /></Card>
        <Card title="Contrast"><Choices legend="Contrast" name="contrast" value={f.draft.contrast} onChange={(v) => f.set('contrast', v)} options={[['standard', 'Standard'], ['high', 'High contrast', 'Stronger borders and text colours']]} /></Card>
        <Card title="Motion"><Choices legend="Animation" name="motion" value={f.draft.motion} onChange={(v) => f.set('motion', v)} options={[['system', 'Match my device', 'Follows your device’s reduce-motion setting'], ['reduce', 'Reduce motion', 'Turns off animated transitions']]} /></Card>
        <Card title="Sample"><p>This is how body text looks with your choices. <a href="#sample" onClick={(e) => e.preventDefault()}>This is a link.</a></p><Button variant="secondary" type="button">Sample button</Button></Card>
        <SaveBar form={f} />
      </form>
    </div>
  );
}

// ───────── regional formats ─────────
export function RegionalSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.regional'));
  const f = usePrefDraft(['timezone', 'dateFormat', 'timeFormat', 'numberFormat', 'currencyDisplay']);
  const zones = useMemo(timezoneOptions, []);
  const tz = f.draft.timezone || browserTimezone();
  let now = '';
  try { now = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(new Date()); } catch { now = ''; }
  return (
    <div className="stack">
      <PageHeader title={t('settings.regional')} subtitle={t('settings.regional.desc')} />
      <form onSubmit={f.submit} className="stack" noValidate>
        <Card title="Timezone" subtitle="Stored times are always kept in UTC; this only changes how they are shown to you.">
          <Field label="Timezone" hint={now ? `Now: ${now}` : undefined}>{(a) => (
            <Select {...a} value={f.draft.timezone || ''} onChange={(e) => f.set('timezone', e.target.value || null)}>
              <option value="">Use my device’s timezone ({browserTimezone()})</option>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </Select>)}</Field>
        </Card>
        <Card title="Formats">
          <div className="form-grid">
            <Field label="Date format">{(a) => <Select {...a} value={f.draft.dateFormat} onChange={(e) => f.set('dateFormat', e.target.value)}><option value="system">Match my device</option><option value="mdy">Month/Day/Year (10/31/2026)</option><option value="dmy">Day/Month/Year (31/10/2026)</option><option value="ymd">Year-Month-Day (2026-10-31)</option></Select>}</Field>
            <Field label="Time format">{(a) => <Select {...a} value={f.draft.timeFormat} onChange={(e) => f.set('timeFormat', e.target.value)}><option value="system">Match my device</option><option value="12h">12-hour (2:30 PM)</option><option value="24h">24-hour (14:30)</option></Select>}</Field>
            <Field label="Number format" hint="Decimal and thousands separators.">{(a) => <Select {...a} value={f.draft.numberFormat} onChange={(e) => f.set('numberFormat', e.target.value)}><option value="system">Match my device</option><option value="en-US">1,234.56</option><option value="en-GB">1,234.56 (UK)</option><option value="de-DE">1.234,56</option><option value="fr-FR">1 234,56</option><option value="en-IN">12,34,567.89</option></Select>}</Field>
            <Field label="Currency display">{(a) => <Select {...a} value={f.draft.currencyDisplay} onChange={(e) => f.set('currencyDisplay', e.target.value)}><option value="symbol">Symbol ($1,234.56)</option><option value="code">Code (USD 1,234.56)</option></Select>}</Field>
          </div>
        </Card>
        <SaveBar form={f} />
      </form>
    </div>
  );
}

// ───────── dashboard / home screen ─────────
export function DashboardSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.dashboard'));
  const f = usePrefDraft(['dashboard']);
  const { data, loading } = useApi('/api/accounts');
  const d = f.draft.dashboard;
  const setD = (k, v) => f.set('dashboard', { ...d, [k]: v });
  const rows = [['showChart', 'Balance history chart'], ['showMoneyInOut', 'Money in and out chart'], ['showRecent', 'Recent transactions'], ['showSecurity', 'Security status']];
  return (
    <div className="stack">
      <PageHeader title={t('settings.dashboard')} subtitle={t('settings.dashboard.desc')} />
      <form onSubmit={f.submit} className="stack" noValidate>
        <Card title="Cards on your dashboard" subtitle="Your balance is always shown.">
          <div role="group" aria-label="Dashboard cards">{rows.map(([k, label]) => (
            <div key={k} className="pref-row"><strong id={`dash-${k}`}>{label}</strong><Switch checked={!!d[k]} onChange={(v) => setD(k, v)} label={label} describedBy={`dash-${k}`} /></div>
          ))}</div>
        </Card>
        <Card title="Default account" subtitle="The account shown first on your dashboard.">
          {loading ? <SkeletonCard lines={1} /> : (
            <Field label="Account">{(a) => (
              <Select {...a} value={d.defaultAccountId || ''} onChange={(e) => setD('defaultAccountId', e.target.value || null)}>
                <option value="">My first account</option>
                {(data?.accounts || []).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.accountNumber}</option>)}
              </Select>)}</Field>
          )}
        </Card>
        <SaveBar form={f} />
      </form>
    </div>
  );
}

// ───────── notifications ─────────
export function NotificationSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.notifications'));
  const toast = useToast();
  const { data, loading, error, refetch } = useApi('/api/notifications/preferences');
  const [prefs, setPrefs] = useState(null);
  const list = prefs ?? data?.preferences;
  if (loading) return <SkeletonCard lines={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const change = async (cat, key, val) => {
    const next = list.map((p) => (p.category === cat ? { ...p, [key]: val } : p));
    setPrefs(next);
    try { const r = await api.put('/api/notifications/preferences', { preferences: next.map(({ category, inApp, email }) => ({ category, inApp, email })) }); setPrefs(r.preferences); toast.success('Notification settings saved.'); }
    catch (ex) { setPrefs(null); toast.error(`Not saved: ${ex.message}`); }
  };
  return (
    <div className="stack">
      <PageHeader title={t('settings.notifications')} subtitle="In-app and email are the channels we currently offer. Security notices cannot be turned off." />
      <Card>
        <div role="group" aria-label="Notification settings">
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
    </div>
  );
}

// ───────── email ─────────
export function EmailSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.email'));
  const { user, reload } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState('form'); // form | code
  const [f, setF] = useState({ newEmail: '', password: '' });
  const [code, setCode] = useState('');
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const request = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    try { await api.post('/api/users/me/email-change', f); setStep('code'); toast.success('We sent a code to your new address.'); }
    catch (ex) { setFe(fieldErrors(ex)); if (!Object.keys(fieldErrors(ex)).length) toast.error(ex.message); } finally { setBusy(false); }
  };
  const confirm = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    try { await api.post('/api/users/me/email-change/confirm', { code }); await reload(); toast.success('Your email address was updated. Other sessions were signed out.'); setStep('form'); setF({ newEmail: '', password: '' }); setCode(''); }
    catch (ex) { setFe({ code: ex.message }); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <PageHeader title={t('settings.email')} subtitle={t('settings.email.desc')} />
      <Card title="Current email address"><p style={{ margin: 0 }}>{user.email} {user.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}</p></Card>
      <Card title="Change your email address" subtitle="We confirm the new address with a code before anything changes.">
        {step === 'form' ? (
          <form onSubmit={request} noValidate>
            <div className="form-grid">
              <Field label="New email address" error={fe.newEmail} required>{(a) => <Input {...a} type="email" autoComplete="email" value={f.newEmail} onChange={(e) => setF({ ...f, newEmail: e.target.value })} />}</Field>
              <Field label="Current password" error={fe.password} hint="Required to protect your account." required>{(a) => <PasswordInput {...a} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
            </div>
            <Button type="submit" loading={busy} disabled={!f.newEmail || !f.password}>Send confirmation code</Button>
          </form>
        ) : (
          <form onSubmit={confirm} noValidate>
            <Alert tone="info" title="Check your new inbox">Enter the 6-digit code we sent to {f.newEmail}. It is valid for 15 minutes.</Alert>
            <Field label="Confirmation code" error={fe.code} required>{(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
            <div className="row"><Button type="submit" loading={busy} disabled={code.length !== 6}>Confirm change</Button><Button type="button" variant="ghost" onClick={() => { setStep('form'); setCode(''); setFe({}); }}>Start over</Button></div>
          </form>
        )}
      </Card>
    </div>
  );
}

// ───────── accounts, rename and closure ─────────
function AccountCard({ account, onChanged }) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const closure = useApi(`/api/accounts/${account.id}/closure`);
  const [open, setOpen] = useState(false);
  const [c, setC] = useState({ reason: '', password: '' });
  const [ce, setCe] = useState({});
  const [cbusy, setCbusy] = useState(false);
  const rename = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.patch(`/api/accounts/${account.id}`, { name }); toast.success('Account name saved.'); onChanged(); } catch (ex) { setErr(fieldErrors(ex).name || ex.message); } finally { setBusy(false); }
  };
  const requestClose = async (e) => {
    e.preventDefault(); setCbusy(true); setCe({});
    try { await api.post(`/api/accounts/${account.id}/closure`, c.reason ? c : { password: c.password }); toast.success('Closure requested.'); setOpen(false); setC({ reason: '', password: '' }); closure.refetch(); }
    catch (ex) { setCe({ ...fieldErrors(ex), _: ex.message }); } finally { setCbusy(false); }
  };
  const cancel = async () => { try { await api.delete(`/api/accounts/${account.id}/closure`); toast.success('Closure request cancelled.'); closure.refetch(); } catch (ex) { toast.error(ex.message); } };
  const cl = closure.data?.closure;
  const pending = cl?.status === 'requested';
  return (
    <Card title={account.name} action={<Badge status={account.status} />} data-animate>
      <dl className="kv">
        <div className="kv-row"><dt>Account number</dt><dd><span className="mono">{account.accountNumber}</span> <button type="button" className="link-btn" onClick={() => navigator.clipboard?.writeText(account.accountNumber).then(() => toast.success('Account number copied.'))}>Copy</button></dd></div>
        <div className="kv-row"><dt>Type</dt><dd>{titleCase(account.type)}</dd></div>
        <div className="kv-row"><dt>Currency</dt><dd>{account.currency}</dd></div>
        <div className="kv-row"><dt>Opened</dt><dd>{dateTime(account.createdAt)}</dd></div>
      </dl>
      <form onSubmit={rename} noValidate className="row" style={{ alignItems: 'flex-end', marginTop: 12 }}>
        <Field label="Account name" error={err} className="grow">{(a) => <Input {...a} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Button type="submit" variant="secondary" loading={busy} disabled={name.trim() === account.name || name.trim().length < 2} style={{ marginBottom: 16 }}>Save name</Button>
      </form>
      {account.status !== 'closed' && (
        <div id="close" className="close-box">
          {pending ? (
            <Alert tone="info" title="Closure requested" action={<Button size="sm" variant="secondary" onClick={cancel}>Cancel request</Button>}>
              Requested {dateTime(cl.createdAt)}. Our team will confirm once the account is closed.{cl.ticketId && <> <Link to={`/app/support/${cl.ticketId}`}>View conversation</Link></>}
            </Alert>
          ) : (
            <><p className="muted small">An account can be closed when its balance is zero and nothing is on hold. Your transaction history stays available.</p>
              <Button variant="danger" onClick={() => setOpen(true)}>Close this account…</Button></>
          )}
          {cl?.status === 'declined' && <p className="muted small">Your last request was not completed. Contact customer support for details.</p>}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Close ${account.name}?`} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Keep account</Button><Button variant="danger" type="submit" form={`close-${account.id}`} loading={cbusy} disabled={!c.password}>Request closure</Button></>}>
        <form id={`close-${account.id}`} onSubmit={requestClose} noValidate>
          <p>Our team will review and complete your request. Until then you can cancel it.</p>
          {ce._ && !ce.password && <Alert tone="warning">{ce._}</Alert>}
          <Field label="Reason (optional)">{(a) => <Textarea {...a} rows={3} maxLength={500} value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} />}</Field>
          <Field label="Current password" error={ce.password} required>{(a) => <PasswordInput {...a} autoComplete="current-password" value={c.password} onChange={(e) => setC({ ...c, password: e.target.value })} />}</Field>
        </form>
      </Modal>
    </Card>
  );
}

export function AccountSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.accounts'));
  const { data, loading, error, refetch, reload } = useApi('/api/accounts');
  const loc = useLocation();
  useEffect(() => { if (loc.hash === '#close') document.getElementById('close')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [loc.hash, data]);
  if (loading) return <SkeletonCard lines={4} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div className="stack">
      <PageHeader title={t('settings.accounts')} subtitle="Name your accounts, copy account details, or request closure." />
      {data.accounts.length ? data.accounts.map((a) => <AccountCard key={a.id} account={a} onChanged={reload} />) : <Card><EmptyState icon="wallet" title="No accounts yet" /></Card>}
    </div>
  );
}

// ───────── feedback ─────────
export function FeedbackSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.feedback'));
  const [f, setF] = useState({ kind: 'suggestion', message: '' });
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    try { const r = await api.post('/api/users/me/feedback', f); setDone(r.ticket); setF({ kind: 'suggestion', message: '' }); }
    catch (ex) { setFe(fieldErrors(ex)); if (!Object.keys(fieldErrors(ex)).length) setFe({ _: ex.message }); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <PageHeader title={t('settings.feedback')} subtitle={t('settings.feedback.desc')} />
      {done && <Alert tone="success" title="Thank you">We received your message. Reference {done.reference}. <Link to={`/app/support/${done.id}`}>View it</Link></Alert>}
      <Card>
        <form onSubmit={submit} noValidate>
          <Field label="Type">{(a) => <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="suggestion">Suggestion</option><option value="problem">Something isn’t working</option><option value="compliment">Compliment</option></Select>}</Field>
          <Field label="Your message" error={fe.message || fe._} hint="Please don’t include passwords or one-time codes." required>{(a) => <Textarea {...a} rows={6} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
          <Button type="submit" loading={busy} disabled={f.message.trim().length < 10}>Send feedback</Button>
        </form>
      </Card>
    </div>
  );
}

// ───────── about & legal ─────────
export function AboutSettings() {
  const { t } = usePrefs();
  useDocumentTitle(t('settings.about'));
  const { config } = useSite();
  const legal = useApi('/api/public/legal');
  const acc = useApi('/api/users/me/legal-acceptances');
  return (
    <div className="stack">
      <PageHeader title={t('settings.about')} subtitle={t('settings.about.desc')} />
      <Card title={config.brand.siteName}><p className="muted" style={{ margin: 0 }}>{config.brand.shortDescription}</p><p style={{ marginTop: 10 }}><Link to="/about">About us</Link> · <Link to="/contact">Contact us</Link></p></Card>
      <Card title="Policies and terms">
        {legal.loading ? <SkeletonCard lines={2} /> : (
          <ul>{(legal.data?.items || []).map((d) => <li key={d.slug} className="kv-row"><Link to={d.route}>{d.title}</Link><span className="muted small">Version {d.version} · effective {d.effectiveDate}</span></li>)}</ul>
        )}
      </Card>
      <Card title="Your accepted documents" subtitle="The exact versions you agreed to are kept on record and are not changed when documents are updated.">
        {acc.loading ? <SkeletonCard lines={2} /> : acc.data?.items?.length ? (
          <ul>{acc.data.items.map((a, i) => <li key={i} className="kv-row"><span>{a.title}</span><span className="muted small">Version {a.version} · accepted {dateTime(a.acceptedAt)}</span></li>)}</ul>
        ) : <p className="muted" style={{ margin: 0 }}>No acceptance records are stored for this profile.</p>}
      </Card>
    </div>
  );
}

// ───────── security pages (sections of the Security Center) ─────────
export const PasswordSettings = () => <Security show={['password', 'mfa', 'passkeys']} title="Password & authentication" subtitle="Your password, authenticator app and passkeys." />;
export const SessionSettings = () => <Security show={['sessions', 'devices']} title="Active sessions & devices" subtitle="See where you are signed in and end sessions you don’t recognise." />;
export const SecurityCenterSettings = () => <Security show={['overview', 'alerts', 'activity']} title="Security Center" subtitle="An overview of how well your account is protected." />;

export { Profile };
