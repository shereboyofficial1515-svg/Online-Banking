import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { configureFormat } from './format.js';
import { setLanguage, t as translate } from './i18n.js';
import { DEFAULT_PREFS, applyPrefsToDocument, formatSignature, mergePrefs, readLocalPrefs, resolveTheme, writeLocalPrefs } from './prefs.js';

const PrefsCtx = createContext(null);
export const usePrefs = () => useContext(PrefsCtx);

/**
 * One preference system for the whole app (theme, text size, contrast, motion, language, regional formats, dashboard).
 *  - Signed out: kept in this browser (localStorage).
 *  - Signed in: the server copy is authoritative and is loaded on sign-in; local storage is only a cache so the next page
 *    load paints in the right theme instantly (see public/theme-init.js).
 * `save()` resolves only after the backend confirms, so the UI never reports a setting as saved when it was not.
 */
export function PreferencesProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState(() => readLocalPrefs());
  const [version, setVersion] = useState(0); // bumps when something that changes how content is *rendered* changes
  const [ready, setReady] = useState(false);
  const sig = useRef(formatSignature(prefs));

  const commit = useCallback((next) => {
    setPrefs(next);
    writeLocalPrefs(next);
    applyPrefsToDocument(next);
    setLanguage(next.language);
    configureFormat(next);
    const s = formatSignature(next);
    if (s !== sig.current) { sig.current = s; setVersion((v) => v + 1); }
  }, []);

  // initial paint of everything derived from preferences
  useEffect(() => { commit(prefs); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // follow the operating-system theme while "System" is selected
  useEffect(() => {
    if (prefs.theme !== 'system' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyPrefsToDocument(prefs);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [prefs]);

  // sign-in: adopt the saved server preferences
  const userId = user?.id;
  useEffect(() => {
    let live = true;
    if (!userId) { setReady(true); return undefined; }
    api.get('/api/users/me/preferences')
      .then((r) => { if (live) commit(mergePrefs(DEFAULT_PREFS, r.preferences)); })
      .catch(() => { /* keep local values; the settings pages report save failures explicitly */ })
      .finally(() => live && setReady(true));
    return () => { live = false; };
  }, [userId, commit]);

  /** Persist a partial change. Rejects (with the server's message) if the backend does not confirm it. */
  const save = useCallback(async (patch) => {
    if (!userId) { commit(mergePrefs(prefs, patch)); return mergePrefs(prefs, patch); }
    const r = await api.put('/api/users/me/preferences', patch);
    const merged = mergePrefs(DEFAULT_PREFS, r.preferences);
    commit(merged);
    return merged;
  }, [userId, prefs, commit]);

  /** Quick theme switch from the header: applies instantly, then syncs to the profile (honest if that part fails). */
  const setTheme = useCallback(async (theme) => {
    const optimistic = mergePrefs(prefs, { theme });
    commit(optimistic);
    if (!userId) return;
    try { await api.put('/api/users/me/preferences', { theme }); }
    catch (e) { toast.error(`Theme changed on this device only. We couldn’t save it to your profile: ${e.message}`); }
  }, [prefs, userId, commit, toast]);

  const value = useMemo(() => ({
    prefs, save, setTheme, version, ready, effectiveTheme: resolveTheme(prefs.theme), t: translate,
  }), [prefs, save, setTheme, version, ready]);

  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}
