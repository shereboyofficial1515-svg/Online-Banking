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
import MaintenanceNotice from '../../components/MaintenanceNotice.jsx';

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
  const [maint, setMaint] = useState(null); // { email } when the server says transfers are in maintenance
  const feat = useApi('/api/features');

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
  const toReview = (e) => {
    e.preventDefault(); const v = validate(); setFe(v);
    if (Object.keys(v).length) return;
    setErr(null);
    // The maintenance message appears when the customer tries to go ahead, not when the page opens. The server enforces it either way.
    if (feat.data && feat.data.transfers?.enabled === false) { setMaint({ email: feat.data.supportEmail }); return; }
    setReview(true);
  };
  const submit = async () => {
    try {
      const r = await api.post('/api/transactions/transfers', { fromAccountId: from.id, toAccountNumber: f.toAccountNumber.trim().toUpperCase(), amount: f.amount, description: f.description || undefined, idempotencyKey: key });
      setDone(r.transaction); acc.refetch(); toast.success('Transfer completed.');
    } catch (ex) {
      setReview(false);
      if (ex.code === 'TRANSFERS_UNAVAILABLE') { setMaint({ email: ex.details?.supportEmail ?? feat.data?.supportEmail ?? null }); return; }
      setFe(fieldErrors(ex)); setErr(ex); throw ex;
    }
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
      {maint && <MaintenanceNotice email={maint.email} onClose={() => setMaint(null)} />}
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
