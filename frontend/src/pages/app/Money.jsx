import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import { ConfirmDialog } from '../../components/ui/Overlay.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
import { dateTime, money, uuid } from '../../lib/format.js';
import { usePrefs } from '../../lib/PreferencesProvider.jsx';
import Icon from '../../components/ui/Icon.jsx';

const toMinor = (s) => Math.round(parseFloat(s) * 100);

/** Shared: account picker + loading/empty handling. */
function useAccounts() {
  const r = useApi('/api/accounts');
  const list = r.data?.accounts ?? [];
  return { ...r, list, activeList: list.filter((a) => a.status === 'active') };
}

/** Transfer form. mode "ewb": to another EWB account by number. mode "save": from the customer's own account into one of their own savings accounts. */
export function Transfers({ mode = 'ewb', savingsAccounts = [] }) {
  const { t } = usePrefs();
  const saving = mode === 'save';
  useDocumentTitle(saving ? t('save.title') : t('transfer.ewb'));
  const toast = useToast();
  const acc = useAccounts();
  const ver = useApi('/api/verification/status');
  const [f, setF] = useState({ fromAccountId: '', toAccountNumber: '', amount: '', description: '' });
  const [fe, setFe] = useState({});
  const [review, setReview] = useState(false);
  const [key, setKey] = useState(uuid());
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);

  if (acc.loading || ver.loading) return <SkeletonCard lines={5} />;
  if (acc.error) return <ErrorState error={acc.error} onRetry={acc.refetch} />;
  const verified = ver.data?.status === 'verified';
  const sources = saving ? acc.activeList.filter((a) => a.type !== 'savings') : acc.activeList;
  const from = sources.find((a) => a.id === (f.fromAccountId || sources[0]?.id));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const validate = () => {
    const e = {};
    // New accounts are 12 digits starting with 605; older EWB + 10 digit numbers still work. The server is the authority.
    if (!/^(605\d{9}|EWB\d{10})$/i.test(f.toAccountNumber.trim())) e.toAccountNumber = t('transfer.err.recipient');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(f.amount) || toMinor(f.amount) <= 0) e.amount = 'Enter an amount greater than zero with at most two decimals.';
    else if (from && toMinor(f.amount) > from.availableBalance) e.amount = `Amount exceeds your available balance of ${money(from.availableBalance, from.currency)}.`;
    return e;
  };
  const toReview = (e) => { e.preventDefault(); const v = validate(); setFe(v); if (!Object.keys(v).length) { setErr(null); setReview(true); } };
  const submit = async () => {
    try {
      const r = await api.post('/api/transactions/transfers', { fromAccountId: from.id, toAccountNumber: f.toAccountNumber.trim().toUpperCase(), amount: f.amount, description: f.description || undefined, idempotencyKey: key });
      setDone(r.transaction); acc.refetch(); toast.success('Transfer completed.');
    } catch (ex) { setFe(fieldErrors(ex)); setErr(ex); setReview(false); throw ex; }
  };

  if (done) {
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <PageHeader title="Transfer completed" />
        <Card>
          <Alert tone="success" title="Your transfer is complete">Reference <span className="mono">{done.reference}</span></Alert>
          <dl className="kv"><div className="kv-row"><dt>Amount</dt><dd>{money(done.amount, done.currency)}</dd></div><div className="kv-row"><dt>To account</dt><dd className="mono">{done.counterparty}</dd></div><div className="kv-row"><dt>Completed</dt><dd>{dateTime(done.completedAt)}</dd></div></dl>
          <div className="row" style={{ marginTop: 16 }}><Button to={`/app/transactions/${done.id}`}>View details</Button><Button variant="secondary" onClick={() => { setDone(null); setF({ fromAccountId: '', toAccountNumber: '', amount: '', description: '' }); setKey(uuid()); }}>Make another transfer</Button></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <Link to="/app/transfers" className="settings-back"><Icon name="chevron-left" size={16} /> {t('transfer.all')}</Link>
      <PageHeader title={saving ? t('save.title') : t('transfer.ewb')} subtitle={saving ? t('save.intro') : t('transfer.ewb.desc')} />
      {!verified && <Alert tone="warning" title="Identity verification required" action={<Button size="sm" to="/app/verification">Verify now</Button>}>You need to verify your identity before making transfers.</Alert>}
      {!acc.activeList.length && <Alert tone="info" title="No active account">Transfers are available once your account is approved and active.</Alert>}
      {err && <Alert tone="danger">{err.message}</Alert>}
      <Card>
        <form onSubmit={toReview} noValidate>
          <Field label={t('transfer.from')} error={fe.fromAccountId} required>{(p) => (
            <Select {...p} value={from?.id || ''} onChange={set('fromAccountId')} disabled={!acc.activeList.length}>
              {sources.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.accountNumber.slice(-4)}) — {money(a.availableBalance, a.currency)} available</option>)}
            </Select>)}</Field>
          {saving ? (
            <Field label={t('save.to')} error={fe.toAccountNumber} required>{(p) => (
              <Select {...p} value={f.toAccountNumber} onChange={set('toAccountNumber')}>
                <option value="">—</option>
                {savingsAccounts.map((a) => <option key={a.id} value={a.accountNumber}>{a.name} ({a.accountNumber.slice(-4)})</option>)}
              </Select>)}</Field>
          ) : (
            <Field label={t('transfer.to')} error={fe.toAccountNumber} hint={t('transfer.to.hint')} required>{(p) => <Input {...p} dir="ltr" autoComplete="off" inputMode="text" autoCapitalize="characters" value={f.toAccountNumber} onChange={set('toAccountNumber')} />}</Field>
          )}
          <Field label={`${t('transfer.amount')} (${from?.currency ?? 'USD'})`} error={fe.amount} required>{(p) => <Input {...p} inputMode="decimal" autoComplete="off" placeholder="0.00" value={f.amount} onChange={set('amount')} />}</Field>
          <Field label={t('transfer.description')} error={fe.description}>{(p) => <Input {...p} maxLength={140} value={f.description} onChange={set('description')} />}</Field>
          <Button type="submit" size="lg" icon="send" disabled={!verified || !from} style={{ width: '100%' }}>{saving ? t('save.move') : t('transfer.review')}</Button>
        </form>
      </Card>
      <ConfirmDialog open={review} onClose={() => setReview(false)} onConfirm={submit} title="Confirm transfer" confirmLabel="Send transfer">
        <dl className="kv">
          <div className="kv-row"><dt>From</dt><dd>{from?.name} ••••{from?.accountNumber.slice(-4)}</dd></div>
          <div className="kv-row"><dt>To</dt><dd className="mono">{f.toAccountNumber.toUpperCase()}</dd></div>
          <div className="kv-row"><dt>Amount</dt><dd>{from && money(toMinor(f.amount || '0'), from.currency)}</dd></div>
          {f.description && <div className="kv-row"><dt>Description</dt><dd>{f.description}</dd></div>}
        </dl>
        <p className="muted small">Transfers between EWB accounts are final once recorded. Corrections are made by Customer Support with a new, clearly referenced transaction.</p>
      </ConfirmDialog>
    </div>
  );
}

