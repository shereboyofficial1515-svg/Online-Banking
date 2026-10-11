// Session lock after inactivity or time away from the site.
//
// The SERVER owns the clock and the decision (backend/src/services/reauthService.js + sessionService.authenticate): once a session is
// locked, every protected request is refused with 403 SESSION_LOCKED whether or not this code runs, so a stale token, a blocked timer
// or removing this script from the page gets an attacker nothing. This module reports activity and shows the lock screen.
//
//  * Inactivity: no pointer, key, touch or scroll activity for IDLE seconds (default 60) while the page is visible locks the session.
//    While the person IS active the page sends a heartbeat (`/auth/back`) at most every 15 s; the server locks a session whose last
//    heartbeat is older than IDLE + a short grace period even if the browser never says anything.
//  * Away: leaving the page (tab/app switch, screen lock, minimise) = `visibilitychange` hidden / `pagehide`; returning after IDLE
//    seconds locks. Browsers suspend timers in the background, so elapsed time is computed from TIMESTAMPS.
//  * Tabs tell each other through BroadcastChannel; any tab whose request is refused with SESSION_LOCKED locks itself too.
//  * Unlocking: customers use their six-digit PIN or an enabled passkey; staff use password + authenticator code. Forgot the PIN?
//    The password plus a NEW PIN is the recovery path. The page underneath stays mounted (hidden and inert) so the current page and
//    any unsaved text are exactly as left, and nothing is ever resubmitted.
import { useCallback, useEffect, useRef, useState } from 'react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import Logo from '../components/ui/Logo.jsx';
import Icon from '../components/ui/Icon.jsx';
import PinInput from '../components/PinInput.jsx';
import { Button, Field, Input, PasswordInput } from '../components/ui/Controls.jsx';
import { Alert } from '../components/ui/Feedback.jsx';
import { useAuth } from './auth.jsx';
import { api, fieldErrors } from './api.js';
import { usePrefs } from './PreferencesProvider.jsx';

