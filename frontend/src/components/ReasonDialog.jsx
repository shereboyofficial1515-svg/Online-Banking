import { useEffect, useState } from 'react';
import { Modal } from './ui/Overlay.jsx';
import { Button, Field, Input, Textarea } from './ui/Controls.jsx';
import { Alert } from './ui/Feedback.jsx';
import { fieldErrors } from '../lib/api.js';

/**
 * Staff confirmation dialog: mandatory reason (stored in the audit log) and, for money-affecting actions, a fresh
 * authenticator code (MFA step-up verified by the server). `onSubmit` receives { reason, mfaCode } and may throw an ApiError.
 */
export default function ReasonDialog({ open, onClose, title, description, confirmLabel = 'Confirm', tone = 'primary', minReason = 5, requireMfa = false, askReason = true, reasonLabel = 'Reason (recorded in the audit log)', children, onSubmit }) {
  const [reason, setReason] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setMfaCode(''); setErr(null); } }, [open]);
  const fe = fieldErrors(err);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (askReason && reason.trim().length < minReason) { setErr({ message: `Please enter a reason of at least ${minReason} characters.`, details: { reason: [`At least ${minReason} characters.`] } }); return; }
    setBusy(true);
    try { await onSubmit({ reason: reason.trim(), mfaCode }); onClose(); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} description={description}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="reason-form" variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy}>{confirmLabel}</Button></>}>
      <form id="reason-form" onSubmit={submit} noValidate>
        {children}
        {err && !fe.reason && !fe.mfaCode && <Alert tone="danger">{err.message}</Alert>}
        {askReason && <Field label={reasonLabel} error={fe.reason} required>{(p) => <Textarea {...p} data-autofocus style={{ minHeight: 90 }} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
        {requireMfa && <Field label="Authenticator code" hint="Enter a current 6-digit code to confirm this action. A code can be used once." error={fe.mfaCode} required>{(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} />}</Field>}
      </form>
    </Modal>
  );
}
