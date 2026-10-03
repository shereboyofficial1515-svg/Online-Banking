import Icon from './Icon.jsx';
import { titleCase } from '../../lib/format.js';

const TONES = {
  completed: 'success', verified: 'success', active: 'success', approved: 'success', resolved: 'success', sent: 'success',
  pending: 'warning', requested: 'warning', under_review: 'info', manual_review: 'info', in_progress: 'info', open: 'info', pending_review: 'warning',
  additional_verification_required: 'warning', customer_support_required: 'warning', waiting_for_customer: 'warning', verification_required: 'warning', blocked: 'warning',
  failed: 'danger', rejected: 'danger', locked: 'danger', suspended: 'warning', expired: 'neutral', cancelled: 'neutral', closed: 'neutral', reversed: 'neutral', not_started: 'neutral',
  high: 'danger', medium: 'warning', low: 'info', info: 'neutral', investigating: 'info', dismissed: 'neutral',
};
const LABELS = { under_review: 'Under review', pending_review: 'Pending review', additional_verification_required: 'Verification required', customer_support_required: 'Support required', approved: 'Approved (internal)' };

export function Badge({ status, tone, children }) {
  const t = tone || TONES[status] || 'neutral';
  return <span className={`badge badge-${t}`}>{children ?? LABELS[status] ?? titleCase(status)}</span>;
}

export function Skeleton({ h = 16, w = '100%', r = 8, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}
export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card" role="status" aria-label="Loading content">
      <Skeleton h={14} w="40%" />
      <div style={{ height: 14 }} />
      {Array.from({ length: lines }, (_, i) => <div key={i} style={{ marginBottom: 10 }}><Skeleton h={14} w={`${90 - i * 12}%`} /></div>)}
    </div>
  );
}
export function SkeletonRows({ rows = 5 }) {
  return (
    <div className="card" role="status" aria-label="Loading list">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row"><Skeleton h={38} w={38} r={19} /><div style={{ flex: 1 }}><Skeleton h={13} w="55%" /><div style={{ height: 8 }} /><Skeleton h={11} w="30%" /></div><Skeleton h={14} w={70} /></div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'file', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, icon, action }) {
  const ic = icon || { info: 'info', warning: 'alert', danger: 'alert', success: 'check' }[tone];
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={ic} size={20} />
      <div className="alert-body">{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty">
      <div className="empty-icon danger"><Icon name="alert" size={26} /></div>
      <h3>We couldn’t load this</h3>
      <p>{error?.message || 'Something went wrong. Please try again.'}</p>
      {error?.requestId && <p className="muted small">Reference: {error.requestId}</p>}
      {onRetry && <button type="button" className="btn btn-secondary btn-md" onClick={onRetry}><Icon name="refresh" size={16} /><span>Try again</span></button>}
    </div>
  );
}

export function Card({ title, subtitle, action, children, className = '', pad = true, ...rest }) {
  return (
    <section className={`card ${pad ? '' : 'card-flush'} ${className}`} {...rest}>
      {(title || action) && (
        <header className="card-head">
          <div>{title && <h2 className="card-title">{title}</h2>}{subtitle && <p className="muted small">{subtitle}</p>}</div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head" data-animate>
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`} data-animate>
      {icon && <span className="stat-icon"><Icon name={icon} size={18} /></span>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Pagination({ total, limit, offset, onChange }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(offset - limit)}><Icon name="chevron-left" size={16} /> Previous</button>
      <span className="muted small" aria-live="polite">Page {page} of {pages}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Next <Icon name="chevron-right" size={16} /></button>
    </nav>
  );
}

export function KeyValue({ items }) {
  return (
    <dl className="kv">
      {items.filter((i) => i && i.value !== undefined).map((i) => (<div key={i.label} className="kv-row"><dt>{i.label}</dt><dd>{i.value ?? '—'}</dd></div>))}
    </dl>
  );
}
