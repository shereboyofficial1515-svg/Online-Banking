import { useState } from 'react';
import Logo from './ui/Logo.jsx';
import Icon from './ui/Icon.jsx';
import PinInput from './PinInput.jsx';
import { Button, Field, Input, PasswordInput } from './ui/Controls.jsx';
import { Alert } from './ui/Feedback.jsx';
import { useToast } from './ui/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { usePrefs } from '../lib/PreferencesProvider.jsx';

/**
 * Set or change the six-digit session PIN. Always needs the current password (and the authenticator code when MFA is on), so a
 * stolen unlocked session cannot quietly replace the PIN. `blocking` is the first-time screen customers must complete before
 * using banking features; the server refuses banking requests until a PIN exists.
 */
export function PinForm({ onDone, submitLabel }) {
  const { t } = usePrefs();
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ pin: '', confirm: '', password: '', code: '' });
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((c) => ({ ...c, [k]: typeof v === 'string' ? v : v.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setFe({});
    const local = {};
    if (!/^\d{6}$/.test(f.pin)) local.pin = t('pin.digits');
    else if (f.pin !== f.confirm) local.confirm = t('pin.mismatch');
    if (Object.keys(local).length) { setFe(local); return; }
    setBusy(true);
    try {
      await api.post('/api/security/pin', { pin: f.pin, password: f.password, ...(user.mfaEnabled && f.code ? { code: f.code } : {}) });
      updateUser({ pinSet: true });
      setF({ pin: '', confirm: '', password: '', code: '' });
      toast.success(t('common.saved'));
      onDone?.();
    } catch (ex) { const d = fieldErrors(ex); setFe(Object.keys(d).length ? d : { _: ex.message }); setF((c) => ({ ...c, password: '', code: '' })); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      {fe._ && <Alert tone="danger">{fe._}</Alert>}
      <Field label={t('pin.new')} error={fe.pin} required>{(p) => <PinInput {...p} autoFocus value={f.pin} onChange={set('pin')} />}</Field>
      <Field label={t('pin.confirm')} error={fe.confirm} required>{(p) => <PinInput {...p} value={f.confirm} onChange={set('confirm')} />}</Field>
      <Field label={t('pin.password')} error={fe.password} required>{(p) => <PasswordInput {...p} autoComplete="current-password" value={f.password} onChange={set('password')} />}</Field>
      {user.mfaEnabled && <Field label={t('lock.code')} error={fe.code} hint={t('lock.codeHint')} required>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={f.code} onChange={(e) => set('code')(e.target.value.replace(/\s/g, ''))} />}</Field>}
      <Button type="submit" size="lg" loading={busy} disabled={f.pin.length !== 6 || f.confirm.length !== 6 || !f.password} style={{ width: '100%' }}>{submitLabel || t('pin.save')}</Button>
    </form>
  );
}

export default function PinSetup() {
  const { t } = usePrefs();
  const { logout } = useAuth();
  const [err, setErr] = useState(null);
  const leave = async () => { try { await logout(); window.location.assign('/login'); } catch (ex) { setErr(ex.message); } };
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <div className="lock-card">
        <Logo to="/" />
        <span className="lock-icon" aria-hidden="true"><Icon name="lock" size={26} /></span>
        <h1 id="pin-title">{t('pin.title')}</h1>
        <p className="muted">{t('pin.intro')}</p>
        {err && <Alert tone="danger">{err}</Alert>}
        <PinForm />
        <button type="button" className="link-btn lock-leave" onClick={leave}>{t('lock.signout')}</button>
      </div>
    </div>
  );
}
