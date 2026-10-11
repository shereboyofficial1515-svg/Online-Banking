import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Field, Input, Select } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, KeyValue, PageHeader, Pagination, SkeletonCard, SkeletonRows, Stat } from '../../components/ui/Feedback.jsx';
import { Sparkbars } from '../../components/ui/Charts.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import ReasonDialog from '../../components/ReasonDialog.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDebounced, useDocumentTitle } from '../../lib/hooks.js';
import { api } from '../../lib/api.js';
import { dateTime, money, relativeTime, titleCase } from '../../lib/format.js';

export function AdminDashboard() {
  useDocumentTitle('Dashboard');
  const { data, loading, error, refetch } = useApi('/api/admin/dashboard');
  if (loading) return <div className="stack"><SkeletonCard /><SkeletonCard /></div>;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const d = data;
  return (
    <div className="stack">
      <PageHeader title="Dashboard" subtitle="Platform overview" />
      <div className="grid grid-4">
        <Stat label="Registered customers" value={d.users.total} icon="users" />
        <Stat label="Verified" value={d.users.verified} hint={`${d.users.pendingVerification} pending verification`} icon="shield-check" />
        <Stat label="Active accounts" value={d.accounts.active} hint={`${d.accounts.pendingReview} awaiting approval`} icon="wallet" tone={d.accounts.pendingReview ? 'warning' : undefined} />
        <Stat label="Suspended / locked" value={d.accounts.suspended} icon="lock" tone={d.accounts.suspended ? 'danger' : undefined} />
        <Stat label="Pending withdrawals" value={d.withdrawals.pending} icon="upload" tone={d.withdrawals.pending ? 'warning' : undefined} />
        <Stat label="Open security alerts" value={d.security.openAlerts} hint="Medium and high severity" icon="shield" tone={d.security.openAlerts ? 'danger' : undefined} />
        <Stat label="Ledger activity (24h)" value={d.ledger.transactions24h} hint={`${money(d.ledger.volume24h)} completed volume`} icon="chart" />
        <Stat label="Open support requests" value={d.support.openTickets} icon="lifebuoy" />
      </div>
      <div className="grid grid-2">
        <Card title="Ledger activity" subtitle="Completed transactions per day, last 14 days" data-animate>
          {d.ledger.daily.length ? <Sparkbars values={d.ledger.daily.map((x) => x.n)} label={`Daily completed transactions: ${d.ledger.daily.map((x) => `${x.day}: ${x.n}`).join(', ')}`} /> : <EmptyState icon="chart" title="No ledger activity yet" />}
        </Card>
        <Card title="Recent administrative actions" action={<Link to="/admin/audit" className="small">Audit log</Link>} data-animate>
          {d.recentActions.length ? <ul>{d.recentActions.map((a) => <li key={a.id} className="kv-row"><span><strong className="mono small">{a.action}</strong><br /><span className="muted small">{a.actor} · {relativeTime(a.at)}</span></span></li>)}</ul> : <EmptyState icon="clipboard" title="No actions yet" />}
        </Card>
      </div>
    </div>
  );
}

const LIMIT = 20;

export function Customers() {
  useDocumentTitle('Customers');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [verification, setVerification] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const { data, loading, error, refetch } = useApi('/api/admin/customers', { q: dq, status, verification, limit: LIMIT, offset });
  return (
    <div className="stack">
      <PageHeader title="Customers" subtitle="Search and manage customer profiles." />
      <Card>
        <form className="filters" role="search" aria-label="Search customers" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 0, gridTemplateColumns: undefined }}>
          <Field label="Search">{(p) => <Input {...p} type="search" placeholder="Name, email, username or account number" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />}</Field>
          <Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}><option value="">All</option>{['active', 'suspended', 'locked', 'rejected'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
          <Field label="Verification">{(p) => <Select {...p} value={verification} onChange={(e) => { setVerification(e.target.value); setOffset(0); }}><option value="">All</option>{['not_started', 'pending', 'verification_required', 'manual_review', 'verified', 'failed', 'expired'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
        </form>
      </Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Customers" onRowClick={(c) => nav(`/admin/customers/${c.id}`)} columns={[
            { key: 'name', header: 'Customer', render: (c) => <span><strong>{c.firstName} {c.lastName}</strong><br /><span className="muted small">{c.email}</span></span> },
            { key: 'status', header: 'Profile', render: (c) => <Badge status={c.status} /> },
            { key: 'accountStatus', header: 'Account', render: (c) => <Badge status={c.accountStatus} /> },
            { key: 'verificationStatus', header: 'Verification', render: (c) => <Badge status={c.verificationStatus} /> },
            { key: 'createdAt', header: 'Registered', render: (c) => dateTime(c.createdAt).split(',')[0] },
          ]} empty={<EmptyState icon="users" title="No customers found">Try a different search or filter.</EmptyState>} />
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </Card>
      )}
    </div>
  );
}

