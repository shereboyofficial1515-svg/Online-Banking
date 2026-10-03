import { useState } from 'react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Button, Field, Input, PasswordInput } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Overlay.jsx';
import PasswordStrength from '../../components/ui/PasswordStrength.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
import { dateTime, relativeTime, titleCase } from '../../lib/format.js';

// ───────── MFA ─────────
function RecoveryCodes({ codes, onClose }) {
  const copy = () => navigator.clipboard?.writeText(codes.join('\n'));
  return (
    <Modal open onClose={onClose} title="Save your recovery codes" size="sm" footer={<><Button variant="secondary" onClick={copy} icon="file">Copy codes</Button><Button onClick={onClose}>I’ve saved them</Button></>}>
      <Alert tone="warning">Each code works once if you lose access to your authenticator app. They are shown only now — store them somewhere safe.</Alert>
      <div className="codes" aria-label="Recovery codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
    </Modal>
  );
}

function MfaCard({ enabled, remaining, onChanged, required }) {
  const { reload } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);
  const [disable, setDisable] = useState(false);
  const [dis, setDis] = useState({ password: '', code: '' });
  const [regen, setRegen] = useState(false);
  const [rcode, setRcode] = useState('');

  const begin = async () => { setBusy(true); setErr(null); try { setSetup(await api.post('/api/security/mfa/setup')); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const confirm = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api.post('/api/security/mfa/enable', { code }); setCodes(r.recoveryCodes); setSetup(null); setCode(''); await reload(); onChanged(); toast.success('Multi-factor authentication enabled.'); }
    catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const doDisable = async () => { await api.post('/api/security/mfa/disable', dis); toast.success('MFA disabled.'); setDis({ password: '', code: '' }); await reload(); onChanged(); };
  const doRegen = async () => { const r = await api.post('/api/security/mfa/recovery-codes', { code: rcode }); setRcode(''); setCodes(r.recoveryCodes); onChanged(); };

  return (
    <Card title="Multi-factor authentication" action={<Badge tone={enabled ? 'success' : 'warning'}>{enabled ? 'Enabled' : 'Not enabled'}</Badge>} data-animate>
      {required && <Alert tone="warning" title="MFA is required for administrator accounts">Set up an authenticator app to continue to the staff console.</Alert>}
      {!enabled && !setup && (<><p className="muted">Protect your profile with a 6-digit code from an authenticator app such as Google Authenticator, 1Password or Authy.</p><Button onClick={begin} loading={busy} icon="shield-check">Set up authenticator app</Button></>)}
      {setup && (
        <form onSubmit={confirm} noValidate>
          <ol className="steps" style={{ marginBottom: 16 }}><li><span>Scan this QR code with your authenticator app, or enter the key manually.</span></li><li><span>Enter the 6-digit code it shows to confirm.</span></li></ol>
          <div className="qr"><img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={200} height={200} /></div>
          <p className="center small muted">Manual key: <code style={{ wordBreak: 'break-all' }}>{setup.manualKey}</code></p>
          {err && <Alert tone="danger">{err.message}</Alert>}
          <Field label="6-digit code" required>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
          <div className="row"><Button type="submit" loading={busy}>Enable MFA</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
        </form>
      )}
      {enabled && (
        <>
          <p className="muted">Your account requires an authenticator code at sign-in. You have <strong>{remaining}</strong> unused recovery code{remaining === 1 ? '' : 's'}.</p>
          <div className="row"><Button variant="secondary" onClick={() => setRegen(true)}>Generate new recovery codes</Button><Button variant="ghost" onClick={() => setDisable(true)}>Turn off MFA</Button></div>
        </>
      )}
      {codes && <RecoveryCodes codes={codes} onClose={() => setCodes(null)} />}
      <ConfirmDialog open={disable} onClose={() => setDisable(false)} onConfirm={doDisable} title="Turn off MFA?" confirmLabel="Turn off" tone="danger">
        <Alert tone="warning">This lowers your account’s protection. Staff accounts cannot turn off MFA.</Alert>
        <Field label="Password" required>{(p) => <PasswordInput {...p} value={dis.password} onChange={(e) => setDis({ ...dis, password: e.target.value })} />}</Field>
        <Field label="Authenticator code" required>{(p) => <Input {...p} inputMode="numeric" maxLength={6} value={dis.code} onChange={(e) => setDis({ ...dis, code: e.target.value.replace(/\D/g, '') })} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={regen} onClose={() => setRegen(false)} onConfirm={doRegen} title="Generate new recovery codes" confirmLabel="Generate" message="Your existing codes will stop working. Enter a current authenticator code to continue.">
        <Field label="Authenticator code" required>{(p) => <Input {...p} inputMode="numeric" maxLength={6} value={rcode} onChange={(e) => setRcode(e.target.value.replace(/\D/g, ''))} />}</Field>
      </ConfirmDialog>
    </Card>
  );
}

// ───────── Passkeys ─────────
function PasskeyCard({ passkeys, onChanged }) {
  const toast = useToast();
  const supported = browserSupportsWebAuthn();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState(null);
  const [remove, setRemove] = useState(null);
  const add = async () => {
    setBusy(true);
    try {
      const optionsJSON = await api.post('/api/security/passkeys/options');
      const response = await startRegistration({ optionsJSON });
      await api.post('/api/security/passkeys/register', { response, name: name || undefined });
      setName(''); onChanged(); toast.success('Passkey registered.');
    } catch (ex) {
      toast.error(ex?.name === 'NotAllowedError' ? 'Passkey setup was cancelled or timed out.' : ex?.name === 'InvalidStateError' ? 'This device already has a passkey for your account.' : ex.message);
    } finally { setBusy(false); }
  };
  return (
    <Card title="Passkeys" subtitle="Sign in with your fingerprint, face or device PIN. We never receive biometric data." data-animate action={<Badge tone={passkeys.length ? 'success' : 'neutral'}>{passkeys.length} registered</Badge>}>
      {!supported && <Alert tone="info">This browser or device doesn’t support passkeys. Try a recent version of Chrome, Edge, Safari or Firefox.</Alert>}
      {passkeys.length > 0 ? (
        <ul>{passkeys.map((p) => (
          <li key={p.id} className="kv-row" style={{ alignItems: 'center' }}>
            <span className="row" style={{ gap: 10 }}><Icon name="fingerprint" /><span><strong>{p.name}</strong><br /><span className="muted small">Added {dateTime(p.createdAt)}{p.lastUsedAt ? ` · last used ${relativeTime(p.lastUsedAt)}` : ' · not used yet'}</span></span></span>
            <span className="row"><Button size="sm" variant="ghost" onClick={() => setRename({ ...p })} aria-label={`Rename ${p.name}`}>Rename</Button><Button size="sm" variant="ghost" onClick={() => setRemove(p)} aria-label={`Remove ${p.name}`}>Remove</Button></span>
          </li>))}</ul>
      ) : <p className="muted">No passkeys yet. Register one to sign in faster and more securely.</p>}
      {supported && (
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <Field label="Name this passkey (optional)" className="grow">{(p) => <Input {...p} maxLength={60} placeholder="e.g. Work laptop" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button icon="plus" onClick={add} loading={busy} style={{ marginBottom: 16 }}>Register a passkey</Button>
        </div>
      )}
      <ConfirmDialog open={!!rename} onClose={() => setRename(null)} title="Rename passkey" confirmLabel="Save" onConfirm={async () => { await api.patch(`/api/security/passkeys/${rename.id}`, { name: rename.name }); onChanged(); }}>
        <Field label="Name" required>{(p) => <Input {...p} maxLength={60} value={rename?.name || ''} onChange={(e) => setRename({ ...rename, name: e.target.value })} />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} title="Remove passkey?" tone="danger" confirmLabel="Remove" message={`“${remove?.name}” will no longer work for sign-in. You can always register it again.`}
        onConfirm={async () => { await api.delete(`/api/security/passkeys/${remove.id}`); onChanged(); toast.success('Passkey removed.'); }} />
    </Card>
  );
}

// ───────── Password ─────────
function PasswordCard({ changedAt }) {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setFe({});
    if (f.newPassword !== f.confirm) { setFe({ confirm: 'Passwords do not match.' }); return; }
    setBusy(true);
    try { await api.post('/api/security/password', { currentPassword: f.currentPassword, newPassword: f.newPassword }); toast.success('Password changed. Other sessions were signed out.'); setOpen(false); setF({ currentPassword: '', newPassword: '', confirm: '' }); }
    catch (ex) { setFe(fieldErrors(ex)); if (!Object.keys(fieldErrors(ex)).length) setFe({ currentPassword: ex.message }); } finally { setBusy(false); }
  };
  return (
    <Card title="Password" data-animate action={<Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Change password</Button>}>
      <p className="muted" style={{ margin: 0 }}>Last changed {dateTime(changedAt)}. Passwords are stored as salted Argon2id hashes; nobody at EWB Bank can see yours.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Change password" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="pw-form" loading={busy}>Update password</Button></>}>
        <form id="pw-form" onSubmit={submit} noValidate>
          <Field label="Current password" error={fe.currentPassword} required>{(p) => <PasswordInput {...p} autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />}</Field>
          <Field label="New password" error={fe.newPassword} required>{(p) => <PasswordInput {...p} autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />}</Field>
          <PasswordStrength password={f.newPassword} email={user.email} />
          <Field label="Confirm new password" error={fe.confirm} required>{(p) => <PasswordInput {...p} autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />}</Field>
        </form>
      </Modal>
    </Card>
  );
}

export default function Security() {
  useDocumentTitle('Security');
  const { mfaEnrollmentRequired, user } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi('/api/security/overview', null, { enabled: !mfaEnrollmentRequired });
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [revokeId, setRevokeId] = useState(null);
  const [removeDevice, setRemoveDevice] = useState(null);

  if (mfaEnrollmentRequired) {
    return (<div className="stack" style={{ maxWidth: 760 }}><PageHeader title="Secure your account" subtitle="One more step before you can continue." /><MfaCard enabled={false} remaining={0} required onChanged={() => window.location.assign('/admin')} /></div>);
  }
  if (loading) return <div className="stack"><SkeletonCard /><SkeletonCard /></div>;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const d = data;
  return (
    <div className="stack">
      <PageHeader title="Security" subtitle="Control how you sign in and review activity on your account." />
      <div className="grid grid-4">
        {[['Email', d.emailVerified, 'Verified'], ['Phone', d.phoneVerified, 'Verified'], ['MFA', d.mfa.enabled, 'Enabled'], ['Passkeys', d.passkeys.length > 0, `${d.passkeys.length} registered`]].map(([k, ok, label]) => (
          <div key={k} className="stat" data-animate><div className="stat-label">{k}</div><div className="stat-value" style={{ fontSize: '1.15rem' }}>{ok ? label : k === 'Phone' ? 'Not available yet' : 'Not set up'}</div>{k === 'Phone' && !ok && <div className="stat-hint">SMS verification isn’t enabled yet.</div>}<span className="stat-icon" style={ok ? undefined : { background: 'var(--warning-soft)', color: 'var(--warning)' }}><Icon name={ok ? 'check' : 'alert'} size={18} /></span></div>
        ))}
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <PasswordCard changedAt={d.password.changedAt} />
        <MfaCard enabled={d.mfa.enabled} remaining={d.mfa.recoveryCodesRemaining} onChanged={reload} />
      </div>
      {!user.isStaff && <PasskeyCard passkeys={d.passkeys} onChanged={reload} />}
      {d.alerts.length > 0 && (
        <Card title="Security alerts" subtitle="Signals we noticed on your account. These are notices, not accusations." data-animate>
          <ul>{d.alerts.map((a) => <li key={a.id} className="kv-row"><span>{a.summary}<br /><span className="muted small">{relativeTime(a.at)}</span></span><Badge status={a.severity} /></li>)}</ul>
        </Card>
      )}
      <Card title="Active sessions" data-animate action={d.sessions.length > 1 && <Button size="sm" variant="secondary" onClick={() => setConfirmOthers(true)}>Sign out other sessions</Button>}>
        <DataTable rows={d.sessions} caption="Active sessions" columns={[
          { key: 'device', header: 'Device', render: (s) => <span className="row" style={{ gap: 8 }}><Icon name="device" size={18} />{s.device}{s.current && <Badge tone="success">This session</Badge>}</span> },
          { key: 'ip', header: 'IP address', render: (s) => <span className="mono">{s.ip || '—'}</span> },
          { key: 'lastSeenAt', header: 'Last active', render: (s) => relativeTime(s.lastSeenAt) },
          { key: 'method', header: 'Sign-in method', render: (s) => titleCase(s.method) },
          { key: 'act', header: '', className: 'num', render: (s) => !s.current && <Button size="sm" variant="ghost" onClick={() => setRevokeId(s.id)}>Revoke</Button> },
        ]} />
      </Card>
      <Card title="Trusted devices" subtitle="Browsers that have signed in to your account." data-animate>
        {d.trustedDevices.length ? <DataTable rows={d.trustedDevices} caption="Devices" columns={[
          { key: 'label', header: 'Device', render: (x) => <span className="row" style={{ gap: 8 }}><Icon name="device" size={18} />{x.label}{x.trusted && <Badge tone="info">Trusted</Badge>}</span> },
          { key: 'lastIp', header: 'Last IP', render: (x) => <span className="mono">{x.lastIp || '—'}</span> },
          { key: 'lastSeenAt', header: 'Last seen', render: (x) => relativeTime(x.lastSeenAt) },
          { key: 'act', header: '', className: 'num', render: (x) => <Button size="sm" variant="ghost" onClick={() => setRemoveDevice(x)}>Remove</Button> },
        ]} /> : <EmptyState icon="device" title="No devices">Devices appear after you sign in.</EmptyState>}
      </Card>
      <Card title="Recent sign-in activity" data-animate pad={false} className="card-flush">
        <DataTable rows={d.recentActivity} caption="Recent sign-in activity" columns={[
          { key: 'at', header: 'When', render: (r) => dateTime(r.at) },
          { key: 'success', header: 'Result', render: (r) => <Badge tone={r.success ? 'success' : 'danger'}>{r.success ? 'Success' : 'Failed'}</Badge> },
          { key: 'method', header: 'Method', render: (r) => titleCase(r.method) },
          { key: 'device', header: 'Device' },
          { key: 'ip', header: 'IP', render: (r) => <span className="mono">{r.ip || '—'}</span> },
        ]} empty={<EmptyState icon="clock" title="No activity yet" />} />
      </Card>
      <ConfirmDialog open={confirmOthers} onClose={() => setConfirmOthers(false)} title="Sign out other sessions?" confirmLabel="Sign out others" message="Every session except this one will be ended immediately." onConfirm={async () => { const r = await api.post('/api/security/sessions/revoke-others'); toast.success(`${r.revoked} session(s) ended.`); reload(); }} />
      <ConfirmDialog open={!!revokeId} onClose={() => setRevokeId(null)} title="Revoke this session?" confirmLabel="Revoke" tone="danger" onConfirm={async () => { await api.delete(`/api/security/sessions/${revokeId}`); toast.success('Session revoked.'); reload(); }} />
      <ConfirmDialog open={!!removeDevice} onClose={() => setRemoveDevice(null)} title="Remove device?" confirmLabel="Remove" tone="danger" message={`“${removeDevice?.label}” will be signed out and no longer trusted.`} onConfirm={async () => { await api.delete(`/api/security/devices/${removeDevice.id}`); toast.success('Device removed.'); reload(); }} />
    </div>
  );
}
