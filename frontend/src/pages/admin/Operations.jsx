import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, KeyValue, PageHeader, Pagination, SkeletonCard, SkeletonRows } from '../../components/ui/Feedback.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Overlay.jsx';
import ReasonDialog from '../../components/ReasonDialog.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDebounced, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
import { dateTime, money, relativeTime, titleCase, uuid } from '../../lib/format.js';

// ───────── Withdrawals ─────────
const WSTATUS = ['requested', 'under_review', 'additional_verification_required', 'customer_support_required', 'approved', 'rejected', 'cancelled'];
const LIMIT = 20;

export function AdminWithdrawals() {
  useDocumentTitle('Withdrawal requests');
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const { data, loading, error, refetch } = useApi('/api/admin/withdrawals', { status, q: dq, limit: LIMIT, offset });
  return (
    <div className="stack">
      <PageHeader title="Withdrawal requests" subtitle="Requests are reviewed internally. No external bank transfer is ever performed by this system." />
      <Card>
        <form className="filters" role="search" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 0 }}>
          <Field label="Search customer or reference">{(p) => <Input {...p} type="search" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />}</Field>
          <Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}><option value="">All</option>{WSTATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
        </form>
      </Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Withdrawal requests" onRowClick={(w) => nav(`/admin/withdrawals/${w.id}`)} columns={[
            { key: 'reference', header: 'Reference', render: (w) => <span className="mono">{w.reference}</span> },
            { key: 'customer', header: 'Customer', render: (w) => <span>{w.customer.name}<br /><span className="muted small">{w.customer.email}</span></span> },
            { key: 'amount', header: 'Amount', className: 'num', render: (w) => money(w.amount, w.currency) },
            { key: 'status', header: 'Status', render: (w) => <Badge status={w.status} /> },
            { key: 'verification', header: 'Identity', render: (w) => <Badge status={w.customer.verificationStatus} /> },
            { key: 'createdAt', header: 'Requested', render: (w) => relativeTime(w.createdAt) },
          ]} empty={<EmptyState icon="upload" title="No withdrawal requests" />} />
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </Card>
      )}
    </div>
  );
}

const WACTIONS = {
  start_review: { label: 'Start review', perm: 'withdrawals.review' },
  request_verification: { label: 'Request additional verification', perm: 'withdrawals.review' },
  require_support: { label: 'Mark: customer support required', perm: 'withdrawals.review' },
  approve: { label: 'Approve (internal)', perm: 'withdrawals.decide', mfa: true, desc: 'Approval is an internal workflow state. No money is sent to any external account.' },
  reject: { label: 'Reject', perm: 'withdrawals.decide', tone: 'danger' },
};
const OPEN = ['requested', 'under_review', 'additional_verification_required', 'customer_support_required'];

