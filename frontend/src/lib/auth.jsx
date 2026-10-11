import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, isNetworkError } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, permissions: [], mfaEnrollmentRequired: false, config: null, unreachable: null, locked: false, lockInfo: null });

  // A response that merely arrives late (e.g. an older session fetch) must never lift a lock; only an explicit unlock does.
  const apply = useCallback((payload, { unlock = false } = {}) => setState((s) => (payload?.locked
    // Locked on the server: keep whatever is already on screen (hidden behind the lock screen) and learn nothing new.
    ? { ...s, loading: false, unreachable: null, locked: true, lockInfo: payload.lock || null }
    : { ...s, loading: false, unreachable: null, locked: payload && !unlock ? s.locked : false, lockInfo: payload && !unlock ? s.lockInfo : null, user: payload?.user ?? null, permissions: payload?.permissions ?? [], mfaEnrollmentRequired: !!payload?.mfaEnrollmentRequired })), []);

  const reload = useCallback(async () => {
    try {
      let s = await api.get('/api/auth/session');
      if (!s.authenticated && s.canRefresh) { // access token expired but a refresh cookie exists: one silent refresh
        try { await api.post('/api/auth/refresh'); s = await api.get('/api/auth/session'); } catch { /* signed out */ }
      }
      apply(s.authenticated ? s : null);
    } catch (e) {
      if (isNetworkError(e)) setState((s) => ({ ...s, loading: false, user: null, unreachable: e })); // keep "signed in" cookies; just tell the user
      else apply(null);
    }
  }, [apply]);

  /** Re-reads the session WITHOUT the full-page loading state, so open pages and unsaved forms are not torn down. */
  const refresh = useCallback(async ({ unlock = false } = {}) => {
    const s = await api.get('/api/auth/session');
    apply(s.authenticated ? s : null, { unlock });
    return s;
  }, [apply]);
  const setLocked = useCallback((locked, lockInfo = null) => setState((s) => ({ ...s, locked, lockInfo: locked ? (lockInfo ?? s.lockInfo) : null })), []);
  const updateUser = useCallback((user) => setState((s) => (s.user ? { ...s, user: { ...s.user, ...user } } : s)), []);

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
    reload: async () => { setState((s) => ({ ...s, loading: true })); await reload(); },
    refresh, setLocked, updateUser,
    completeLogin: apply,
    /** Ends the session on the server first. If the server cannot be reached the error is raised (we never claim a sign-out that was not confirmed). */
    logout: async () => {
      try { await api.post('/api/auth/logout'); } catch (e) { if (isNetworkError(e)) throw e; /* 401/403: the session was already gone */ }
      try { sessionStorage.removeItem('ewb.hiddenAt'); } catch { /* storage unavailable */ }
      apply(null);
    },
  }), [state, reload, apply, refresh, setLocked, updateUser]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
