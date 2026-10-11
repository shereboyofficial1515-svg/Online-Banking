// Session lock after time away from the site.
//
// The SERVER owns the clock and the decision (see backend/src/services/reauthService.js): this module only reports when the
// page is hidden/shown and shows the lock screen. If the server marks the session locked, every protected request is refused
// with 403 SESSION_LOCKED whether or not this code ever runs, so a stale token or a blocked timer cannot bypass it.
//
//  * Leaving the page (tab switch, app switch, screen lock, minimise, closing) = `visibilitychange` -> hidden / `pagehide`.
//    In-app navigation never fires those events, so it does not count.
//  * Browsers suspend timers in background tabs, so the elapsed time is computed from TIMESTAMPS when the page comes back
//    (a timestamp only is kept in sessionStorage so a reload or a bfcache restore is also covered).
//  * While the page is visible a light heartbeat tells the server the user is present, which clears any stray "away" marker
//    left by another tab being hidden.
//  * Tabs tell each other through BroadcastChannel; any tab whose request is refused with SESSION_LOCKED locks itself too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import Logo from '../components/ui/Logo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Button, Field, Input, PasswordInput } from '../components/ui/Controls.jsx';
import { Alert } from '../components/ui/Feedback.jsx';
import { useAuth } from './auth.jsx';
import { api, fieldErrors } from './api.js';
import { usePrefs } from './PreferencesProvider.jsx';

const KEY = 'ewb.hiddenAt';
const HEARTBEAT_MS = 20_000;
const readHidden = () => { try { const v = Number(sessionStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const writeHidden = (t) => { try { if (t) sessionStorage.setItem(KEY, String(t)); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable: the server still enforces the lock */ } };

export default function SecurityLock({ children }) {
  const { user, locked, lockInfo, config, loading, setLocked, refresh } = useAuth();
  const awayMs = (config?.awayLockSeconds ?? 60) * 1000;
  const authed = !!user || locked;
  const hiddenAt = useRef(null);
  const chan = useRef(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const lockNow = useCallback(async () => {
    setLocked(true);
    chan.current?.postMessage({ type: 'lock' });
    try { await api.post('/api/auth/lock', {}); } catch { /* the server also locks on its own clock */ }
  }, [setLocked]);

  const comeBack = useCallback(async () => {
    const t = hiddenAt.current ?? readHidden();
    hiddenAt.current = null; writeHidden(null);
    if (lockedRef.current) return;
    if (t && Date.now() - t >= awayMs) { await lockNow(); return; }
    try {
      const r = await api.post('/api/auth/back', {});
      if (r?.locked) { setLocked(true); chan.current?.postMessage({ type: 'lock' }); }
    } catch { /* offline: the next request settles it */ }
  }, [awayMs, lockNow, setLocked]);

  const goAway = useCallback(() => {
    if (lockedRef.current) return;
    if (hiddenAt.current == null) { hiddenAt.current = Date.now(); writeHidden(hiddenAt.current); }
    api.beacon('/api/auth/away'); // best effort: the browser may freeze the page right after this
  }, []);

  useEffect(() => {
    if (!user || loading) return undefined;
    const onVis = () => (document.visibilityState === 'hidden' ? goAway() : comeBack());
    const onShow = (e) => { if (e.persisted) comeBack(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', goAway);
    window.addEventListener('pageshow', onShow);
    comeBack(); // a page load counts as "back": covers reloads and tabs restored after a long time
    const beat = setInterval(() => { if (document.visibilityState === 'visible' && !lockedRef.current) comeBack(); }, HEARTBEAT_MS);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', goAway); window.removeEventListener('pageshow', onShow); clearInterval(beat); };
  }, [user?.id, loading, goAway, comeBack]); // eslint-disable-line react-hooks/exhaustive-deps

  // another tab or the API says the session is locked / unlocked
  useEffect(() => {
    const onLockedByApi = () => setLocked(true);
    window.addEventListener('ewb:session-locked', onLockedByApi);
    let ch = null;
    if (typeof BroadcastChannel !== 'undefined') {
      ch = new BroadcastChannel('ewb-security'); chan.current = ch;
      ch.onmessage = async (m) => {
        if (m.data?.type === 'lock') setLocked(true);
        if (m.data?.type === 'unlock') { try { await refresh({ unlock: true }); window.dispatchEvent(new Event('ewb:unlocked')); } catch { /* handled by the next request */ } }
      };
    }
    return () => { window.removeEventListener('ewb:session-locked', onLockedByApi); ch?.close(); chan.current = null; };
  }, [setLocked, refresh]);

  const unlocked = useCallback(async () => {
    await refresh({ unlock: true });
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
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fe, setFe] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const mfa = info?.mfaRequired ?? user?.mfaEnabled;
  const passkey = (info?.passkeyAvailable ?? false) && browserSupportsWebAuthn();
  const name = info?.firstName || user?.firstName || '';

  const fail = (ex) => {
    if (ex?.name === 'NotAllowedError') { setErr('The passkey request was cancelled or timed out.'); return; }
    const f = fieldErrors(ex); setFe(f); setErr(Object.keys(f).length ? null : (ex?.message || 'We could not unlock your session.'));
  };
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setFe({}); setBusy('password');
    try { await api.post('/api/auth/unlock', { password, ...(mfa ? { code } : {}) }); setPassword(''); setCode(''); await onUnlocked(); }
    catch (ex) { fail(ex); setPassword(''); } finally { setBusy(null); }
  };
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

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title" aria-describedby="lock-desc">
      <div className="lock-card">
        <Logo to="/" compact={false} />
        <span className="lock-icon" aria-hidden="true"><Icon name="lock" size={26} /></span>
        <h1 id="lock-title">{t('lock.title')}</h1>
        <p id="lock-desc" className="muted">{name ? `${t('lock.welcome', { name })} ` : ''}{t('lock.desc')}</p>
        {err && <Alert tone="danger">{err}</Alert>}
        <form onSubmit={submit} noValidate>
          <Field label={t('auth.password')} error={fe.password} required>{(p) => <PasswordInput {...p} autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          {mfa && <Field label={t('lock.code')} error={fe.code} hint={t('lock.codeHint')} required>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} />}</Field>}
          <Button type="submit" size="lg" loading={busy === 'password'} disabled={!password || (mfa && !code) || !!busy} style={{ width: '100%' }}>{t('lock.unlock')}</Button>
        </form>
        {passkey && <Button variant="secondary" icon="fingerprint" onClick={withPasskey} loading={busy === 'passkey'} disabled={!!busy} style={{ width: '100%' }}>{t('lock.passkey')}</Button>}
        <button type="button" className="link-btn lock-leave" onClick={leave} disabled={!!busy}>{t('lock.signout')}</button>
      </div>
    </div>
  );
}
