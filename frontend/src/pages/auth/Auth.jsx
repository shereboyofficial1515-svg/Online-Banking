import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { AuthLayout } from '../../layouts/Layouts.jsx';
import { Button, Field, Input, PasswordInput } from '../../components/ui/Controls.jsx';
import { Alert } from '../../components/ui/Feedback.jsx';
import PasswordStrength from '../../components/ui/PasswordStrength.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { api, fieldErrors } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { passwordScore } from '../../lib/format.js';
import { useToast } from '../../components/ui/Toast.jsx';

// ───────── Login ─────────
export function Login() {
  useDocumentTitle('Sign in');
  const { completeLogin, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [step, setStep] = useState('credentials');
  const [mfa, setMfa] = useState({ token: '', code: '', recovery: '', useRecovery: false, trust: false });
  const [err, setErr] = useState(null);
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const passkeys = browserSupportsWebAuthn();

  useEffect(() => { if (user) nav(user.isStaff ? '/admin' : '/app', { replace: true }); }, [user, nav]);

  const finish = (payload) => {
    completeLogin(payload);
    const home = payload.user.isStaff ? (payload.mfaEnrollmentRequired ? '/admin/security-center' : '/admin') : '/app';
    nav(loc.state?.from && !payload.user.isStaff ? loc.state.from : home, { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null); setFe({});
    try {
      const r = await api.post('/api/auth/login', form);
      if (r.mfaRequired) { setMfa((m) => ({ ...m, token: r.mfaToken })); setStep('mfa'); } else finish(r);
    } catch (ex) { setErr(ex); setFe(fieldErrors(ex)); } finally { setBusy(false); }
  };

  const submitMfa = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body = { mfaToken: mfa.token, trustDevice: mfa.trust, ...(mfa.useRecovery ? { recoveryCode: mfa.recovery } : { code: mfa.code }) };
      finish(await api.post('/api/auth/login/mfa', body));
    } catch (ex) {
      setErr(ex);
      if (ex.code === 'MFA_EXPIRED') setStep('credentials');
    } finally { setBusy(false); }
  };

  const passkeyLogin = async () => {
    setBusy(true); setErr(null);
    try {
      const optionsJSON = await api.post('/api/auth/passkey/options', {});
      const response = await startAuthentication({ optionsJSON });
      finish(await api.post('/api/auth/passkey/verify', { response }));
    } catch (ex) {
      if (ex?.name === 'NotAllowedError') setErr({ message: 'Passkey sign-in was cancelled or timed out.' });
      else setErr(ex);
    } finally { setBusy(false); }
  };

  if (step === 'mfa') {
    return (
      <AuthLayout title="Verify it’s you">
        <p className="lead">Enter the 6-digit code from your authenticator app{mfa.useRecovery ? ', or one of your recovery codes' : ''}.</p>
        {err && <Alert tone="danger">{err.message}</Alert>}
        <form onSubmit={submitMfa} noValidate>
          {mfa.useRecovery ? (
            <Field label="Recovery code" hint="Each recovery code works once."><Input data-autofocus autoFocus autoComplete="one-time-code" placeholder="XXXXX-XXXXX" value={mfa.recovery} onChange={(e) => setMfa({ ...mfa, recovery: e.target.value })} /></Field>
          ) : (
            <Field label="Authenticator code"><Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={mfa.code} onChange={(e) => setMfa({ ...mfa, code: e.target.value.replace(/\D/g, '') })} /></Field>
          )}
          <label className="checkbox"><input type="checkbox" checked={mfa.trust} onChange={(e) => setMfa({ ...mfa, trust: e.target.checked })} /><span>Trust this device for 30 days (not available for staff accounts)</span></label>
          <Button type="submit" loading={busy} className="w-full" size="lg" style={{ width: '100%' }}>Verify and sign in</Button>
        </form>
        <p className="auth-foot"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setMfa({ ...mfa, useRecovery: !mfa.useRecovery, code: '', recovery: '' })}>{mfa.useRecovery ? 'Use authenticator code' : 'Use a recovery code instead'}</button></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back">
      <p className="lead">Sign in to manage your accounts.</p>
      {err && (
        <Alert tone="danger" title={err.code === 'EMAIL_NOT_VERIFIED' ? 'Email not verified' : undefined}
          action={err.code === 'EMAIL_NOT_VERIFIED' ? <Button size="sm" variant="secondary" onClick={() => nav('/verify-email', { state: { email: err.details?.email } })}>Enter code</Button> : null}>{err.message}</Alert>
      )}
      <form onSubmit={submit} noValidate>
        <Field label="Email or username" error={fe.identifier} required>{(p) => <Input {...p} autoFocus autoComplete="username" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />}</Field>
        <Field label="Password" error={fe.password} required>{(p) => <PasswordInput {...p} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
        <div className="row-between" style={{ marginBottom: 16 }}><span /><Link to="/forgot-password" className="small">Forgot password?</Link></div>
        <Button type="submit" loading={busy} size="lg" style={{ width: '100%' }}>Sign in</Button>
      </form>
      {passkeys && (<>
        <div className="divider-text">or</div>
        <Button variant="secondary" size="lg" icon="fingerprint" onClick={passkeyLogin} disabled={busy} style={{ width: '100%' }}>Sign in with a passkey</Button>
        <p className="muted small center" style={{ marginTop: 8 }}>Use your fingerprint, face or device PIN.</p>
      </>)}
      <p className="auth-foot">New to EWB Bank? <Link to="/register">Open an account</Link></p>
    </AuthLayout>
  );
}

// ───────── Register ─────────
const empty = { firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '', addressLine1: '', city: '', state: '', postalCode: '', country: '', password: '', confirm: '', agree: false };

export function Register() {
  useDocumentTitle('Open an account');
  const [f, setF] = useState(empty);
  const [fe, setFe] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    const local = {};
    if (f.password !== f.confirm) local.confirm = 'Passwords do not match.';
    if (!f.agree) local.agree = 'You must accept the terms to continue.';
    if (passwordScore(f.password, f.email) < 6) local.password = 'Choose a password that meets every requirement below.';
    setFe(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const { confirm, agree, ...body } = f;
      Object.keys(body).forEach((k) => { if (body[k] === '') delete body[k]; });
      await api.post('/api/auth/register', body);
      nav('/verify-email', { replace: true, state: { email: f.email.trim().toLowerCase(), justRegistered: true } });
    } catch (ex) { setErr(ex); setFe(fieldErrors(ex)); } finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Open your account" wide>
      <p className="lead">It takes a few minutes. We collect only what we need to set up and secure your profile.</p>
      {err && !Object.keys(fe).length && <Alert tone="danger">{err.message}</Alert>}
      {Object.keys(fe).length > 0 && <Alert tone="danger" title="Please fix the highlighted fields" />}
      <form onSubmit={submit} noValidate>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sr-only">Personal details</legend>
          <div className="form-grid">
            <Field label="First name" error={fe.firstName} required>{(p) => <Input {...p} autoComplete="given-name" value={f.firstName} onChange={set('firstName')} />}</Field>
            <Field label="Last name" error={fe.lastName} required>{(p) => <Input {...p} autoComplete="family-name" value={f.lastName} onChange={set('lastName')} />}</Field>
            <Field label="Email address" error={fe.email} required>{(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} />}</Field>
            <Field label="Phone number" error={fe.phone} required>{(p) => <Input {...p} type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} />}</Field>
            <Field label="Date of birth" error={fe.dateOfBirth} hint="You must be 18 or older." required>{(p) => <Input {...p} type="date" autoComplete="bday" value={f.dateOfBirth} onChange={set('dateOfBirth')} />}</Field>
            <Field label="Username (optional)" error={fe.username} hint="Lowercase letters, numbers, dots or underscores.">{(p) => <Input {...p} autoComplete="username" value={f.username || ''} onChange={set('username')} />}</Field>
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }}>
          <legend className="sr-only">Address</legend>
          <div className="form-grid">
            <Field label="Street address" error={fe.addressLine1} className="span-2" required>{(p) => <Input {...p} autoComplete="address-line1" value={f.addressLine1} onChange={set('addressLine1')} />}</Field>
            <Field label="City" error={fe.city} required>{(p) => <Input {...p} autoComplete="address-level2" value={f.city} onChange={set('city')} />}</Field>
            <Field label="State / region" error={fe.state} required>{(p) => <Input {...p} autoComplete="address-level1" value={f.state} onChange={set('state')} />}</Field>
            <Field label="Postal code" error={fe.postalCode}>{(p) => <Input {...p} autoComplete="postal-code" value={f.postalCode} onChange={set('postalCode')} />}</Field>
            <Field label="Country" error={fe.country} required>{(p) => <Input {...p} autoComplete="country-name" value={f.country} onChange={set('country')} />}</Field>
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }}>
          <legend className="sr-only">Password</legend>
          <div className="form-grid">
            <Field label="Password" error={fe.password} required>{(p) => <PasswordInput {...p} autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
            <Field label="Confirm password" error={fe.confirm} required>{(p) => <PasswordInput {...p} autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />}</Field>
          </div>
          <PasswordStrength password={f.password} email={f.email} />
        </fieldset>
        <div className={fe.agree ? 'has-error' : ''}>
          <label className="checkbox"><input type="checkbox" checked={f.agree} onChange={set('agree')} aria-describedby="agree-note" />
            <span>I am 18 or older and agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>, including the <Link to="/terms" target="_blank">important information</Link> on how balances are held.</span></label>
          {fe.agree && <p className="field-error" id="agree-note" role="alert"><Icon name="alert" size={14} /> {fe.agree}</p>}
        </div>
        <Button type="submit" loading={busy} size="lg" style={{ width: '100%' }}>Create account</Button>
      </form>
      <p className="auth-foot">Already registered? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  );
}

