import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { animateIn } from '../../lib/motion.js';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const dismiss = useCallback((i) => setItems((xs) => xs.filter((x) => x.id !== i)), []);
  const push = useCallback((tone, message, title) => {
    const n = ++id.current;
    setItems((xs) => [...xs.slice(-3), { id: n, tone, message, title }]);
    setTimeout(() => dismiss(n), tone === 'danger' ? 8000 : 5000);
  }, [dismiss]);
  const api = useMemo(() => ({
    success: (m, t) => push('success', m, t), error: (m, t) => push('danger', m, t), info: (m, t) => push('info', m, t), dismiss,
  }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} ref={(el) => el && !el.dataset.in && (el.dataset.in = '1', animateIn(el, { y: 14, duration: 0.25 }))} role={t.tone === 'danger' ? 'alert' : 'status'}>
            <Icon name={t.tone === 'success' ? 'check' : t.tone === 'danger' ? 'alert' : 'info'} size={18} />
            <div>{t.title && <strong>{t.title}</strong>}<div>{t.message}</div></div>
            <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
