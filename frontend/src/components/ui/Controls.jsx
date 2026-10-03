import { cloneElement, forwardRef, isValidElement, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

/** variant: primary | secondary | ghost | danger ; renders a router Link when `to` is given. */
export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', loading = false, icon, to, href, children, className = '', disabled, type = 'button', ...rest }, ref) {
  const cls = `btn btn-${variant} btn-${size} ${className}`;
  const inner = (<>{loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}<span>{children}</span></>);
  if (to) return <Link ref={ref} to={to} className={cls} {...rest}>{inner}</Link>;
  if (href) return <a ref={ref} href={href} className={cls} {...rest}>{inner}</a>;
  return <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>{inner}</button>;
});

/** Accessible form row: label, control, hint and error are wired together with ids/aria attributes. */
export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  const aria = { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined };
  // Accepts either a render function or a single control element; both end up with label/hint/error wiring.
  const control = typeof children === 'function' ? children(aria) : isValidElement(children) ? cloneElement(children, aria) : children;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {control}
      {hint && !error && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-err`} role="alert"><Icon name="alert" size={14} /> {error}</p>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`input ${className}`} {...rest} />;
});
export function Select({ className = '', children, ...rest }) {
  return <select className={`input select ${className}`} {...rest}>{children}</select>;
}
export function Textarea({ className = '', ...rest }) {
  return <textarea className={`input textarea ${className}`} {...rest} />;
}

export function PasswordInput({ id, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete="current-password" {...rest} />
      <button type="button" className="input-addon" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        <Icon name={show ? 'eye-off' : 'eye'} size={18} />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, describedBy }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-describedby={describedBy} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
    if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