export function AdminWithdrawalDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/admin/withdrawals/${id}`);
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  useDocumentTitle('Withdrawal request');
  if (loading) return <SkeletonCard lines={6} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const w = data.withdrawal;
  const act = WACTIONS[action];
  const run = async ({ reason, mfaCode }) => { await api.post(`/api/admin/withdrawals/${id}/actions`, { action, reason, ...(act.mfa ? { mfaCode } : {}) }); toast.success(`${act.label}: done.`); reload(); };
  const addNote = async (e) => { e.preventDefault(); setNoteBusy(true); try { await api.post(`/api/admin/withdrawals/${id}/notes`, { note }); setNote(''); reload(); } catch (ex) { toast.error(ex.message); } finally { setNoteBusy(false); } };
  return (
    <div className="stack">
      <PageHeader title={`Withdrawal ${w.reference}`} subtitle={<>{money(w.amount, w.currency)} · <Badge status={w.status} /></>} actions={<Button to="/admin/withdrawals" variant="secondary" icon="chevron-left">All requests</Button>} />
      <Alert tone="warning" title="No external transfer">{data.withdrawal.externalTransferNotice}</Alert>
      {OPEN.includes(w.status) && (
        <Card title="Actions" data-animate>
          <div className="row">{Object.entries(WACTIONS).filter(([k, a]) => can(a.perm) && !(k === 'start_review' && w.status === 'under_review')).map(([k, a]) => <Button key={k} size="sm" variant={k === 'approve' ? 'primary' : 'secondary'} onClick={() => setAction(k)}>{a.label}</Button>)}
            {!Object.values(WACTIONS).some((a) => can(a.perm)) && <span className="muted">Your role can read and add notes but cannot change this request.</span>}</div>
        </Card>
      )}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Request" data-animate><KeyValue items={[
          { label: 'Requested', value: dateTime(w.createdAt) }, { label: 'Destination bank', value: w.destination.bankName }, { label: 'Account holder', value: w.destination.accountName },
          { label: 'Account (last 4)', value: `••••${w.destination.last4}` }, { label: 'Customer note', value: w.note },
          ...(w.decision.at ? [{ label: 'Decided', value: dateTime(w.decision.at) }, { label: 'Decision reason', value: w.decision.reason }] : []),
        ]} /></Card>
        <Card title="Customer & account" data-animate><KeyValue items={[
          { label: 'Customer', value: <Link to={`/admin/customers/${w.customer.id}`}>{w.customer.name}</Link> }, { label: 'Email', value: w.customer.email },
          { label: 'Profile status', value: <Badge status={w.customer.status} /> }, { label: 'Identity', value: <Badge status={w.customer.verificationStatus} /> },
          { label: 'Account', value: <span className="mono">{w.account.number}</span> }, { label: 'Account status', value: <Badge status={w.account.status} /> },
          { label: 'Ledger balance', value: money(w.account.balances.ledger, w.currency) }, { label: 'Available', value: money(w.account.balances.available, w.currency) },
        ]} /></Card>
      </div>
      <Card title="Internal notes" subtitle="Visible to staff only." data-animate>
        {w.notes.length ? <ul>{w.notes.map((n) => <li key={n.id} className="kv-row"><span>{n.note}<br /><span className="muted small">{n.admin} · {dateTime(n.createdAt)}</span></span></li>)}</ul> : <p className="muted">No notes yet.</p>}
        {can('withdrawals.note') && <form onSubmit={addNote} style={{ marginTop: 12 }}><Field label="Add a note" required>{(p) => <Textarea {...p} style={{ minHeight: 70 }} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field><Button type="submit" size="sm" loading={noteBusy} disabled={note.trim().length < 3}>Add note</Button></form>}
      </Card>
      <Card title="Recent account activity" pad={false} className="card-flush" data-animate>
        <DataTable rows={w.history} caption="Account transactions" columns={[
          { key: 'created_at', header: 'Date', render: (t) => dateTime(t.created_at) }, { key: 'reference', header: 'Reference', render: (t) => <span className="mono">{t.reference}</span> },
          { key: 'type', header: 'Type', render: (t) => titleCase(t.type) }, { key: 'amount', header: 'Amount', className: 'num', render: (t) => money(t.amount, t.currency) }, { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
        ]} />
      </Card>
      <ReasonDialog open={!!action} onClose={() => setAction(null)} title={act?.label || ''} description={act?.desc} tone={act?.tone} requireMfa={!!act?.mfa}
        minReason={action === 'approve' || action === 'reject' ? 5 : 3} confirmLabel={act?.label || 'Confirm'} onSubmit={run} />
    </div>
  );
}

// ───────── Ledger ─────────
function CustomerPicker({ onPick }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading } = useApi('/api/admin/customers', { q: dq, limit: 6 }, { enabled: dq.length >= 2 });
  return (
    <div>
      <Field label="Find a customer" hint="Search by name, email or account number.">{(p) => <Input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      {dq.length >= 2 && (loading ? <p className="muted small" role="status">Searching…</p> : data?.items?.length ? (
        <ul>{data.items.map((c) => <li key={c.id}><button type="button" className="tx-row" onClick={() => onPick(c)}><span className="tx-main"><span className="tx-title" style={{ display: 'block' }}>{c.firstName} {c.lastName}</span><span className="tx-sub">{c.email}</span></span><Badge status={c.accountStatus} /></button></li>)}</ul>
      ) : <p className="muted small">No customers match.</p>)}
    </div>
  );
}

export function Ledger() {
  useDocumentTitle('Ledger');
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [customer, setCustomer] = useState(null);
  const [accountId, setAccountId] = useState(params.get('accountId') || '');
  const [f, setF] = useState({ direction: 'credit', amount: '', currency: 'USD', reason: '' });
  const [fe, setFe] = useState({});
  const [review, setReview] = useState(false);
  const [key, setKey] = useState(uuid());
  const [result, setResult] = useState(null);
  const [inspect, setInspect] = useState(params.get('inspect') || '');
  const detail = useApi(customer ? `/api/admin/customers/${customer.id}` : null, null, { enabled: !!customer });
  const byId = useApi(accountId && !customer ? `/api/ledger/accounts/${accountId}` : null, null, { enabled: !!accountId && !customer && can('ledger.read') });
  const insp = useApi(inspect ? `/api/ledger/accounts/${inspect}` : null, null, { enabled: !!inspect });
  const cfg = useAuth().config;
  const account = detail.data?.accounts?.find((a) => a.id === accountId) || (byId.data && { id: accountId, accountNumber: byId.data.account.accountNumber, currency: byId.data.account.currency, status: byId.data.account.status, name: byId.data.account.owner, balances: byId.data.balances });

  useEffect(() => { if (account?.currency) setF((x) => ({ ...x, currency: account.currency })); }, [account?.currency]);
  useEffect(() => { if (customer && detail.data) { const first = detail.data.accounts.find((a) => a.status === 'active') || detail.data.accounts[0]; if (first && !accountId) setAccountId(first.id); } }, [customer, detail.data]); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!accountId) e.accountId = 'Select an account.';
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(f.amount) || Number(f.amount) <= 0) e.amount = 'Enter an amount greater than zero with at most two decimals.';
    if (f.reason.trim().length < 10) e.reason = 'A reason of at least 10 characters is required.';
    return e;
  };
  const toReview = (e) => { e.preventDefault(); const v = validate(); setFe(v); if (!Object.keys(v).length) setReview(true); };
  const submit = async ({ mfaCode }) => {
    try {
      const r = await api.post('/api/ledger/adjustments', { accountId, direction: f.direction, amount: f.amount, currency: f.currency, reason: f.reason.trim(), mfaCode, idempotencyKey: key });
      setResult(r); toast.success(`Ledger ${f.direction} posted.`); setKey(uuid());
    } catch (ex) { setFe(fieldErrors(ex)); throw ex; }
  };

  if (!can('ledger.adjust') && !can('ledger.read')) return <Alert tone="warning">You don’t have access to ledger operations.</Alert>;
  return (
    <div className="stack">
      <PageHeader title="Ledger" subtitle="Ledger entries are immutable. Adjustments append new, audited entries — balances are never edited." />
      {can('ledger.adjust') && (
        <Card title="Create a ledger adjustment" subtitle="Internal test-ledger funding. This does not create a bank deposit." data-animate>
          {result ? (
            <div className="stack">
              <Alert tone="success" title="Adjustment posted">Reference <span className="mono">{result.reference}</span></Alert>
              <KeyValue items={[{ label: 'Balance before', value: money(result.balanceBefore, f.currency) }, { label: 'Balance after', value: money(result.balanceAfter, f.currency) }]} />
              <div className="row"><Button onClick={() => { setResult(null); setF({ ...f, amount: '', reason: '' }); }}>Create another</Button></div>
            </div>
          ) : (
            <form onSubmit={toReview} noValidate>
              {!customer && !accountId ? <CustomerPicker onPick={(c) => { setCustomer(c); setAccountId(''); }} /> : (
                <>
                  <div className="row-between" style={{ marginBottom: 12 }}>
                    <div><strong>{customer ? `${customer.firstName} ${customer.lastName}` : account?.name}</strong><div className="muted small">{customer?.email}</div></div>
                    <Button size="sm" variant="ghost" onClick={() => { setCustomer(null); setAccountId(''); }}>Change customer</Button>
                  </div>
                  {detail.data && <Field label="Account" error={fe.accountId} required>{(p) => <Select {...p} value={accountId} onChange={(e) => setAccountId(e.target.value)}>{detail.data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} {a.accountNumber} — {titleCase(a.status)} — {money(a.balances.ledger, a.currency)}</option>)}</Select>}</Field>}
                  {account && account.status !== 'active' && <Alert tone="warning">This account is {titleCase(account.status)}; adjustments require an active account.</Alert>}
                  <div className="form-grid">
                    <Field label="Type" required>{(p) => <Select {...p} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="credit">Ledger credit</option><option value="debit">Debit adjustment</option></Select>}</Field>
                    <Field label="Currency" error={fe.currency} required>{(p) => <Select {...p} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{(cfg?.currencies || ['USD']).map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
                    <Field label="Amount" error={fe.amount} required className="span-2">{(p) => <Input {...p} inputMode="decimal" placeholder="0.00" autoComplete="off" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
                    <Field label="Reason (required, stored in the audit log)" error={fe.reason} required className="span-2">{(p) => <Textarea {...p} style={{ minHeight: 80 }} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
                  </div>
                  <Button type="submit" disabled={!account || account.status !== 'active'}>Review adjustment</Button>
                </>
              )}
            </form>
          )}
        </Card>
      )}
      <ReasonDialog open={review} onClose={() => setReview(false)} title="Confirm ledger adjustment" requireMfa askReason={false} confirmLabel={`Post ${f.direction}`}
        description="Review the details, then confirm with an authenticator code. This creates immutable ledger entries and notifies the customer."
        onSubmit={submit}>
        <KeyValue items={[{ label: 'Account', value: <span className="mono">{account?.accountNumber}</span> }, { label: 'Type', value: titleCase(f.direction) }, { label: 'Amount', value: f.amount && money(Math.round(parseFloat(f.amount) * 100), f.currency) }, { label: 'Current ledger balance', value: account?.balances && money(account.balances.ledger, f.currency) }]} />
      </ReasonDialog>
      <ReversePanel />
      {can('ledger.read') && (
        <Card title="Inspect an account ledger" data-animate>
          <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); setInspect(e.currentTarget.elements.acct.value.trim()); }}>
            <Field label="Account ID" className="grow"><Input name="acct" defaultValue={inspect} placeholder="Paste an account id (from a customer page)" /></Field>
            <Button type="submit" variant="secondary" style={{ marginBottom: 16 }}>Inspect</Button>
          </form>
          {insp.loading && <p className="muted">Loading…</p>}
          {insp.error && <Alert tone="danger">{insp.error.message}</Alert>}
          {insp.data && (<>
            <KeyValue items={[{ label: 'Account', value: <span className="mono">{insp.data.account.accountNumber}</span> }, { label: 'Owner', value: insp.data.account.owner || 'System account' }, { label: 'Status', value: <Badge status={insp.data.account.status} /> },
              { label: 'Ledger balance', value: money(insp.data.balances.ledger, insp.data.account.currency) }, { label: 'Integrity check', value: insp.data.integrity.ok ? <Badge tone="success">Entries reconcile ({insp.data.integrity.entries})</Badge> : <Badge tone="danger">{insp.data.integrity.reason}</Badge> }]} />
            <DataTable rows={insp.data.transactions} caption="Account transactions" columns={[
              { key: 'createdAt', header: 'Date', render: (t) => dateTime(t.createdAt) }, { key: 'reference', header: 'Reference', render: (t) => <span className="mono">{t.reference}</span> }, { key: 'type', header: 'Type', render: (t) => titleCase(t.type) },
              { key: 'amount', header: 'Amount', className: 'num', render: (t) => `${t.direction === 'credit' ? '+' : t.direction === 'debit' && t.hasLedgerEntries ? '−' : ''}${money(t.amount, t.currency)}` }, { key: 'balanceAfter', header: 'Balance after', className: 'num', render: (t) => (t.balanceAfter != null ? money(t.balanceAfter, t.currency) : '—') },
              { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
              { key: 'id', header: 'ID', render: (t) => <span className="mono small">{t.id.slice(0, 8)}</span> },
            ]} />
          </>)}
        </Card>
      )}
    </div>
  );
}

function ReversePanel() {
  const { can } = useAuth();
  const toast = useToast();
  const [txId, setTxId] = useState('');
  const [open, setOpen] = useState(false);
  if (!can('ledger.reverse')) return null;
  const run = async ({ reason, mfaCode }) => { const r = await api.post('/api/ledger/reversals', { transactionId: txId.trim(), reason, mfaCode }); toast.success(`Reversed ${r.originalReference} (${r.reversalReference}).`); setTxId(''); };
  return (
    <Card title="Reverse a transaction" subtitle="Appends compensating entries and marks the original as reversed. History is preserved." data-animate>
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); setOpen(true); }}>
        <Field label="Transaction ID" className="grow">{(p) => <Input {...p} placeholder="Transaction UUID (from the ledger inspector)" value={txId} onChange={(e) => setTxId(e.target.value)} />}</Field>
        <Button type="submit" variant="secondary" disabled={txId.trim().length < 30} style={{ marginBottom: 16 }}>Reverse…</Button>
      </form>
      <ReasonDialog open={open} onClose={() => setOpen(false)} title="Reverse transaction" tone="danger" requireMfa minReason={10} confirmLabel="Reverse transaction" onSubmit={run} description="The customer will be notified. Reversal is refused if it would overdraw an account." />
    </Card>
  );
}
