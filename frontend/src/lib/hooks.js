import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useSite } from './site.jsx';

/** GET helper with loading/error state, cancellation of stale requests and manual reload. */
export function useApi(path, params, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const key = path + JSON.stringify(params ?? {});
  const seq = useRef(0);
  const load = useCallback(async (silent = false) => {
    if (!enabled || !path) return;
    const n = ++seq.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path, params);
      if (n === seq.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (n === seq.current) setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: () => load(true), refetch: () => load(false) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useDocumentTitle(title) {
  const name = useSite().config.brand.siteName;
  useEffect(() => { document.title = title ? `${title} · ${name}` : name; }, [title, name]);
}
