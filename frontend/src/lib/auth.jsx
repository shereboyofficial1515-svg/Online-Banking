import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, permissions: [], mfaEnrollmentRequired: false, config: null });

  const apply = useCallback((payload) => setState((s) => ({
    ...s, loading: false, user: payload?.user ?? null, permissions: payload?.permissions ?? [], mfaEnrollmentRequired: !!payload?.mfaEnrollmentRequired,
  })), []);

  const reload = useCallback(async () => {
    try {
      let s = await api.get('/api/auth/session');
      if (!s.authenticated && s.canRefresh) { // access token expired but a refresh cookie exists: one silent refresh
        try { await api.post('/api/auth/refresh'); s = await api.get('/api/auth/session'); } catch { /* signed out */ }
      }
      apply(s.authenticated ? s : null);
    } catch { apply(null); }
  }, [apply]);

  useEffect(() => {
    api.get('/api/auth/config').then((config) => setState((s) => ({ ...s, config }))).catch(() => {});
    reload();
    const expired = () => apply(null);
    window.addEventListener('ewb:session-expired', expired);
    return () => window.removeEventListener('ewb:session-expired', expired);
  }, [reload, apply]);

  const value = useMemo(() => ({
    ...state,
    isStaff: !!state.user?.isStaff,
    can: (p) => state.permissions.includes(p), // UI hint only; the API enforces permissions
    reload,
    completeLogin: apply,
    logout: async () => { try { await api.post('/api/auth/logout'); } catch { /* already signed out */ } apply(null); },
  }), [state, reload, apply]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
