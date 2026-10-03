import { useEffect, useRef, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { Button } from './Controls.jsx';
import { useDialogMotion } from '../../lib/motion.js';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

/** Shared behaviour for modal + drawer: focus trap, Esc to close, scroll lock, focus restoration. */
function useOverlay(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    document.body.classList.add('no-scroll');
    const el = ref.current;
    const first = el?.querySelector('[data-autofocus]') || el?.querySelector(FOCUSABLE);
    first?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const nodes = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const a = nodes[0]; const z = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); prev?.focus?.(); };
  }, [open, onClose, ref]);
}

export function Modal({ open, onClose, title, children, footer, size = 'md', description }) {
  const ref = useRef(null);
  const titleId = useId();
  useOverlay(open, onClose, ref);
  useDialogMotion(ref, open, 'modal');
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog"><Icon name="x" size={20} /></button>
        </header>
        {description && <p className="muted modal-desc">{description}</p>}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>, document.body);
}

/** Confirmation dialog for destructive or consequential actions. `onConfirm` may be async. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', children }) {
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } };
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} size="sm"
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={run} data-autofocus>{confirmLabel}</Button></>}>
      {message && <p>{message}</p>}
      {children}
    </Modal>
  );
}

export function Drawer({ open, onClose, title, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useOverlay(open, onClose, ref);
  useDialogMotion(ref, open, 'drawer');
  if (!open) return null;
  return createPortal(
    <div className="overlay overlay-drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu"><Icon name="x" size={20} /></button></header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>, document.body);
}
