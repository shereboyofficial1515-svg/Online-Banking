import { useState } from 'react';
import { Modal } from './ui/Overlay.jsx';
import { Button } from './ui/Controls.jsx';
import { Alert } from './ui/Feedback.jsx';

/**
 * Confirmation shown before a user-initiated log out. Nothing happens to the session until "Log out" is pressed.
 * `onConfirm` must end the session on the server and throw if that could not be confirmed; the dialog then stays open with
 * the message so the user can retry. Duplicate clicks are ignored while a request is in flight.
 */
export default function LogoutDialog({ open, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const close = () => { if (!busy) { setError(null); onClose(); } };
  const run = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); } catch (ex) { setError(ex?.message || 'We could not reach EWB Bank to end your session. Please try again.'); setBusy(false); return; }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={close} title="Log out of EWB Bank?" size="sm"
      footer={<><Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button><Button onClick={run} loading={busy} data-autofocus>Log out</Button></>}>
      <p>Are you sure you want to log out of your account?</p>
      {error && <Alert tone="danger">{error} You are still signed in.</Alert>}
    </Modal>
  );
}
