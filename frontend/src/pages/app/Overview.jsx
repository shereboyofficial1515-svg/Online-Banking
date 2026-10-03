import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonCard, SkeletonRows, Pagination } from '../../components/ui/Feedback.jsx';
import { BalanceChart, InOutChart } from '../../components/ui/Charts.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { Modal } from '../../components/ui/Overlay.jsx';
import { Field, Select, Input } from '../../components/ui/Controls.jsx';
import TransactionRow from '../../components/TransactionRow.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
import { money, dateTime, mask, titleCase } from '../../lib/format.js';
import { useAuth } from '../../lib/auth.jsx';

function AccountStatusNotice({ account, verification }) {
  if (!account) return null;
  if (account.status === 'pending_review') return <Alert tone="info" title="Your account is pending review">Our team is reviewing your application. You’ll receive an email as soon as it’s approved. Transfers and withdrawal requests unlock after approval.</Alert>;
  if (['suspended', 'locked'].includes(account.status)) return <Alert tone="warning" title={`Your account is ${account.status}`}>Some actions are unavailable. Please <Link to="/app/support">contact customer support</Link> for help.</Alert>;
  if (account.status === 'closed') return <Alert tone="danger" title="This account is closed">Please contact customer support.</Alert>;
  if (verification && verification.status !== 'verified') return <Alert tone="warning" title="Verify your identity to unlock transfers" action={<Button size="sm" to="/app/verification">Verify now</Button>}>Identity verification is required before you can make transfers or have withdrawal requests reviewed.</Alert>;
  return null;
}

function Balance({ account }) {
  return (
    <section className="balance-card" data-animate aria-labelledby="bal-h">
      <div className="row-between"><h2 id="bal-h">Available balance</h2><Badge status={account.status} /></div>
      <div className="balance-amount">{money(account.availableBalance, account.currency)}</div>
      <div className="small" style={{ color: '#AFC0D8' }}>{account.name} · <span className="mono">{account.accountNumber}</span></div>
      <div className="balance-meta">
        <div><span className="label">Ledger balance</span><strong>{money(account.ledgerBalance, account.currency)}</strong></div>
        {account.heldAmount > 0 && <div><span className="label">Held for open requests</span><strong>{money(account.heldAmount, account.currency)}</strong></div>}
        <div><span className="label">Currency</span><strong>{account.currency}</strong></div>
      </div>
    </section>
  );
}