const ACTIONS = {
  approve_account: { label: 'Approve account', perm: 'accounts.review', tone: 'primary', show: (d) => d.accounts.some((a) => a.status === 'pending_review') && d.profile.status === 'active' },
  reject_account: { label: 'Reject application', perm: 'accounts.review', tone: 'danger', show: (d) => d.accounts.some((a) => a.status === 'pending_review') },
  suspend: { label: 'Suspend', perm: 'customers.status', tone: 'danger', show: (d) => d.profile.status === 'active' },
  lock: { label: 'Lock', perm: 'customers.status', tone: 'danger', show: (d) => ['active', 'suspended'].includes(d.profile.status) },
  reactivate: { label: 'Reactivate', perm: 'customers.status', tone: 'primary', show: (d) => ['suspended', 'locked'].includes(d.profile.status) },
  reset_sessions: { label: 'Reset sessions', perm: 'sessions.reset', tone: 'primary', show: () => true },
};

export function CustomerDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/admin/customers/${id}`);
  const [action, setAction] = useState(null);
  const [reviewFor, setReviewFor] = useState(null);
  useDocumentTitle('Customer');
  if (loading) return <div className="stack"><SkeletonCard /><SkeletonCard /></div>;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const d = data;
  const p = d.profile;
  const run = async ({ reason }) => { await api.post(`/api/admin/customers/${id}/actions`, { action, reason }); toast.success(`${ACTIONS[action].label}: done.`); reload(); };
  const runReview = async ({ reason }) => { await api.post(`/api/admin/accounts/${reviewFor.id}/security-review`, { enabled: !reviewFor.securityReview, reason }); toast.success(reviewFor.securityReview ? 'Security review cleared.' : 'Account placed under security review.'); reload(); };
  return (
    <div className="stack">
      <PageHeader title={`${p.firstName} ${p.lastName}`} subtitle={<>{p.email} · <Badge status={p.status} /> <Badge status={p.verificationStatus} /></>}
        actions={<Button to="/admin/customers" variant="secondary" icon="chevron-left">All customers</Button>} />
      <Card title="Actions" subtitle="Every action requires a reason and is recorded in the audit log." data-animate>
        <div className="row">
          {Object.entries(ACTIONS).filter(([, a]) => a.show(d) && can(a.perm)).map(([k, a]) => <Button key={k} variant={a.tone === 'danger' ? 'secondary' : 'primary'} size="sm" onClick={() => setAction(k)}>{a.label}</Button>)}
          {can('ledger.adjust') && d.accounts.some((a) => a.status === 'active') && <Button size="sm" variant="accent" icon="bank" to={`/admin/ledger?accountId=${d.accounts.find((a) => a.status === 'active').id}`}>Create ledger credit</Button>}
          {!Object.values(ACTIONS).some((a) => a.show(d) && can(a.perm)) && !can('ledger.adjust') && <span className="muted">You have read-only access to this customer.</span>}
        </div>
      </Card>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Profile" data-animate>
          <KeyValue items={[
            { label: 'Customer ID', value: <span className="mono small">{p.id}</span> },
            { label: 'Phone', value: p.phone }, { label: 'Date of birth', value: p.dateOfBirth },
            { label: 'Address', value: [p.address.line1, p.address.city, p.address.state, p.address.postalCode, p.address.country].filter(Boolean).join(', ') },
            { label: 'Email verified', value: p.emailVerified ? 'Yes' : 'No' }, { label: 'MFA', value: p.mfaEnabled ? 'Enabled' : 'Off' },
            { label: 'Active sessions', value: d.activeSessions }, { label: 'Last sign-in', value: p.lastLoginAt ? dateTime(p.lastLoginAt) : '—' }, { label: 'Registered', value: dateTime(p.createdAt) },
          ]} />
        </Card>
        <Card title="Accounts" data-animate>
          {d.accounts.map((a) => (
            <div key={a.id} style={{ marginBottom: 14 }}>
              <div className="row-between"><strong>{a.name}</strong><Badge status={a.status} /></div>
              <div className="mono small muted">{a.accountNumber}</div>
              <KeyValue items={[{ label: 'Ledger balance', value: money(a.balances.ledger, a.currency) }, { label: 'Available', value: money(a.balances.available, a.currency) }, { label: 'Held', value: money(a.balances.held, a.currency) }]} />
              {can('ledger.read') && <Button size="sm" variant="ghost" to={`/admin/ledger?inspect=${a.id}`}>Inspect ledger</Button>}
              {a.securityReview && <p className="small" style={{ margin: '6px 0' }}><Badge tone="warning">Under security review</Badge> <span className="muted">{a.securityReviewReason}</span></p>}
              {can('accounts.review') && <Button size="sm" variant="secondary" onClick={() => setReviewFor(a)}>{a.securityReview ? 'Clear security review' : 'Place under security review'}</Button>}
            </div>
          ))}
        </Card>
      </div>
      <Card title="Recent transactions" pad={false} className="card-flush" data-animate>
        <DataTable rows={d.transactions} caption="Transactions" columns={[
          { key: 'createdAt', header: 'Date', render: (t) => dateTime(t.createdAt) },
          { key: 'reference', header: 'Reference', render: (t) => <span className="mono">{t.reference}</span> },
          { key: 'type', header: 'Type', render: (t) => titleCase(t.type) },
          { key: 'amount', header: 'Amount', className: 'num', render: (t) => `${t.direction === 'credit' ? '+' : t.direction === 'debit' && t.hasLedgerEntries ? '−' : ''}${money(t.amount, t.currency)}` },
          { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
        ]} empty={<EmptyState icon="list" title="No transactions" />} />
      </Card>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Withdrawal requests" data-animate>
          {d.withdrawals.length ? <ul>{d.withdrawals.map((w) => <li key={w.id} className="kv-row"><span><Link to={`/admin/withdrawals/${w.id}`} className="mono">{w.reference}</Link><br /><span className="muted small">{dateTime(w.created_at)}</span></span><span style={{ textAlign: 'right' }}>{money(w.amount, w.currency)}<br /><Badge status={w.status} /></span></li>)}</ul> : <EmptyState icon="upload" title="None" />}
        </Card>
        <Card title="Support requests" data-animate>
          {d.supportRequests.length ? <ul>{d.supportRequests.map((t) => <li key={t.id} className="kv-row"><span><Link to={`/admin/support/${t.id}`}>{t.subject}</Link><br /><span className="muted small mono">{t.reference}</span></span><Badge status={t.status} /></li>)}</ul> : <EmptyState icon="lifebuoy" title="None" />}
        </Card>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Login activity" pad={false} className="card-flush" data-animate>
          <DataTable rows={d.loginActivity.map((l, i) => ({ ...l, id: i }))} caption="Login activity" columns={[
            { key: 'at', header: 'When', render: (l) => relativeTime(l.at) }, { key: 'success', header: 'Result', render: (l) => <Badge tone={l.success ? 'success' : 'danger'}>{l.success ? 'Success' : titleCase(l.reason || 'Failed')}</Badge> },
            { key: 'device', header: 'Device' }, { key: 'ip', header: 'IP', render: (l) => <span className="mono">{l.ip}</span> },
          ]} empty={<EmptyState icon="clock" title="No sign-ins" />} />
        </Card>
        <Card title="Security events" data-animate>
          {d.securityEvents.length ? <ul>{d.securityEvents.map((e) => <li key={e.id} className="kv-row"><span>{e.summary}<br /><span className="muted small">{relativeTime(e.created_at)}</span></span><Badge status={e.severity} /></li>)}</ul> : <EmptyState icon="shield" title="None" />}
        </Card>
      </div>
      <ReasonDialog open={!!reviewFor} onClose={() => setReviewFor(null)} title={reviewFor?.securityReview ? 'Clear security review' : 'Place under security review'} confirmLabel={reviewFor?.securityReview ? 'Clear review' : 'Start review'} onSubmit={runReview}
        description={reviewFor?.securityReview ? 'Clearing the review does not approve any waiting withdrawal; staff still decide each one.' : 'New withdrawal requests on this account go to review and cannot be approved until the review is cleared. Waiting requests move to "Under review". The customer is notified with a neutral message. Other accounts are not affected.'} />
      <ReasonDialog open={!!action} onClose={() => setAction(null)} title={action ? ACTIONS[action].label : ''} tone={action && ACTIONS[action].tone} confirmLabel={action ? ACTIONS[action].label : 'Confirm'} onSubmit={run}
        description={action === 'reject_account' ? 'The customer will be notified by email and the application closed.' : action === 'lock' ? 'Locking ends all sessions and blocks sign-in until reactivated.' : action === 'suspend' ? 'The customer can sign in but cannot transact while suspended.' : undefined} />
    </div>
  );
}