const NOTICE = 'Submit a request and follow its status here. Requests can go through a security check before they are processed, and you will be notified when the status changes. Submitting a request does not itself move funds.';
const REVIEW_NOTICE = 'Your account is undergoing an additional security review. Some transactions may require verification before they can be completed. We will notify you when the review is complete.';
/** The one action a customer can take for a given status, when there genuinely is one. */
const nextStep = (w) => (w.status === 'additional_verification_required' ? <Link to="/app/verification">Continue identity verification</Link> : w.status === 'customer_support_required' ? <Link to="/app/support/new">Open a support request</Link> : null);

export function Withdrawals() {
  useDocumentTitle('Withdrawals');
  const toast = useToast();
  const acc = useAccounts();
  const list = useApi('/api/withdrawals');
  const [f, setF] = useState({ accountId: '', amount: '', bankName: '', accountName: '', last4: '', note: '' });
  const [fe, setFe] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [cancelId, setCancelId] = useState(null);
  const [wdKey, setWdKey] = useState(uuid());

  if (acc.loading || list.loading) return <SkeletonCard lines={5} />;
  if (acc.error) return <ErrorState error={acc.error} onRetry={acc.refetch} />;
  const account = acc.list.find((a) => a.id === (f.accountId || acc.activeList[0]?.id));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setErr(null); setResult(null);
    const v = {};
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(f.amount) || toMinor(f.amount) <= 0) v.amount = 'Enter a valid amount.';
    else if (account && toMinor(f.amount) > account.availableBalance) v.amount = `Amount exceeds your available balance of ${money(account.availableBalance, account.currency)}.`;
    if (f.bankName.trim().length < 2) v.bankName = 'Enter the destination bank name.';
    if (f.accountName.trim().length < 2) v.accountName = 'Enter the account holder name.';
    if (!/^\d{4}$/.test(f.last4)) v.last4 = 'Enter exactly 4 digits.';
    setFe(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const r = await api.post('/api/withdrawals', { accountId: account.id, amount: f.amount, bankName: f.bankName, accountName: f.accountName, last4: f.last4, note: f.note || undefined, idempotencyKey: wdKey });
      setResult(r); setWdKey(uuid()); setF({ ...f, amount: '', note: '' }); list.reload(); acc.reload();
    } catch (ex) { setErr(ex); setFe(fieldErrors(ex)); } finally { setBusy(false); }
  };
  const cancel = async () => { await api.post(`/api/withdrawals/${cancelId}/cancel`); toast.success('Request cancelled.'); list.reload(); acc.reload(); };

  return (
    <div className="stack">
      <PageHeader title="Withdrawals" subtitle="Request a withdrawal and follow its status." />
      <Alert tone="info" title="How withdrawals work">{NOTICE}</Alert>
      {account?.securityReview && <Alert tone="info" title="Additional security review">{REVIEW_NOTICE}</Alert>}
      {result && (
        <Alert tone="info" title={`Request ${result.withdrawal.reference} — ${result.withdrawal.statusLabel}`}>
          {result.message} {nextStep(result.withdrawal)}
        </Alert>
      )}
      {err && <Alert tone="danger">{err.message}</Alert>}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="New withdrawal request">
          {!acc.activeList.length ? <EmptyState icon="lock" title="No active account">Withdrawal requests are available once your account is approved.</EmptyState> : (
            <form onSubmit={submit} noValidate>
              {acc.activeList.length > 1 && <Field label="From account">{(p) => <Select {...p} value={account.id} onChange={set('accountId')}>{acc.activeList.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.accountNumber.slice(-4)})</option>)}</Select>}</Field>}
              <p className="muted small" style={{ marginTop: -4 }}>Available: <strong>{money(account.availableBalance, account.currency)}</strong></p>
              <Field label={`Amount (${account.currency})`} error={fe.amount} required>{(p) => <Input {...p} inputMode="decimal" placeholder="0.00" autoComplete="off" value={f.amount} onChange={set('amount')} />}</Field>
              <Field label="Destination bank name" error={fe.bankName} required>{(p) => <Input {...p} autoComplete="off" value={f.bankName} onChange={set('bankName')} />}</Field>
              <Field label="Account holder name" error={fe.accountName} required>{(p) => <Input {...p} autoComplete="off" value={f.accountName} onChange={set('accountName')} />}</Field>
              <Field label="Last 4 digits of destination account" error={fe.last4} hint="We only store the last four digits." required>{(p) => <Input {...p} inputMode="numeric" maxLength={4} autoComplete="off" value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, '') })} />}</Field>
              <Field label="Note (optional)" error={fe.note}>{(p) => <Textarea {...p} style={{ minHeight: 80 }} maxLength={300} value={f.note} onChange={set('note')} />}</Field>
              <Button type="submit" loading={busy} size="lg" style={{ width: '100%' }}>Submit request</Button>
            </form>
          )}
        </Card>
        <Card title="Your requests">
          {list.data?.withdrawals?.length ? (
            <ul>
              {list.data.withdrawals.map((w) => (
                <li key={w.id} className="notif" style={{ flexDirection: 'column', gap: 6 }}>
                  <div className="row-between"><strong>{money(w.amount, w.currency)}</strong><Badge status={w.status} /></div>
                  <div className="muted small">{w.destination.bankName} ••••{w.destination.last4} · <span className="mono">{w.reference}</span> · {dateTime(w.createdAt)}</div>
                  <div className="small">{w.customerMessage} {nextStep(w)}</div>
                  {['requested', 'under_review', 'additional_verification_required', 'customer_support_required'].includes(w.status) && <div><Button size="sm" variant="secondary" onClick={() => setCancelId(w.id)}>Cancel request</Button></div>}
                </li>
              ))}
            </ul>
          ) : <EmptyState icon="upload" title="No requests yet">Requests you submit are listed here with their real status.</EmptyState>}
        </Card>
      </div>
      <ConfirmDialog open={!!cancelId} onClose={() => setCancelId(null)} onConfirm={cancel} title="Cancel this request?" message="The request will be closed and the held amount becomes available again." confirmLabel="Cancel request" tone="danger" />
    </div>
  );
}