const KEY = 'ewb.hiddenAt';
const HEARTBEAT_MS = 15_000;
const readHidden = () => { try { const v = Number(sessionStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const writeHidden = (t) => { try { if (t) sessionStorage.setItem(KEY, String(t)); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable: the server still enforces the lock */ } };
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

export default function SecurityLock({ children }) {
  const { user, locked, lockInfo, config, loading, setLocked, refresh } = useAuth();
  const idleMs = (config?.idleLockSeconds ?? config?.awayLockSeconds ?? 60) * 1000;
  const authed = !!user || locked;
  const hiddenAt = useRef(null);
  const chan = useRef(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const lastActive = useRef(Date.now());
  const lastBeat = useRef(0);

  const lockNow = useCallback(async () => {
    setLocked(true);
    chan.current?.postMessage({ type: 'lock' });
    try { await api.post('/api/auth/lock', {}); } catch { /* the server also locks on its own clock */ }
  }, [setLocked]);

  const beat = useCallback(async () => {
    lastBeat.current = Date.now();
    try {
      const r = await api.post('/api/auth/back', {});
      if (r?.locked) { setLocked(true); chan.current?.postMessage({ type: 'lock' }); }
    } catch { /* offline: the next request settles it */ }
  }, [setLocked]);

  const comeBack = useCallback(async () => {
    const t = hiddenAt.current ?? readHidden();
    hiddenAt.current = null; writeHidden(null);
    if (lockedRef.current) return;
    if (t && Date.now() - t >= idleMs) { await lockNow(); return; }
    lastActive.current = Date.now();
    await beat();
  }, [idleMs, lockNow, beat]);

  const goAway = useCallback(() => {
    if (lockedRef.current) return;
    if (hiddenAt.current == null) { hiddenAt.current = Date.now(); writeHidden(hiddenAt.current); }
    api.beacon('/api/auth/away'); // best effort: the browser may freeze the page right after this
  }, []);

  useEffect(() => {
    if (!user || loading) return undefined;
    const onVis = () => (document.visibilityState === 'hidden' ? goAway() : comeBack());
    const onShow = (e) => { if (e.persisted) comeBack(); };
    // user activity: remember when it last happened; tell the server at most every HEARTBEAT_MS
    const onActive = () => {
      if (lockedRef.current) return;
      lastActive.current = Date.now();
      if (Date.now() - lastBeat.current >= HEARTBEAT_MS) beat();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', goAway);
    window.addEventListener('pageshow', onShow);
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActive, { passive: true, capture: true });
    comeBack(); // a page load counts as "back": covers reloads and tabs restored after a long time
    // inactivity check from timestamps (a throttled timer only delays it, it can never skip it)
    const tick = setInterval(() => {
      if (lockedRef.current || document.visibilityState !== 'visible') return;
      if (Date.now() - lastActive.current >= idleMs) lockNow();
    }, 2_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', goAway); window.removeEventListener('pageshow', onShow);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActive, { capture: true });
      clearInterval(tick);
    };
  }, [user?.id, loading, goAway, comeBack, beat, lockNow, idleMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // another tab or the API says the session is locked / unlocked
  useEffect(() => {
    const onLockedByApi = () => setLocked(true);
    window.addEventListener('ewb:session-locked', onLockedByApi);
    let ch = null;
    if (typeof BroadcastChannel !== 'undefined') {
      ch = new BroadcastChannel('ewb-security'); chan.current = ch;
      ch.onmessage = async (m) => {
        if (m.data?.type === 'lock') setLocked(true);
        if (m.data?.type === 'unlock') { try { await refresh({ unlock: true }); lastActive.current = Date.now(); window.dispatchEvent(new Event('ewb:unlocked')); } catch { /* handled by the next request */ } }
      };
    }
    return () => { window.removeEventListener('ewb:session-locked', onLockedByApi); ch?.close(); chan.current = null; };
  }, [setLocked, refresh]);

  const unlocked = useCallback(async () => {
    await refresh({ unlock: true });
    lastActive.current = Date.now();
    window.dispatchEvent(new Event('ewb:unlocked'));
    chan.current?.postMessage({ type: 'unlock' });
  }, [refresh]);

  const show = locked && authed;
  return (
    <>
      <div style={{ display: 'contents' }} data-locked={show ? 'true' : undefined} aria-hidden={show || undefined} inert={show || undefined}>{children}</div>
      {show && <LockScreen info={lockInfo} onUnlocked={unlocked} />}
    </>
  );
}

function LockScreen({ info, onUnlocked }) {
  const { logout, user } = useAuth();
  const { t } = usePrefs();
  const staff = (info?.method ?? 'pin') === 'password';
  // A customer who is locked before ever choosing a PIN has nothing to type, so they start on the password + new PIN screen.
  const [mode, setMode] = useState(staff ? 'password' : info?.pinSet === false ? 'reset' : 'pin'); // pin | reset | password (staff)
  const [pin, setPin] = useState('');
  const [f, setF] = useState({ password: '', code: '', newPin: '', confirm: '' });
  const [fe, setFe] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const mfa = info?.mfaRequired ?? user?.mfaEnabled;
  const passkey = !staff && (info?.passkeyAvailable ?? false) && browserSupportsWebAuthn();
  const name = info?.firstName || user?.firstName || '';

  const fail = (ex) => {
    if (ex?.name === 'NotAllowedError') { setErr(t('lock.passkeyCancelled')); return; }
    const d = fieldErrors(ex); setFe(d); setErr(Object.keys(d).length ? null : (ex?.message || t('lock.failed')));
  };
  const run = async (kind, body) => {
    setErr(null); setFe({}); setBusy(kind);
    try { await api.post('/api/auth/unlock', body); setPin(''); setF({ password: '', code: '', newPin: '', confirm: '' }); await onUnlocked(); }
    catch (ex) { fail(ex); setPin(''); setF((c) => ({ ...c, password: '' })); } finally { setBusy(null); }
  };
  const submitPin = (value) => { if (/^\d{6}$/.test(value) && !busy) run('pin', { pin: value }); };
  const submitReset = (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(f.newPin)) { setFe({ newPin: t('pin.digits') }); return; }
    if (f.newPin !== f.confirm) { setFe({ confirm: t('pin.mismatch') }); return; }
    run('reset', { password: f.password, newPin: f.newPin, ...(mfa && f.code ? { code: f.code } : {}) });
  };
  const submitStaff = (e) => { e.preventDefault(); run('password', { password: f.password, ...(mfa ? { code: f.code } : {}) }); };
  const withPasskey = async () => {
    setErr(null); setFe({}); setBusy('passkey');
    try {
      const optionsJSON = await api.post('/api/auth/unlock/passkey/options', {});
      const response = await startAuthentication({ optionsJSON });
      await api.post('/api/auth/unlock/passkey/verify', { response });
      await onUnlocked();
    } catch (ex) { fail(ex); } finally { setBusy(null); }
  };
  const leave = async () => { setBusy('logout'); try { await logout(); window.location.assign('/login'); } catch (ex) { setErr(ex.message); setBusy(null); } };
  const setField = (k) => (e) => setF((c) => ({ ...c, [k]: typeof e === 'string' ? e : e.target.value }));

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title" aria-describedby="lock-desc">
      <div className="lock-card">
        <Logo to="/" compact={false} />
        <span className="lock-icon" aria-hidden="true"><Icon name="lock" size={26} /></span>
        <h1 id="lock-title">{t('lock.title')}</h1>
        <p id="lock-desc" className="muted">{name ? `${t('lock.welcome', { name })} ` : ''}{t('lock.desc')}</p>
        {err && <Alert tone="danger">{err}</Alert>}

        {mode === 'pin' && (
          <>
            <Field label={t('pin.label')} error={fe.pin} required>{(p) => <PinInput {...p} autoFocus value={pin} onChange={setPin} onComplete={submitPin} disabled={!!busy} />}</Field>
            <Button size="lg" loading={busy === 'pin'} disabled={pin.length !== 6 || !!busy} onClick={() => submitPin(pin)} style={{ width: '100%' }}>{t('lock.unlock')}</Button>
            {passkey && <Button variant="secondary" icon="fingerprint" onClick={withPasskey} loading={busy === 'passkey'} disabled={!!busy} style={{ width: '100%' }}>{t('lock.passkey')}</Button>}
            <button type="button" className="link-btn lock-leave" onClick={() => { setMode('reset'); setErr(null); setFe({}); }} disabled={!!busy}>{t('pin.forgot')}</button>
          </>
        )}

        {mode === 'reset' && (
          <form onSubmit={submitReset} noValidate>
            <p className="muted small">{t('pin.resetIntro')}</p>
            <Field label={t('pin.password')} error={fe.password} required>{(p) => <PasswordInput {...p} autoFocus autoComplete="current-password" value={f.password} onChange={setField('password')} />}</Field>
            {mfa && <Field label={t('lock.code')} error={fe.code} hint={t('lock.codeHint')} required>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={f.code} onChange={(e) => setField('code')(e.target.value.replace(/\s/g, ''))} />}</Field>}
            <Field label={t('pin.new')} error={fe.newPin || fe.pin} required>{(p) => <PinInput {...p} value={f.newPin} onChange={setField('newPin')} />}</Field>
            <Field label={t('pin.confirm')} error={fe.confirm} required>{(p) => <PinInput {...p} value={f.confirm} onChange={setField('confirm')} />}</Field>
            <Button type="submit" size="lg" loading={busy === 'reset'} disabled={!f.password || f.newPin.length !== 6 || f.confirm.length !== 6 || (mfa && !f.code) || !!busy} style={{ width: '100%' }}>{t('pin.save')}</Button>
            <button type="button" className="link-btn lock-leave" onClick={() => { setMode('pin'); setErr(null); setFe({}); }} disabled={!!busy}>{t('pin.back')}</button>
          </form>
        )}

        {mode === 'password' && (
          <form onSubmit={submitStaff} noValidate>
            <Field label={t('auth.password')} error={fe.password} required>{(p) => <PasswordInput {...p} autoFocus autoComplete="current-password" value={f.password} onChange={setField('password')} />}</Field>
            {mfa && <Field label={t('lock.code')} error={fe.code} hint={t('lock.codeHint')} required>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={f.code} onChange={(e) => setField('code')(e.target.value.replace(/\s/g, ''))} />}</Field>}
            <Button type="submit" size="lg" loading={busy === 'password'} disabled={!f.password || (mfa && !f.code) || !!busy} style={{ width: '100%' }}>{t('lock.unlock')}</Button>
          </form>
        )}
        <button type="button" className="link-btn lock-leave" onClick={leave} disabled={!!busy}>{t('lock.signout')}</button>
      </div>
    </div>
  );
}