export default function Overview() {
  useDocumentTitle('Overview');
  const { user } = useAuth();
  const accounts = useApi('/api/accounts');
  const primary = accounts.data?.accounts?.[0];
  const summary = useApi(primary ? `/api/accounts/${primary.id}/summary` : null, null, { enabled: !!primary });
  const txs = useApi('/api/transactions', { limit: 6 });
  const verification = useApi('/api/verification/status');
  const sec = useApi('/api/security/overview');

  if (accounts.loading) return <div className="stack"><SkeletonCard lines={2} /><SkeletonCard /><SkeletonRows /></div>;
  if (accounts.error) return <ErrorState error={accounts.error} onRetry={accounts.refetch} />;
  const s = sec.data;
  const checks = [
    { ok: !!user.emailVerified, label: 'Email verified', to: null },
    { ok: verification.data?.status === 'verified', label: 'Identity verified', to: '/app/verification' },
    { ok: !!s?.mfa.enabled, label: 'Multi-factor authentication', to: '/app/security' },
    { ok: (s?.passkeys.length ?? 0) > 0, label: 'Passkey registered', to: '/app/security' },
  ];
  return (
    <div className="stack">
      <PageHeader title={`Hello, ${user.firstName}`} subtitle="Here’s a summary of your accounts and security." actions={<><Button to="/app/transfers" icon="swap" size="md">Transfer</Button><Button to="/app/withdrawals" variant="secondary" icon="upload">Request withdrawal</Button></>} />
      <AccountStatusNotice account={primary} verification={verification.data} />
      {primary && <Balance account={primary} />}
      <div className="grid grid-2">
        <Card title="Balance history" subtitle="Running balance from ledger entries" data-animate>
          {summary.loading ? <SkeletonCard lines={2} /> : summary.data?.history?.length ? <BalanceChart history={summary.data.history} currency={primary.currency} /> : <EmptyState icon="chart" title="No activity yet">Your balance history appears here once ledger entries are posted.</EmptyState>}
        </Card>
        <Card title="Money in and out" subtitle="Last six months" data-animate>
          {summary.loading ? <SkeletonCard lines={2} /> : summary.data?.monthly?.length ? <InOutChart monthly={summary.data.monthly} currency={primary.currency} /> : <EmptyState icon="chart" title="Nothing to show yet">Monthly totals appear after your first transaction.</EmptyState>}
        </Card>
      </div>
      <div className="grid grid-2">
        <Card title="Recent transactions" action={<Link to="/app/transactions" className="small">View all</Link>} data-animate>
          {txs.loading ? <SkeletonRows rows={4} /> : txs.data?.items?.length ? <ul className="tx-list">{txs.data.items.map((t) => <TransactionRow key={t.id} tx={t} />)}</ul> : <EmptyState icon="list" title="No transactions yet">Transactions are created from real ledger activity and will appear here.</EmptyState>}
        </Card>
        <Card title="Security status" subtitle="Strengthen your protection" action={<Link to="/app/security" className="small">Manage</Link>} data-animate>
          <ul className="checklist">
            {checks.map((c) => (
              <li key={c.label}><Icon name={c.ok ? 'check-circle' : 'alert'} className={c.ok ? 'check-ok' : 'check-todo'} /><span className="grow">{c.label}</span>{c.ok ? <Badge tone="success">Done</Badge> : c.to ? <Button size="sm" variant="secondary" to={c.to}>Set up</Button> : <Badge tone="warning">Pending</Badge>}</li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 12 }}>Account ID {primary ? mask(primary.accountNumber) : '—'} · Member since {primary ? dateTime(primary.createdAt).split(',')[0] : '—'}</p>
        </Card>
      </div>
    </div>
  );
}

export function Accounts() {
  useDocumentTitle('Accounts');
  const toast = useToast();
  const { data, loading, error, refetch } = useApi('/api/accounts');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'savings', name: '' });
  const [busy, setBusy] = useState(false);
  const [fe, setFe] = useState({});
  const create = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    try { await api.post('/api/accounts', { type: form.type, ...(form.name ? { name: form.name } : {}) }); toast.success('Account opened.'); setOpen(false); refetch(); }
    catch (ex) { setFe(fieldErrors(ex)); toast.error(ex.message); } finally { setBusy(false); }
  };
  if (loading) return <div className="stack"><SkeletonCard /><SkeletonCard /></div>;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div className="stack">
      <PageHeader title="Accounts" subtitle="Your EWB accounts and their balances." actions={<Button icon="plus" variant="secondary" onClick={() => setOpen(true)}>Open another account</Button>} />
      <div className="grid grid-2">
        {data.accounts.map((a) => (
          <Card key={a.id} data-animate>
            <div className="acct-card">
              <span className="acct-chip"><Icon name={a.type === 'savings' ? 'bank' : 'wallet'} /></span>
              <div className="grow"><h2>{a.name}</h2><span className="muted small">{titleCase(a.type)} · {a.currency}</span></div>
              <Badge status={a.status} />
            </div>
            <div className="balance-amount" style={{ color: 'var(--navy-900)', fontSize: '2rem' }}>{money(a.availableBalance, a.currency)}</div>
            <dl className="kv">
              <div className="kv-row"><dt>Account number</dt><dd className="mono">{a.accountNumber}</dd></div>
              <div className="kv-row"><dt>Ledger balance</dt><dd>{money(a.ledgerBalance, a.currency)}</dd></div>
              <div className="kv-row"><dt>Held for open requests</dt><dd>{money(a.heldAmount, a.currency)}</dd></div>
              <div className="kv-row"><dt>Opened</dt><dd>{dateTime(a.createdAt).split(',')[0]}</dd></div>
            </dl>
            <div className="row" style={{ marginTop: 12 }}><Button size="sm" variant="secondary" to={`/app/transactions?accountId=${a.id}`}>View transactions</Button></div>
          </Card>
        ))}
      </div>
      <p className="muted small">Balances are internal ledger records, calculated from immutable ledger entries. They are not bank deposits.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Open another account" size="sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} type="submit" form="open-acct">Open account</Button></>}>
        <form id="open-acct" onSubmit={create}>
          <Field label="Account type" error={fe.type}>{(p) => <Select {...p} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="savings">Savings</option><option value="checking">Checking</option></Select>}</Field>
          <Field label="Nickname (optional)" error={fe.name}>{(p) => <Input {...p} maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <p className="muted small">New accounts are created with a zero balance. You can hold up to three open accounts.</p>
        </form>
      </Modal>
    </div>
  );
}
