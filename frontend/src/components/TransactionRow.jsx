import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './ui/Icon.jsx';
import { Badge } from './ui/Feedback.jsx';
import { api } from '../lib/api.js';
import { money, dateTime, titleCase } from '../lib/format.js';
import { expandCollapse } from '../lib/motion.js';

export const TYPE_LABEL = { ledger_credit: 'Credit', ledger_debit: 'Debit adjustment', transfer: 'Transfer', withdrawal: 'Withdrawal request', reversal: 'Reversal' };
const ICON = { ledger_credit: 'download', ledger_debit: 'upload', transfer: 'swap', withdrawal: 'upload', reversal: 'refresh' };

export function signedAmount(t) {
  if (t.direction === 'credit') return `+${money(t.amount, t.currency)}`;
  if (t.direction === 'debit' && t.hasLedgerEntries) return `−${money(t.amount, t.currency)}`;
  return money(t.amount, t.currency);
}

/** One transaction. Clicking expands a detail panel (animated with GSAP, instant under reduced motion). */
export default function TransactionRow({ tx }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const panel = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    expandCollapse(panel.current, open);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try { setDetail((await api.get(`/api/transactions/${tx.id}`)).transaction); } catch (e) { setError(e); }
    }
  };
  const incoming = tx.direction === 'credit';
  return (
    <li>
      <button type="button" className="tx-row" onClick={toggle} aria-expanded={open} aria-controls={`tx-${tx.id}`}>
        <span className={`tx-icon ${incoming ? 'in' : ''}`}><Icon name={ICON[tx.type] || 'list'} size={20} /></span>
        <span className="tx-main">
          <span className="tx-title" style={{ display: 'block' }}>{tx.description || TYPE_LABEL[tx.type]}</span>
          <span className="tx-sub">{dateTime(tx.createdAt)} · <span className="mono">{tx.reference}</span></span>
        </span>
        <span className="tx-amount"><span className={`amount ${incoming ? 'credit' : ''}`} style={{ display: 'block' }}>{signedAmount(tx)}</span><Badge status={tx.status} /></span>
        <Icon name="chevron-down" size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--muted)' }} />
      </button>
      <div id={`tx-${tx.id}`} ref={panel} className="tx-detail" role="region" aria-label={`Details for ${tx.reference}`} hidden={!open && !detail ? true : undefined} style={open ? { height: 'auto', opacity: 1 } : undefined}>
        <div className="tx-detail-inner">
          {error && <p className="muted">Couldn’t load details. {error.message}</p>}
          {!detail && !error && open && <p className="muted" role="status">Loading details…</p>}
          {detail && (
            <dl className="kv">
              <div className="kv-row"><dt>Type</dt><dd>{TYPE_LABEL[detail.type] || titleCase(detail.type)}</dd></div>
              <div className="kv-row"><dt>Reference</dt><dd className="mono">{detail.reference}</dd></div>
              <div className="kv-row"><dt>Status</dt><dd><Badge status={detail.status} /></dd></div>
              {detail.counterparty && <div className="kv-row"><dt>Counterparty account</dt><dd className="mono">{detail.counterparty}</dd></div>}
              {detail.balanceAfter != null && <div className="kv-row"><dt>Balance after</dt><dd>{money(detail.balanceAfter, detail.currency)}</dd></div>}
              {detail.completedAt && <div className="kv-row"><dt>Completed</dt><dd>{dateTime(detail.completedAt)}</dd></div>}
              {detail.note && <div className="kv-row"><dt>Note</dt><dd>{detail.note}</dd></div>}
            </dl>
          )}
          {detail && <p style={{ marginTop: 10 }}><Link to={`/app/transactions/${tx.id}`} className="small">Open full details</Link></p>}
        </div>
      </div>
    </li>
  );
}
