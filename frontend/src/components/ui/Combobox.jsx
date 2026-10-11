import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Searchable single-select (ARIA combobox pattern). The trigger shows the current choice; opening it reveals a search box and a
 * listbox. Arrow keys move, Enter selects, Escape closes, Home/End jump. On narrow screens the list becomes a bottom sheet so it
 * can never extend beyond the viewport. Options: { value, label, search?, render? }.
 */
export default function Combobox({ id, label, value, options, onChange, placeholder = '', searchLabel, emptyText, renderSelected, disabled, className = '', triggerClassName = '', describedBy, invalid }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return options;
    return options.filter((o) => (o.search ?? o.label).toLowerCase().includes(n));
  }, [q, options]);

  useEffect(() => { if (open) { setQ(''); const i = Math.max(0, options.findIndex((o) => o.value === value)); setActive(i); setTimeout(() => input.current?.focus(), 0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, shown.length - 1))); }, [shown.length]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const trigger = () => root.current?.querySelector('button.combo-trigger');
  const choose = (o) => { onChange(o.value); setOpen(false); trigger()?.focus(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger()?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`combo ${className}`} ref={root}>
      <button type="button" id={id} className={`combo-trigger ${triggerClassName}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={label} aria-describedby={describedBy} aria-invalid={invalid || undefined} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setOpen(true); } }}>
        <span className="combo-value">{selected ? (renderSelected ? renderSelected(selected) : selected.label) : placeholder}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <>
          <div className="combo-backdrop" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div className="combo-pop" role="presentation">
            <input ref={input} className="input combo-search" type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${uid}-o${active}` : undefined} aria-label={searchLabel || label} placeholder={searchLabel || label}
              value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} autoComplete="off" autoCapitalize="off" spellCheck={false} />
            <ul ref={list} id={listId} role="listbox" aria-label={label} className="combo-list">
              {shown.length === 0 && <li className="combo-empty" role="presentation">{emptyText}</li>}
              {shown.map((o, i) => (
                <li key={o.value} id={`${uid}-o${i}`} data-i={i} role="option" aria-selected={o.value === value} className={`combo-option ${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                  {o.render ? o.render(o) : o.label}
                  {o.value === value && <Icon name="check" size={16} className="combo-check" />}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
