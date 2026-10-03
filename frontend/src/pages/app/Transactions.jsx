import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Field, Input, Select, Button } from '../../components/ui/Controls.jsx';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, SkeletonCard, SkeletonRows, KeyValue } from '../../components/ui/Feedback.jsx';
import TransactionRow, { TYPE_LABEL, signedAmount } from '../../components/TransactionRow.jsx';
import { useApi, useDebounced, useDocumentTitle } from '../../lib/hooks.js';
import { dateTime, money, titleCase } from '../../lib/format.js';

const LIMIT = 15;

export function Transactions() {
  useDocumentTitle('Transactions');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const filters = { q: dq, type: params.get('type') || '', status: params.get('status') || '', from: params.get('from') || '', to: params.get('to') || '', accountId: params.get('accountId') || '' };
  const accounts = useApi('/api/accounts');
  const { data, loading, error, refetch } = useApi('/api/transactions', { ...filters, limit: LIMIT, offset });
  const setF = (k) => (e) => { const p = new URLSearchParams(params); if (e.target.value) p.set(k, e.target.value); else p.delete(k); setParams(p, { replace: true }); setOffset(0); };
  const active = Object.values(filters).some(Boolean);
  const clear = () => { setQ(''); setParams({}, { replace: true }); setOffset(0); };

  return (
    <div className="stack">
      <PageHeader title="Transactions" subtitle="Every entry here comes from your account’s ledger and request history." />
      <Card>
        <form className="filters f5" role="search" aria-label="Filter transactions" onSubmit={(e) => e.preventDefault()}>
          <Field label="Search">{(p) => <Input {...p} type="search" placeholder="Reference or description" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />}</Field>
          <Field label="Type">{(p) => <Select {...p} value={filters.type} onChange={setF('type')}><option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Status">{(p) => <Select {...p} value={filters.status} onChange={setF('status')}><option value="">All statuses</option>{['completed', 'pending', 'blocked', 'failed', 'reversed', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={filters.from} onChange={setF('from')} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={filters.to} onChange={setF('to')} />}</Field>
        </form>
        {accounts.data?.accounts?.length > 1 && (
          <Field label="Account">{(p) => <Select {...p} value={filters.accountId} onChange={setF('accountId')}><option value="">All accounts</option>{accounts.data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.accountNumber.slice(-4)})</option>)}</Select>}</Field>
        )}
        {active && <Button size="sm" variant="ghost" onClick={clear} icon="x">Clear filters</Button>}
      </Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          {data.items.length ? (
            <div style={{ padding: '4px 16px' }}><ul className="tx-list" aria-label="Transactions">{data.items.map((t) => <TransactionRow key={t.id} tx={t} />)}</ul></div>
          ) : <EmptyState icon="list" title={active ? 'No matching transactions' : 'No transactions yet'}>{active ? 'Try changing or clearing your filters.' : 'When transfers, ledger entries or withdrawal requests are recorded on your account, they appear here.'}</EmptyState>}
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </Card>
      )}
    </div>
  );
}

export function TransactionDetail() {
  const { id } = useParams();
  const { data, loading, error, refetch } = useApi(`/api/transactions/${id}`);
  useDocumentTitle('Transaction details');
  if (loading) return <SkeletonCard lines={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const t = data.transaction;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHeader title="Transaction details" actions={<Button to="/app/transactions" variant="secondary" icon="chevron-left">Back</Button>} />
      <Card>
        <div className="row-between"><div><div className="muted small">{TYPE_LABEL[t.type] || titleCase(t.type)}</div><div className={`balance-amount ${t.direction === 'credit' ? 'credit' : ''}`} style={{ color: t.direction === 'credit' ? 'var(--success)' : 'var(--navy-900)', fontSize: '2rem' }}>{signedAmount(t)}</div></div><Badge status={t.status} /></div>
        {t.note && <p className="notice" style={{ marginTop: 12 }}>{t.note}</p>}
        <KeyValue items={[
          { label: 'Reference', value: <span className="mono">{t.reference}</span> },
          { label: 'Description', value: t.description },
          { label: 'Date', value: dateTime(t.createdAt) },
          { label: 'Completed', value: t.completedAt ? dateTime(t.completedAt) : '—' },
          { label: 'Counterparty account', value: t.counterparty ? <span className="mono">{t.counterparty}</span> : undefined },
          { label: 'Balance after', value: t.balanceAfter != null ? money(t.balanceAfter, t.currency) : undefined },
        ]} />
      </Card>
      {t.entries.length > 0 && (
        <Card title="Ledger entries" subtitle="Immutable records posted to your account">
          <ul>{t.entries.map((e) => (<li key={e.id} className="kv-row"><span>{titleCase(e.entryType)}<br /><span className="muted small">{dateTime(e.createdAt)}</span></span><span style={{ textAlign: 'right' }}><strong className={e.direction === 'credit' ? 'credit' : ''}>{e.direction === 'credit' ? '+' : '−'}{money(e.amount, e.currency)}</strong><br /><span className="muted small">Balance {money(e.balanceAfter, e.currency)}</span></span></li>))}</ul>
        </Card>
      )}
      <p className="muted small">Need help with this transaction? <Link to="/app/support">Contact customer support</Link> and quote the reference.</p>
    </div>
  );
}