// ───────── Email verification (6-digit code) ─────────
export function VerifyEmail() {
  useDocumentTitle('Verify your email');
  const loc = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState(loc.state?.email || '');
  const [code, setCode] = useState('');
  const [fe, setFe] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(loc.state?.justRegistered ? 60 : 0); // a code was just sent: avoid an immediate resend

  const counting = cooldown > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    const local = {};
    if (!email.trim()) local.email = 'Enter the email address you registered with.';
    if (!/^\d{6}$/.test(code)) local.code = 'Enter the 6-digit code from your email.';
    setFe(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api.post('/api/auth/verify-email', { email: email.trim(), code });
      setVerified(true);
    } catch (ex) { setErr(ex); setFe(fieldErrors(ex)); setCode(''); } finally { setBusy(false); }
  };

  const resend = async () => {
    if (!email.trim()) { setFe({ email: 'Enter your email address first.' }); return; }
    setResending(true); setErr(null);
    try {
      await api.post('/api/auth/resend-verification', { email: email.trim() });
      toast.success('If that address needs verification, a new code is on its way.');
      setCooldown(60);
    } catch (ex) { toast.error(ex.message); } finally { setResending(false); }
  };

  if (verified) {
    return (
      <AuthLayout title="Email verified">
        <Alert tone="success" icon="check-circle">Thank you — your email address is confirmed. You can now sign in to your EWB Bank profile.</Alert>
        <Button to="/login" size="lg" style={{ width: '100%' }}>Continue to sign in</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verify your email">
      <p className="lead">{loc.state?.email ? <>We sent a 6-digit code to <strong>{loc.state.email}</strong>. Enter it below to confirm your email address.</> : 'Enter the 6-digit code from your verification email to confirm your address.'}</p>
      {err && !fe.code && !fe.email && <Alert tone="danger">{err.message}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field label="Email address" error={fe.email} required>{(p) => <Input {...p} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Verification code" error={fe.code} hint="The code is valid for 15 minutes." required>
          {(p) => <Input {...p} className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" autoFocus={!!email} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
        </Field>
        <Button type="submit" loading={busy} size="lg" style={{ width: '100%' }}>Verify email</Button>
      </form>
      <p className="auth-foot">
        Didn’t receive a code?{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={resending || cooldown > 0} aria-live="polite">
          {cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? 'Sending…' : 'Resend code'}
        </button>
      </p>
      <p className="auth-foot"><Link to="/login">Back to sign in</Link></p>
    </AuthLayout>
  );
}

// ───────── Forgot / reset password ─────────
export function ForgotPassword() {
  useDocumentTitle('Reset password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await api.post('/api/auth/forgot-password', { email }); setSent(true); } catch (ex) { setErr(ex); } finally { setBusy(false); } };
  return (
    <AuthLayout title="Reset your password">
      {sent ? (<><Alert tone="success" icon="mail">If an account exists for that email, a reset link has been sent. It expires in 30 minutes.</Alert><Button to="/login" variant="secondary" style={{ width: '100%' }}>Back to sign in</Button></>) : (
        <>
          <p className="lead">Enter your email and we’ll send you a link to choose a new password.</p>
          {err && <Alert tone="danger">{err.message}</Alert>}
          <form onSubmit={submit} noValidate><Field label="Email address" error={fieldErrors(err).email} required>{(p) => <Input {...p} type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field><Button type="submit" loading={busy} size="lg" style={{ width: '100%' }}>Send reset link</Button></form>
          <p className="auth-foot"><Link to="/login">Back to sign in</Link></p>
        </>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const nav = useNavigate();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw !== confirm) { setFe({ confirm: 'Passwords do not match.' }); return; }
    setBusy(true);
    try { await api.post('/api/auth/reset-password', { token, password: pw }); toast.success('Password updated. Please sign in.'); nav('/login', { replace: true }); }
    catch (ex) { setErr(ex); setFe(fieldErrors(ex)); } finally { setBusy(false); }
  };
  if (!token) return <AuthLayout title="Reset link needed"><Alert tone="warning">This reset link is incomplete.</Alert><Button to="/forgot-password" style={{ width: '100%' }}>Request a new link</Button></AuthLayout>;
  return (
    <AuthLayout title="Choose a new password">
      {err && !fe.password && <Alert tone="danger">{err.message}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field label="New password" error={fe.password} required>{(p) => <PasswordInput {...p} autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <PasswordStrength password={pw} />
        <Field label="Confirm new password" error={fe.confirm} required>{(p) => <PasswordInput {...p} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        <Button type="submit" loading={busy} size="lg" style={{ width: '100%' }}>Update password</Button>
      </form>
    </AuthLayout>
  );
}
